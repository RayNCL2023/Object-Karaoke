// Hack day starter: one Node file, no packages to install. Run: node server.mjs
// Serves public/ and a small API so the page (and a phone) can use Gemma 4, ElevenLabs and NMAFC memory.
// API keys stay here on the server; the browser never sees them.
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { startTunnel, findCloudflared } from "./lib/tunnel.mjs";
import { createDuet } from "./lib/duet.mjs";
import { createAudience } from "./lib/audience.mjs";
import { createSetup } from "./lib/setup.mjs";
import { createPlayers } from "./lib/players.mjs";
import { createKaraoke } from "./lib/karaoke.mjs";
import { createPvp } from "./lib/pvp.mjs";
import { createOvo } from "./lib/ovo.mjs";

// App folder (holds public/). The Windows exe sets DUET_APP_DIR to the folder next to DuetAnything.exe;
// from source it's this file's folder. Never the cwd, so double-clicking from anywhere still finds public/.
const here = process.env.DUET_APP_DIR || path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "public");
if (!fs.existsSync(publicDir)) console.error(`[server] public/ folder not found at ${publicDir}`);
// Windows app: .env, cache/ and certs/ live in DUET_DATA_DIR (%APPDATA%\DuetAnything) instead of here.
const dataDir = process.env.DUET_DATA_DIR || here;

