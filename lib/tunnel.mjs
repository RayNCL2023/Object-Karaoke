// dissPICable - optional "any Wi-Fi" public link: a free Cloudflare quick tunnel (no account).
// cloudflared tunnel --url http://localhost:PORT prints an https://*.trycloudflare.com URL with a real
// certificate, so phones on ANY network (even 4G) get the mic without a certificate warning.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

/** Where cloudflared lives: CLOUDFLARED env, next to the exe / app, launcher/bin/, else PATH (non-Windows). */
export function findCloudflared(appDir) {
  const exe = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const tries = [process.env.CLOUDFLARED, path.join(appDir, exe), path.join(appDir, "launcher", "bin", exe), path.join(appDir, "bin", exe)].filter(Boolean);
  return tries.find((f) => fs.existsSync(f)) || null;
}

export const TUNNEL_HELP = `Any-Wi-Fi link is off: cloudflared not found.
  Get it free from https://github.com/cloudflare/cloudflared/releases (cloudflared-windows-amd64.exe),
  rename it to cloudflared.exe and put it in launcher/bin/ (or next to DuetAnything.exe), then run with TUNNEL=1.
  No cloudflared? Turn on the laptop's Mobile hotspot and put the phones on it (the Wi-Fi link on the stage works then).`;

/** Start a quick tunnel. Resolves the https URL, or null if it doesn't come up within timeoutMs. Kills cloudflared on exit. */
export function startTunnel({ port, appDir, timeoutMs = 15000, log = console.log }) {
  const bin = findCloudflared(appDir);
  if (!bin) { log(TUNNEL_HELP); return Promise.resolve(null); }
  return new Promise((resolve) => {
    let done = false;
    const finish = (url) => { if (!done) { done = true; clearTimeout(timer); resolve(url); } };
    let child;
    try {
      child = spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (e) { log(`[tunnel] could not start cloudflared: ${e.message}`); return finish(null); }
    const kill = () => { try { child.kill(); } catch { /* gone */ } };
    process.once("exit", kill);
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) process.once(sig, () => { kill(); process.exit(0); });
    const timer = setTimeout(() => { log(`[tunnel] no public link after ${timeoutMs / 1000}s - using the Wi-Fi links`); kill(); finish(null); }, timeoutMs);
    let buf = "";
    const onData = (d) => {
      buf = (buf + d.toString()).slice(-8000);
      const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (m && !/api\.trycloudflare/i.test(m[0])) finish(m[0]);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (e) => { log(`[tunnel] cloudflared failed: ${e.message}`); finish(null); });
    child.on("exit", (code) => { if (!done) log(`[tunnel] cloudflared exited (${code})`); finish(null); });
  });
}
