// Duet Anything Windows launcher: starts server.mjs in this process, then opens the stage in
// Microsoft Edge app mode (its own clean window, no browser bars). Falls back to Chrome, then the default browser.
// From source: `npm run app`. Packaged: DuetAnything.exe (built by launcher/build-exe.mjs) runs this same file.
import fs from "node:fs";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findCloudflared, TUNNEL_HELP } from "../lib/tunnel.mjs";

// Packaged exe = process.execPath is DuetAnything.exe (not node.exe); the SEA build also sets DUET_EXE in the bundle banner.
const isExe = process.env.DUET_EXE === "1" || !/^node(\.exe)?$/i.test(path.basename(process.execPath));
const appDir = isExe ? path.dirname(process.execPath) : path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const log = (m) => console.log(`[launcher] ${m}`);

const portFree = (p) => new Promise((resolve) => {
  const s = net.createServer().once("error", () => resolve(false)).once("listening", () => s.close(() => resolve(true)));
  s.listen(p, "0.0.0.0");
});
async function pickPort() {
  // The server uses PORT (HTTP) and PORT+1 (HTTPS for the phone mic), so both must be free.
  for (let p = 5173; p <= 5190; p++) if ((await portFree(p)) && (await portFree(p + 1))) return p;
  throw new Error("Ports 5173-5191 are all busy");
}

const answers = (url, ms = 1500) => new Promise((r) => {
  const req = http.get(url, { timeout: ms }, (res) => { res.resume(); r(true); });
  req.on("timeout", () => req.destroy(new Error("timeout"))); req.on("error", () => r(false));
});
async function waitForServer(port, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await answers(`http://127.0.0.1:${port}/api/status`, 3000)) return true; await new Promise((r) => setTimeout(r, 200)); }
  return false;
}

/** Dev convenience: start NMAFC memory with start-memory.ps1 if 8765 isn't answering. Never fatal. */
async function maybeStartMemory() {
  const script = path.join(appDir, "start-memory.ps1");
  if (process.platform !== "win32" || !fs.existsSync(script) || !fs.existsSync(path.join(appDir, ".env"))) return;
  if (await answers("http://127.0.0.1:8765/")) return;
  try {
    const ps = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], { cwd: appDir, windowsHide: true, stdio: "ignore", detached: true });
    ps.on("error", (e) => log(`memory not started: ${e.message}`));
    ps.unref();
    log("starting NMAFC memory via start-memory.ps1");
  } catch (e) { log(`memory not started: ${e.message}`); }
}

function findBrowser() {
  const pf = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const edge = pf.map((d) => path.join(d, "Microsoft", "Edge", "Application", "msedge.exe")).find((f) => fs.existsSync(f));
  if (edge) return { name: "Edge", exe: edge };
  const chrome = pf.map((d) => path.join(d, "Google", "Chrome", "Application", "chrome.exe")).find((f) => fs.existsSync(f));
  if (chrome) return { name: "Chrome", exe: chrome };
  return null;
}

function openStage(url, dataDir) {
  if (process.env.DUET_NO_BROWSER === "1") return log("DUET_NO_BROWSER=1: not opening a window");
  const b = findBrowser();
  if (b) {
    // Own profile folder: opens as its own window (not a tab in your normal browser) and remembers the mic permission.
    const profile = path.join(dataDir, "browser-profile");
    fs.mkdirSync(profile, { recursive: true });
    const child = spawn(b.exe, [`--app=${url}`, "--window-size=1440,900", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required"], { stdio: "ignore", detached: true });
    child.on("error", (e) => { log(`${b.name} failed (${e.message}); opening default browser`); defaultBrowser(url); });
    child.unref();
    log(`stage opened in ${b.name} app window`);
  } else defaultBrowser(url);
}
function defaultBrowser(url) {
  spawn("cmd.exe", ["/c", "start", "", url], { stdio: "ignore", detached: true, windowsHide: true }).unref();
  log("stage opened in your default browser");
}

async function main() {
  // .env, cache/, certs/ and the browser profile: %APPDATA%\DuetAnything for the exe, the project folder from source.
  if (!process.env.DUET_DATA_DIR) process.env.DUET_DATA_DIR = isExe ? path.join(process.env.APPDATA || appDir, "DuetAnything") : appDir;
  const dataDir = process.env.DUET_DATA_DIR;
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.DUET_APP_DIR = appDir;
  const port = process.env.PORT ? Number(process.env.PORT) : await pickPort();
  process.env.PORT = String(port);
  log(`app folder: ${appDir}`);
  log(`data folder (.env goes here): ${dataDir}`);

  // Any-Wi-Fi link: TUNNEL defaults ON when cloudflared is bundled (launcher/bin/ or next to the exe). TUNNEL=0 in .env turns it off.
  if (process.env.TUNNEL === undefined) {
    let envTunnel = "";
    try { envTunnel = (fs.readFileSync(path.join(dataDir, ".env"), "utf8").match(/^\s*TUNNEL\s*=\s*(\S*)/m) || [])[1] || ""; } catch { /* no .env yet */ }
    if (!envTunnel && findCloudflared(appDir)) process.env.TUNNEL = "1";
    else if (!envTunnel) log(TUNNEL_HELP);
  }
  if (!isExe) await maybeStartMemory();
  await import("../server.mjs");
  if (!(await waitForServer(port))) log("server did not answer in time, opening anyway");
  openStage(`http://localhost:${port}/stage`, dataDir);
  console.log("\nDuet Anything is running. Phones join with the link on the stage.");
  console.log(`Reopen the stage: http://localhost:${port}/stage`);
  console.log("Close this window to stop.\n");
}

main().catch((e) => { console.error("[launcher] failed to start:", e); setTimeout(() => process.exit(1), 8000); });