// Load .env (KEY=VALUE lines).
const envFile = path.join(dataDir, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const env = (k, d = "") => process.env[k] || d;
const PORT = Number(env("PORT", "5173"));

// ---------- Gemma 4 (Gemini API, REST) ----------
const GEMINI = "https://generativelanguage.googleapis.com/v1beta";

/** Ask Gemma. prompt: text. image: optional {data: base64, mime}. json: ask for JSON back and parse it. */
// Every call aborts after timeoutMs (default 20 s, GEMMA_TIMEOUT_MS) so a slow API can't hang a snap.
async function gemma({ prompt, image, json = false, temperature = 0.8, maxTokens = 2048, timeoutMs }) {
  const signal = AbortSignal.timeout(Number(timeoutMs) || Number(env("GEMMA_TIMEOUT_MS", "20000")));
  const key = env("GEMINI_API_KEY");
  if (!key) return { text: "(demo mode: put GEMINI_API_KEY in .env)", mock: true };
  const model = env("GEMINI_MODEL", "gemma-4-26b-a4b-it");
  // Gemma takes everything in the user turn (no system prompt / JSON mode), so JSON is asked for in the prompt.
  const text = json ? `${prompt}\n\nReply with JSON only. No markdown, no code fences.` : prompt;
  const parts = [{ text }];
  if (image?.data) parts.push({ inline_data: { mime_type: image.mime || "image/png", data: image.data } });
  const call = async (thinking) => {
    const generationConfig = { temperature, maxOutputTokens: maxTokens };
    // Gemma 4 "thinks" by default and can take minutes; minimal thinking answers in seconds.
    if (thinking) generationConfig.thinkingConfig = { thinkingLevel: "minimal" };
    const res = await fetch(`${GEMINI}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message || `Gemini ${res.status}`);
    return body;
  };
  let body;
  try { body = await call(true); }
  catch (e) { if (!/thinking/i.test(e.message)) throw e; body = await call(false); }
  const out = (body.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
  if (!json) return { text: out, model };
  const raw = out.slice(out.indexOf("{") >= 0 && (out.indexOf("[") < 0 || out.indexOf("{") < out.indexOf("[")) ? out.indexOf("{") : out.indexOf("["));
  try { return { text: out, json: JSON.parse(raw.slice(0, Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]")) + 1)), model }; }
  catch { return { text: out, json: null, model, warning: "reply was not valid JSON" }; }
}

// ---------- ElevenLabs ----------
const ELEVEN = "https://api.elevenlabs.io/v1";
const elevenKey = () => env("ELEVENLABS_API_KEY");
const maxChars = () => Number(env("ELEVENLABS_MAX_CHARS", "300"));
let voicesCache = null;

async function voices() {
  if (voicesCache) return voicesCache;
  const res = await fetch(`${ELEVEN}/voices`, { headers: { "xi-api-key": elevenKey() }, signal: AbortSignal.timeout(10000) }); // cached after the first call
  if (!res.ok) throw new Error(`ElevenLabs voices ${res.status}`);
  voicesCache = (await res.json()).voices.map((v) => ({ id: v.voice_id, name: v.name, labels: v.labels }));
  return voicesCache;
}

/** Text to speech. Returns an MP3 Buffer. voice: id or name (defaults to the first voice). Capped to save credit. */
async function speak({ text, voice }) {
  if (!elevenKey()) throw new Error("demo mode: put ELEVENLABS_API_KEY in .env");
  const t = String(text || "").slice(0, maxChars());
  const list = await voices();
  const v = list.find((x) => x.id === voice || x.name.toLowerCase() === String(voice || "").toLowerCase()) || list[0];
  const res = await fetch(`${ELEVEN}/text-to-speech/${v.id}?output_format=mp3_44100_128`, {
    method: "POST", signal: AbortSignal.timeout(20000),
    headers: { "xi-api-key": elevenKey(), "Content-Type": "application/json" },
    body: JSON.stringify({ model_id: "eleven_multilingual_v2", text: t }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Sound effect from a text prompt. Returns an MP3 Buffer. */
async function sfx({ prompt, seconds = 2 }) {
  if (!elevenKey()) throw new Error("demo mode: put ELEVENLABS_API_KEY in .env");
  const res = await fetch(`${ELEVEN}/sound-generation`, {
    method: "POST", signal: AbortSignal.timeout(30000),
    headers: { "xi-api-key": elevenKey(), "Content-Type": "application/json" },
    body: JSON.stringify({ text: String(prompt).slice(0, 200), duration_seconds: Math.min(Math.max(seconds, 0.5), 10), prompt_influence: 0.6 }),
  });
  if (!res.ok) throw new Error(`ElevenLabs SFX ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---------- NMAFC memory (OpenLoft) ----------
const memUrl = (p) => env("NMAFC_URL", "http://127.0.0.1:8765").replace(/\/$/, "") + p;
const agent = () => env("NMAFC_AGENT", "hackday-manchester");

async function mem(p, body, timeoutMs = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(memUrl(p), { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    if (!res.ok) throw new Error(`NMAFC ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}
// Storing runs an LLM extraction on the NMAFC side, so it can take a while: give it a long timeout.
const remember = (text) => mem("/v1/memories", { agent_id: agent(), messages: [{ role: "user", content: String(text) }] }, 180000);
const recall = (query, limit = 8) => mem("/v1/memories/search", { agent_id: agent(), query: String(query), limit });
const listMemories = () => mem(`/v1/memories?agent_id=${encodeURIComponent(agent())}&limit=50`);

// ---------- Phone remote: phone POSTs events, pages listen with Server-Sent Events ----------
const listeners = new Set();
// Long-poll fallback (GET /api/poll?since=SEQ): the Cloudflare quick tunnel buffers streamed responses (~128 KB) so SSE
// events can arrive late through it. Phones on the public link should poll instead. Last 300 events kept with a seq number.
let seq = 0;
const recent = []; // [{ seq, event }]
const pollers = new Set(); // pending long-polls: () => void
function broadcast(event) {
  event = decorate(event);
  try { audience.observe?.(event); } catch { /* audience not ready yet */ } // late judges: GET /api/audience/state
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of listeners) { try { res.write(line); } catch { listeners.delete(res); } }
  if (event && typeof event === "object") { recent.push({ seq: ++seq, event }); if (recent.length > 300) recent.shift(); for (const wake of [...pollers]) wake(); }
  if (event?.type === "audience-react") { try { karaoke.react(event.reaction); } catch { /* not ready */ } } // karaoke crowd score
  if (event?.type === "song-ready" && event.session && !event.session.parts) { try { karaoke.noteSnap(event.session); } catch { /* not ready */ } } // last snap = karaoke AI partner
  if (event?.type === "verdict" && !event.pvp && active && !active.pvp) { active = null; players.rotate(); } // VS THE OBJECT: next player is up
}
// Multi-player: tag record-start with the player whose turn it is (mic.js ignores record-starts meant for someone else).
let active = null; // { id, pvp, player } = the battle on stage
function decorate(e) {
  if (!e || typeof e !== "object") return e;
  if (e.type === "record-start") { // sync: startAt = server time the take window opens (phones correct for clock offset via /api/time)
    const now = Date.now();
    if (!e.startAt) e.startAt = now + Math.max(0, Math.min(5000, Number(e.leadMs) || 0));
    e.serverAt = now;
  }
  if (e.type === "song-ready" && e.session) {
    const s = e.session;
    if (s.pvp) active = { id: s.id, pvp: true };
    else if (s.parts) active = { id: s.id, pvp: false, parts: true }; // karaoke parts: the stage targets each record-start itself
    else { const p = players.current(); active = { id: s.id, pvp: false, player: p }; if (p) Object.assign(s, { player: p.id, playerName: p.name, playerColour: p.colour }); }
  } else if (e.type === "record-start" && !e.player && !e.all && active && !active.parts) {
    const p = active.pvp ? pvp.turnPlayer(active.id, e.round ?? e.line) : active.player;
    if (p) Object.assign(e, { player: p.id, playerName: p.name, playerColour: p.colour });
    else if (!active.pvp && owners.get(active.id)) e.client = owners.get(active.id); // only the phone that snapped records
  } else if (e.type === "photo-received" && e.id && pendingClient) { owners.set(e.id, pendingClient); pendingClient = null; if (owners.size > 200) owners.delete(owners.keys().next().value); }
  else if (e.type === "reset") { active = null; try { ovo.reset(); } catch { /* not ready */ } }
  return e;
}

// Mic owner per session: the phone (mic.js "client" id) that snapped. Only it can send /api/take + mic-unavailable.
const owners = new Map(); // sessionId -> client id
let pendingClient = null; // set by POST /api/object, claimed by its photo-received event

// ---------- HTTP ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ico": "image/x-icon" };

const readJson = (req) => req._body !== undefined ? Promise.resolve(req._body) : new Promise((resolve, reject) => {
  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 15e6) { reject(Object.assign(new Error("body too big"), { status: 413 })); req.destroy(); } });
  req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(Object.assign(new Error("bad JSON"), { status: 400 })); } });
  req.on("error", reject);
});
const sendJson = (res, code, obj) => res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(obj));

// Audience join link: plain http (no mic needed, so no certificate warning for the crowd).
// Room code: ROOM_CODE in .env, else the code saved in <data>/cache/room-code.txt (so restarts keep it), else a new one.
const roomFile = path.join(dataDir, "cache", "room-code.txt");
const savedRoom = (() => { try { return fs.readFileSync(roomFile, "utf8").trim(); } catch { return ""; } })();
const sessionInfo = (id) => { if (/^demo_[0-9]{10,16}$/.test(String(id))) return { rounds: 3, done: false }; /* stage offline B demo: crowd can vote */ if (ovo?.has(id)) return ovo.info(id); /* OBJECT vs OBJECT */ const s = pvp.get?.(id) || duet.sessions.get(id); return s ? { rounds: s.battle?.rounds || 0, done: !!s.verdict } : null; };
const audience = createAudience({ broadcast: (e) => broadcast(e), readJson, sendJson, joinUrl: () => playUrl(), sessionInfo: (id) => sessionInfo(id), code: env("ROOM_CODE") || savedRoom });
if (!env("ROOM_CODE") && audience.code !== savedRoom) { try { fs.mkdirSync(path.dirname(roomFile), { recursive: true }); fs.writeFileSync(roomFile, audience.code); } catch { /* read-only */ } } // one QR for everyone: /play (BATTLE or JUDGE)
const setup = createSetup({ here: dataDir, env, readJson, sendJson }); // .env lives in dataDir (DUET_DATA_DIR in the desktop app)
const duet = createDuet({ here, env, gemma, voices, remember, recall, broadcast: (e) => broadcast(e), readJson, sendJson, crowdTally: (id) => audience.getTally(id) });

const players = createPlayers({ broadcast: (e) => broadcast(e), readJson, sendJson, roomCode: () => audience.code });
const pvp = createPvp({ here, env, gemma, remember, duet, players, broadcast: (e) => broadcast(e), readJson, sendJson, crowdTally: (id) => audience.getTally(id) });
const karaoke = createKaraoke({ here, env, gemma, duet, players, broadcast: (e) => broadcast(e), readJson, sendJson });
const ovo = createOvo({ here, env, gemma, remember, duet, players, broadcast: (e) => broadcast(e), readJson, sendJson, crowdTally: (id) => audience.getTally(id) });
// PvP sessions go to lib/pvp.mjs, everything else to lib/duet.mjs (body read once, handed on via req._body).
const viaPvp = (name) => async (req, res) => {
  const b = await readJson(req);
  if (name === "take" && !hostOk(req)) { // only the snapping phone (or, in PvP, the player whose turn it is) can send a take
    const owner = owners.get(b.id);
    if (owner && b.client !== owner && !pvp.has(b.id) && !karaoke.has(b.id)) return sendJson(res, 403, { error: "not your battle - only the phone that snapped can rap" });
    const turn = pvp.has(b.id) ? pvp.turnPlayer(b.id, b.round ?? b.line) : null;
    if (turn && b.player && b.player !== turn.id) return sendJson(res, 403, { error: "not your turn" });
  }
  if (name === "judge") { // optional { waitVotesMs } (max 10000): let the crowd's last votes land, then close voting
    const wait = Math.max(0, Math.min(10000, Number(b.waitVotesMs) || 0));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    audience.close?.(b.id);
  }
  if (karaoke.has(b.id)) return karaoke[name](b, req, res); // karaoke song sessions (lib/karaoke.mjs)
  if (pvp.has(b.id)) return pvp[name](b, req, res);
  req._body = b;
  return duet.routes[`POST /api/${name}`](req, res);
};
// /api/object: remember which phone snapped; if it fails or takes too long, tell every screen so they can recover.
const OBJECT_TIMEOUT_MS = 90000;
async function objectRoute(req, res) {
  const b = await readJson(req);
  req._body = b;
  pendingClient = typeof b.client === "string" ? b.client.slice(0, 80) : null;
  const fail = (code, message) => {
    broadcast({ type: "error", stage: "object", message, at: Date.now() });
    broadcast({ type: "reset", reason: "object-failed", at: Date.now() });
    if (!res.headersSent) sendJson(res, code, { error: message });
  };
  let timer;
  const work = SOLO ? duet.routes["POST /api/object"](req, res) : players.isOvo?.() ? ovo.object(req, res) : duet.getMode() === "karaoke" && karaoke.armed() ? karaoke.object(req, res) : players.pvpPair() ? pvp.object(req, res) : duet.routes["POST /api/object"](req, res);
  try {
    await Promise.race([work, new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error("Took too long waking it up - snap again"), { timeout: true })), OBJECT_TIMEOUT_MS); })]);
  } catch (e) {
    console.error("[/api/object]", e.message);
    fail(e.timeout ? 504 : 500, e.timeout ? e.message : "Couldn't wake that one up - snap again");
  } finally { clearTimeout(timer); pendingClient = null; }
}

// ---------- host lock: paid / admin endpoints only from the laptop (localhost) or with the per-run HOST_TOKEN ----------
const HOST_TOKEN = env("HOST_TOKEN") || crypto.randomBytes(16).toString("hex");
const hostOk = (req) => setup.isLocal(req) || req.headers["x-host-token"] === HOST_TOKEN || new URL(req.url, "http://x").searchParams.get("token") === HOST_TOKEN;
const HOST_ONLY = /^(POST \/api\/(gemma|speak|sfx|mode|difficulty|match|karaoke\/(pick|start|heckle))|GET \/api\/voices|(GET|POST) \/api\/memory\/.*|(GET|POST) \/api\/setup\/.+)$/;

// SOLO_MODE (default on): demo focuses on YOU vs THE OBJECT. PvP / object vs object / karaoke stay in the code; SOLO_MODE=0 brings them back.
const SOLO = env("SOLO_MODE", "1") !== "0";
const routes = {
  ...duet.routes,
  ...players.routes,
  ...karaoke.routes,
  "POST /api/object": objectRoute,
  "POST /api/take": viaPvp("take"),
  "POST /api/judge": viaPvp("judge"),
  ...ovo.routes,
  "POST /api/ovo/judge": async (req, res) => { // { id, waitVotesMs }: let the last votes land, close voting, then judge
    const b = await readJson(req);
    const wait = Math.max(0, Math.min(10000, Number(b.waitVotesMs) || 0));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    audience.close?.(b.id);
    return ovo.judge(b, req, res);
  },
  ...audience.routes,
  ...(SOLO ? {
    "POST /api/mode": async (req, res) => sendJson(res, 200, { mode: "battle" }),
    "POST /api/match": async (req, res) => players.routes["GET /api/match"](req, res),
  } : {}),
  ...setup.routes,
  "POST /api/broadcast": async (req, res) => relay(req, res),
  "POST /api/gemma": async (req, res) => sendJson(res, 200, await gemma(await readJson(req))),
  "POST /api/speak": async (req, res) => { const buf = await speak(await readJson(req)); res.writeHead(200, { "Content-Type": "audio/mpeg" }).end(buf); },
  "POST /api/sfx": async (req, res) => { const buf = await sfx(await readJson(req)); res.writeHead(200, { "Content-Type": "audio/mpeg" }).end(buf); },
  "GET /api/voices": async (req, res) => sendJson(res, 200, await voices()),
  "POST /api/memory/remember": async (req, res) => sendJson(res, 200, await remember((await readJson(req)).text)),
  "POST /api/memory/search": async (req, res) => sendJson(res, 200, await recall((await readJson(req)).query)),
  "GET /api/memory/list": async (req, res) => sendJson(res, 200, await listMemories()),
  "POST /api/phone": async (req, res) => relay(req, res),
  "GET /api/events": async (req, res) => {
    // no-transform + X-Accel-Buffering: proxies/tunnels (Cloudflare) must not buffer; ": ping" every 15 s stops idle-closes.
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write(": connected\n\n");
    listeners.add(res);
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* closed */ } }, 15000);
    req.on("close", () => { clearInterval(ping); listeners.delete(res); });
  },
  // GET /api/poll?since=SEQ&wait=MS -> { seq, events: [...] } (waits up to 25 s for something new). since omitted = just the current seq.
  "GET /api/time": async (req, res) => sendJson(res, 200, { now: Date.now() }), // phone clock-offset probe
  "GET /api/poll": async (req, res) => {
    const q = new URL(req.url, "http://x").searchParams;
    const since = q.has("since") ? Number(q.get("since")) : seq;
    const wait = Math.max(0, Math.min(25000, Number(q.get("wait") ?? 20000)));
    const reply = () => { const events = recent.filter((r) => r.seq > since).map((r) => ({ ...r.event, seq: r.seq })); res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify({ seq, events })); };
    if (seq > since || !wait) return reply();
    let timer;
    const wake = () => { clearTimeout(timer); pollers.delete(wake); if (!res.writableEnded) reply(); };
    pollers.add(wake);
    timer = setTimeout(wake, wait);
    res.on("close", () => { clearTimeout(timer); pollers.delete(wake); });
  },
  "GET /api/status": async (req, res) => {
    let memory = false;
    try { await mem("/v1/memories/search", { agent_id: agent(), query: "ping", limit: 1 }, 3000); memory = true; } catch { /* not running */ }
    sendJson(res, 200, { gemma: !!env("GEMINI_API_KEY"), elevenlabs: !!elevenKey(), memory, phoneUrl: phoneUrl(), micUrl: publicUrl ? `${publicUrl}/mic.html` : httpsReady ? micHttpsUrl() : phoneUrl().replace("/phone.html", "/mic.html"), publicUrl, shortUrl, tunnel: tunnelState, battle: duet.battleCfg?.() || null, ...(setup.isLocal(req) ? { hostToken: HOST_TOKEN } : {}), mock: env("MOCK") === "1", solo: SOLO, mode: SOLO ? "battle" : duet.getMode?.() || "battle", difficulty: duet.getDifficulty?.() || "spicy", needsSetup: setup.needsSetup(), roomCode: audience.code, joinUrl: publicUrl ? `${publicUrl}/join.html` : `http://${lanIp()}:${PORT}/join.html`, playUrl: playUrl(), players: players.count() });
  },
};

/** The Wi-Fi/LAN address a phone can reach (private ranges first, so VPN addresses like 100.x are skipped). */
function lanIp() {
  const all = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a.address);
  return all.find((ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) || all[0] || "localhost";
}
const phoneUrl = () => `http://${lanIp()}:${PORT}/phone.html`;
// Always hand out a SECURE link so the phone mic works: the public tunnel if it's up, else the LAN https port.
const playUrl = () => (publicUrl ? `${publicUrl}/play` : httpsReady ? `https://${lanIp()}:${HTTPS_PORT}/play` : `http://${lanIp()}:${PORT}/play`);
// Any-Wi-Fi public link (TUNNEL=1 or --tunnel): https://*.trycloudflare.com, real certificate, works on 4G too.
let publicUrl = "", tunnelState = "off"; // off | starting | on | failed
// Easy-to-type link for the tunnel: is.gd/duet<roomcode> (free, no account). SHORT_LINK=0 turns it off.
let shortUrl = "";
async function makeShortUrl(longUrl) {
  if (env("SHORT_LINK") === "0") return "";
  const base = `duet-${String(audience.code || "").toLowerCase()}`;
  // TinyURL (custom alias, no account), then is.gd as a backup. Aliases are global, so add a number if taken.
  for (const alias of [base, ...Array.from({ length: 5 }, () => base + Math.floor(Math.random() * 90 + 10))]) {
    try {
      const r = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}&alias=${alias}`, { signal: AbortSignal.timeout(8000) });
      const t = (await r.text()).trim();
      if (r.ok && /^https:\/\/tinyurl\.com\//.test(t)) return t.replace(/^https?:\/\//, "");
    } catch { break; }
  }
  try {
    const r = await fetch(`https://is.gd/create.php?format=json&url=${encodeURIComponent(longUrl)}&shorturl=${base.replace("-", "")}`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (j.shorturl) return j.shorturl.replace(/^https?:\/\//, "");
  } catch { /* no short link: the QR still works */ }
  return "";
}

/** /api/broadcast + /api/phone: phones relay events. Host-only: reset. mic-unavailable only from the snapping phone. */
async function relay(req, res) {
  const b = await readJson(req);
  const host = hostOk(req);
  if (!host && b?.type === "reset") return sendJson(res, 403, { error: "only the stage can reset" });
  if (!host && b?.type === "mic-unavailable" && active?.pvp) { // PvP: only the two battling phones can switch the stage to the laptop mic
    const pair = pvp.get(active.id)?.pvp?.players || [];
    if (!pair.some((p) => p.id === b.player)) return sendJson(res, 200, { ok: true, ignored: true });
  }
  if (!host && b?.type === "mic-unavailable" && active && !active.pvp) {
    const owner = owners.get(active.id);
    if (owner && b.client !== owner) return sendJson(res, 200, { ok: true, ignored: true });
  }
  broadcast({ ...b, at: Date.now() });
  sendJson(res, 200, { ok: true, listeners: listeners.size });
}

// Phones only allow the microphone on a secure page, so the same app is also served over HTTPS on PORT+1
// with a self-signed certificate (made once with openssl into certs/). The phone taps "Advanced > Proceed" once.
const HTTPS_PORT = PORT + 1;
const micHttpsUrl = () => `https://${lanIp()}:${HTTPS_PORT}/mic.html`;
let httpsReady = false;
function certificate() {
  const dir = path.join(dataDir, "certs");
  const key = path.join(dir, "key.pem"), cert = path.join(dir, "cert.pem");
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "30",
      "-subj", "/CN=duet-anything", "-addext", `subjectAltName=IP:${lanIp()},DNS:localhost`], { stdio: "ignore" });
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

async function handle(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(String(req.url || "/").split("?")[0]); }
  catch { return sendJson(res, 400, { error: "bad URL" }); }
  const key = `${req.method} ${urlPath}`;
  const route = routes[key];
  if (route && HOST_ONLY.test(key) && !hostOk(req)) return sendJson(res, 403, { error: "host only - open the stage on the laptop" });
  if (!route && req.method === "GET" && duet.serveCache(urlPath, res)) return;
  if (route) {
    try { await route(req, res); }
    catch (e) {
      console.error(`[${urlPath}]`, e.message);
      if (!res.headersSent) sendJson(res, e.status || 500, { error: e.status ? e.message : "Something went wrong - try again" });
      else try { res.end(); } catch { /* gone */ }
    }
    return;
  }
  // "/" = landing (HOST or PLAYER), "/stage" = the stage, "/play" = player phone. No keys yet: setup, on the laptop only.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(req.headers.host || "");
  // The laptop is always the host: "/" and "/stage" open the stage there. Any other device (QR / tunnel link) lands on the player page.
  const pages = local ? { "/": "index.html", "": "index.html", "/stage": "index.html", "/play": "play.html", "/home": "home.html" }
                      : { "/": "play.html", "": "play.html", "/stage": "play.html", "/play": "play.html" };
  const page = pages[urlPath] && (urlPath !== "/play" && setup.needsSetup() && local ? "setup.html" : pages[urlPath]);
  const file = path.join(publicDir, page || urlPath);
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end("Not found");
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

// Never die on a stray error mid-demo: log it and keep serving.
process.on("uncaughtException", (e) => console.error("[server] uncaught:", e?.stack || e));
process.on("unhandledRejection", (e) => console.error("[server] unhandled rejection:", e?.stack || e));
function safeHandle(req, res) {
  handle(req, res).catch((e) => { console.error("[server]", e?.message); try { if (!res.headersSent) sendJson(res, 500, { error: "server error" }); else res.end(); } catch { /* gone */ } });
}

try {
  https.createServer(certificate(), safeHandle).listen(HTTPS_PORT, "0.0.0.0", () => {
    httpsReady = true;
    console.log(`Mic:   ${micHttpsUrl()}  (phone on the same Wi-Fi; tap Advanced > Proceed once)`);
  });
} catch (e) { console.log(`HTTPS off (${e.message}); phone mic needs USB: adb reverse tcp:${PORT} tcp:${PORT}`); }

http.createServer(safeHandle).listen(PORT, "0.0.0.0", () => {
  console.log(`App:   http://localhost:${PORT}`);
  console.log(`Phone: ${phoneUrl()}  (same Wi-Fi)  or USB: adb reverse tcp:${PORT} tcp:${PORT} then http://localhost:${PORT}/phone.html`);
  if (env("MOCK") === "1") console.log("MOCK=1: canned character + song, silent MP3s, no paid calls");
  console.log(`Keys:  Gemma ${env("GEMINI_API_KEY") ? "on" : "DEMO"} | ElevenLabs ${elevenKey() ? "on" : "DEMO"} | memory at ${memUrl("")}`);
  console.log(`Room:  ${audience.code}${env("ROOM_CODE") ? " (ROOM_CODE)" : ""}`);
  // Public any-network link is ON by default whenever cloudflared is there (however the server was started); TUNNEL=0 turns it off.
  if (env("TUNNEL") === "1" || process.argv.includes("--tunnel") || (env("TUNNEL") !== "0" && findCloudflared(here))) {
    tunnelState = "starting";
    console.log("Tunnel: starting a free Cloudflare quick tunnel (any Wi-Fi / 4G)...");
    startTunnel({ port: PORT, appDir: here }).then((url) => {
      if (url) {
        publicUrl = url; tunnelState = "on"; console.log(`Public: ${url}  (phones on ANY network: ${url}/play)`); broadcast({ type: "public-url", publicUrl: url, at: Date.now() });
        makeShortUrl(`${url}/play?code=${audience.code}`).then((s) => { if (!s) return; shortUrl = s; console.log(`Short: ${s}`); broadcast({ type: "public-url", publicUrl: url, shortUrl: s, at: Date.now() }); });
      }
      else tunnelState = "failed";
    }).catch((e) => { tunnelState = "failed"; console.log("[tunnel]", e.message); });
  }
});
