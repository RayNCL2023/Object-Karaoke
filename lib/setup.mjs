// dissPICable - first-launch key setup (for people cloning from GitHub).
// POST /api/setup/test and /api/setup/save. Localhost only, JSON only, keys never logged or echoed back.
import fs from "node:fs";
import path from "node:path";

const KEYS = { gemini: "GEMINI_API_KEY", elevenlabs: "ELEVENLABS_API_KEY" };
const LOCAL = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const keyOk = (k) => typeof k === "string" && /^[A-Za-z0-9_\-.]{10,200}$/.test(k.trim());

export function createSetup({ here, env, readJson, sendJson, fetchImpl = fetch }) {
  const envFile = path.join(here, ".env");
  const needsSetup = () => env("MOCK") !== "1" && (!env("GEMINI_API_KEY") || !env("ELEVENLABS_API_KEY"));
  const isLocal = (req) => {
    if (!LOCAL.has(req.socket?.remoteAddress)) return false;
    // Block DNS-rebinding and cross-site posts: Host must be localhost, Origin (if any) must be localhost too.
    const host = String(req.headers.host || "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
    if (!["localhost", "127.0.0.1", "::1"].includes(host)) return false;
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return false;
    return true;
  };
  /** Shared gate: localhost + JSON body + (keys missing or ?force=1). Returns an error string or null. */
  const gate = (req) => {
    if (!isLocal(req)) return [403, "Setup only works on the laptop running the server (open http://localhost)."];
    if (!/application\/json/i.test(req.headers["content-type"] || "")) return [415, "JSON only"];
    if (!needsSetup() && !/[?&]force=1\b/.test(req.url || "")) return [409, "Keys are already set. Use the Keys link on the stage to change them."];
    return null;
  };

  async function testGemini(key) {
    try {
      const r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(8000) });
      return r.ok;
    } catch { return false; }
  }
  async function testEleven(key) {
    try {
      const r = await fetchImpl("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(8000) });
      return r.ok;
    } catch { return false; }
  }

  /** Update KEY=VALUE lines in .env, keeping every other line as it was. */
  function writeEnv(updates) {
    let lines = [];
    try { lines = fs.readFileSync(envFile, "utf8").replace(/^﻿/, "").split(/\r?\n/); } catch { /* new file */ }
    const left = new Map(Object.entries(updates));
    lines = lines.map((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
      if (m && left.has(m[1])) { const v = left.get(m[1]); left.delete(m[1]); return `${m[1]}=${v}`; }
      return line;
    });
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    for (const [k, v] of left) lines.push(`${k}=${v}`);
    fs.mkdirSync(path.dirname(envFile), { recursive: true });
    fs.writeFileSync(envFile, lines.join("\n") + "\n");
  }

  const routes = {
    "GET /api/setup": async (req, res) => {
      sendJson(res, 200, { needsSetup: needsSetup(), local: isLocal(req), gemini: !!env("GEMINI_API_KEY"), elevenlabs: !!env("ELEVENLABS_API_KEY") });
    },
    "POST /api/setup/test": async (req, res) => {
      const g = gate(req);
      if (g) return sendJson(res, g[0], { error: g[1] });
      const b = await readJson(req);
      const out = {};
      if (b.gemini) out.gemini = keyOk(b.gemini) ? await testGemini(b.gemini.trim()) : false;
      if (b.elevenlabs) out.elevenlabs = keyOk(b.elevenlabs) ? await testEleven(b.elevenlabs.trim()) : false;
      sendJson(res, 200, out); // booleans only, never the keys
    },
    "POST /api/setup/save": async (req, res) => {
      const g = gate(req);
      if (g) return sendJson(res, g[0], { error: g[1] });
      const b = await readJson(req);
      const updates = {};
      for (const [field, name] of Object.entries(KEYS)) {
        if (!b[field]) continue;
        if (!keyOk(b[field])) return sendJson(res, 400, { error: `That ${field === "gemini" ? "Gemini" : "ElevenLabs"} key doesn't look right` });
        updates[name] = b[field].trim();
      }
      if (!Object.keys(updates).length) return sendJson(res, 400, { error: "Paste at least one key" });
      writeEnv(updates);
      Object.assign(process.env, updates); // live now, no restart
      console.log(`[setup] saved ${Object.keys(updates).join(", ")} to .env`);
      sendJson(res, 200, { ok: true, needsSetup: needsSetup(), gemini: !!env("GEMINI_API_KEY"), elevenlabs: !!env("ELEVENLABS_API_KEY") });
    },
  };
  return { routes, needsSetup, isLocal };
}
