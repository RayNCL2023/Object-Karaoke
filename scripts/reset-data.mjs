// Duet Anything - wipe test data before a demo: npm run reset-data   (add --yes to skip the question, --dry-run to just list)
// Clears: cache/leaderboard.json, roster.json, characters.json, characters/ photos, session photos + audio (cache/s_*),
// and this app's NMAFC memories (NMAFC_AGENT; NMAFC marks them invalidated, so recall stops returning them). Keeps: cache/tts/ and cache/sfx/ audio, designed-voices.json, room code, .env.
// Data folder: DUET_DATA_DIR, else the project folder.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.DUET_DATA_DIR || root;
const args = new Set(process.argv.slice(2));
const dry = args.has("--dry-run");

// Same .env loading as server.mjs (for NMAFC_URL / NMAFC_AGENT).
try {
  for (const line of fs.readFileSync(path.join(dataDir, ".env"), "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env */ }
const NMAFC = (process.env.NMAFC_URL || "http://127.0.0.1:8765").replace(/\/$/, "");
const AGENT = process.env.NMAFC_AGENT || "hackday-manchester";

const cache = path.join(dataDir, "cache");
const files = [];
for (const f of ["leaderboard.json", "roster.json", "characters.json"]) if (fs.existsSync(path.join(cache, f))) files.push(path.join(cache, f));
const charDir = path.join(cache, "characters");
if (fs.existsSync(charDir)) for (const f of fs.readdirSync(charDir)) files.push(path.join(charDir, f));
if (fs.existsSync(cache)) for (const f of fs.readdirSync(cache)) if (/^s_[0-9a-f]+(_[a-z0-9]+)?\.(jpg|mp3)$/i.test(f)) files.push(path.join(cache, f));

async function memories() {
  try {
    const r = await fetch(`${NMAFC}/v1/memories?agent_id=${encodeURIComponent(AGENT)}&limit=1000`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`NMAFC ${r.status}`);
    const j = await r.json();
    return (Array.isArray(j) ? j : j.results || j.memories || []).filter((m) => m && m.invalid_at == null).map((m) => m.id).filter(Boolean); // NMAFC deletes = invalidates
  } catch (e) { console.log(`NMAFC memory not reachable at ${NMAFC} (${e.message}) - skipping memories`); return null; }
}

const ids = args.has("--no-memory") ? null : await memories();
console.log(`Data folder: ${dataDir}`);
console.log(`Will delete ${files.length} cache file(s) and ${ids ? ids.length : 0} NMAFC memories for agent "${AGENT}". Keeps tts/, sfx/, designed voices, room code, .env.`);
if (dry) { for (const f of files) console.log("  " + path.relative(dataDir, f)); process.exit(0); }
if (!args.has("--yes")) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question("Type yes to wipe it: ");
  rl.close();
  if (a.trim().toLowerCase() !== "yes") { console.log("Nothing deleted."); process.exit(0); }
}
let gone = 0;
for (const f of files) { try { fs.rmSync(f, { force: true }); gone++; } catch (e) { console.log(`  could not delete ${f}: ${e.message}`); } }
let memGone = 0;
for (const id of ids || []) {
  try {
    const r = await fetch(`${NMAFC}/v1/memories/${encodeURIComponent(id)}?agent_id=${encodeURIComponent(AGENT)}`, { method: "DELETE", signal: AbortSignal.timeout(5000) });
    if (r.ok) memGone++; else console.log(`  memory ${id}: NMAFC ${r.status}`);
  } catch (e) { console.log(`  memory ${id}: ${e.message}`); }
}
console.log(`Done: ${gone} file(s) and ${memGone} memories deleted. Restart the server so it forgets in-memory sessions too.`);
