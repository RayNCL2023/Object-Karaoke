// Hack day starter: one Node file, no packages to install. Run: node server.mjs
// Serves public/ and a small API so the page (and a phone) can use Gemma 4, ElevenLabs and NMAFC memory.
// API keys stay here on the server; the browser never sees them.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDuet } from "./lib/duet.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// Load .env (KEY=VALUE lines).
const envFile = path.join(here, ".env");
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
async function gemma({ prompt, image, json = false, temperature = 0.8, maxTokens = 2048 }) {
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
      method: "POST",
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
  const res = await fetch(`${ELEVEN}/voices`, { headers: { "xi-api-key": elevenKey() } });
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
    method: "POST",
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
    method: "POST",
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
function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of listeners) res.write(line);
}

// ---------- HTTP ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ico": "image/x-icon" };

const readJson = (req) => new Promise((resolve, reject) => {
  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 15e6) req.destroy(); });
  req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
});
const sendJson = (res, code, obj) => res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(obj));

const duet = createDuet({ here, env, gemma, voices, remember, recall, broadcast: (e) => broadcast(e), readJson, sendJson });

const routes = {
  ...duet.routes,
  "POST /api/broadcast": async (req, res) => { broadcast({ ...(await readJson(req)), at: Date.now() }); sendJson(res, 200, { ok: true, listeners: listeners.size }); },
  "POST /api/gemma": async (req, res) => sendJson(res, 200, await gemma(await readJson(req))),
  "POST /api/speak": async (req, res) => res.writeHead(200, { "Content-Type": "audio/mpeg" }).end(await speak(await readJson(req))),
  "POST /api/sfx": async (req, res) => res.writeHead(200, { "Content-Type": "audio/mpeg" }).end(await sfx(await readJson(req))),
  "GET /api/voices": async (req, res) => sendJson(res, 200, await voices()),
  "POST /api/memory/remember": async (req, res) => sendJson(res, 200, await remember((await readJson(req)).text)),
  "POST /api/memory/search": async (req, res) => sendJson(res, 200, await recall((await readJson(req)).query)),
  "GET /api/memory/list": async (req, res) => sendJson(res, 200, await listMemories()),
  "POST /api/phone": async (req, res) => { broadcast({ ...(await readJson(req)), at: Date.now() }); sendJson(res, 200, { ok: true, listeners: listeners.size }); },
  "GET /api/events": async (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(": connected\n\n");
    listeners.add(res);
    req.on("close", () => listeners.delete(res));
  },
  "GET /api/status": async (req, res) => {
    let memory = false;
    try { await mem("/v1/memories/search", { agent_id: agent(), query: "ping", limit: 1 }, 3000); memory = true; } catch { /* not running */ }
    sendJson(res, 200, { gemma: !!env("GEMINI_API_KEY"), elevenlabs: !!elevenKey(), memory, phoneUrl: phoneUrl(), micUrl: phoneUrl().replace("/phone.html", "/mic.html"), mock: env("MOCK") === "1" });
  },
};

/** The Wi-Fi/LAN address a phone can reach (private ranges first, so VPN addresses like 100.x are skipped). */
function lanIp() {
  const all = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a.address);
  return all.find((ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) || all[0] || "localhost";
}
const phoneUrl = () => `http://${lanIp()}:${PORT}/phone.html`;

http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const route = routes[`${req.method} ${urlPath}`];
  if (!route && req.method === "GET" && duet.serveCache(urlPath, res)) return;
  if (route) {
    try { await route(req, res); }
    catch (e) { console.error(`[${urlPath}]`, e.message); if (!res.headersSent) sendJson(res, 500, { error: e.message }); }
    return;
  }
  const file = path.join(here, "public", urlPath === "/" ? "index.html" : urlPath);
  if (!file.startsWith(path.join(here, "public")) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end("Not found");
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, "0.0.0.0", () => {
  console.log(`App:   http://localhost:${PORT}`);
  console.log(`Phone: ${phoneUrl()}  (same Wi-Fi)  or USB: adb reverse tcp:${PORT} tcp:${PORT} then http://localhost:${PORT}/phone.html`);
  if (env("MOCK") === "1") console.log("MOCK=1: canned character + song, silent MP3s, no paid calls");
  console.log(`Keys:  Gemma ${env("GEMINI_API_KEY") ? "on" : "DEMO"} | ElevenLabs ${elevenKey() ? "on" : "DEMO"} | memory at ${memUrl("")}`);
});
