// Builds dist/DuetAnything/DuetAnything.exe with Node's Single Executable Applications (SEA).
// 1) esbuild bundles launcher + server + lib into one CommonJS file, 2) Node makes the SEA blob,
// 3) postject injects it into a copy of node.exe. public/ ships next to the exe (served from there).
// Run: npm run build:exe   (needs: npm install, Windows, Node 20+)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "DuetAnything");
const work = path.join(root, "dist", "build");
const exe = path.join(out, "DuetAnything.exe");
const run = (cmd, args) => { console.log(`> ${path.basename(cmd)} ${args.join(" ")}`); execFileSync(cmd, args, { cwd: root, stdio: "inherit" }); };
// Run the tools' own JS entry points with this node (no shell, so the space in the project path is safe).
const tool = (rel, args) => run(process.execPath, [path.join(root, "node_modules", rel), ...args]);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(work, { recursive: true });

// 1. Bundle. DUET_EXE=1 tells the launcher it's the packaged exe (data in %APPDATA%\DuetAnything, public/ next to the exe).
const bundle = path.join(work, "bundle.cjs");
tool("esbuild/bin/esbuild", ["launcher/launch.mjs", "--bundle", "--platform=node", "--format=cjs", "--target=node20",
  `--outfile=${path.relative(root, bundle)}`, "--banner:js=process.env.DUET_EXE='1';", "--log-level=warning", "--log-override:empty-import-meta=silent"]);

// 2. SEA blob.
const blob = path.join(work, "sea-prep.blob");
const seaConfig = path.join(work, "sea-config.json");
fs.writeFileSync(seaConfig, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false }, null, 2));
run(process.execPath, ["--experimental-sea-config", seaConfig]);

// 3. Copy node.exe and inject the blob.
fs.copyFileSync(process.execPath, exe);
tool("postject/dist/cli.js", [exe, "NODE_SEA_BLOB", blob, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"]);

// 4. Files that ship next to the exe.
fs.cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
for (const f of ["start-memory.ps1", "LICENSE", "README.md"]) if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(out, f));
// Any-Wi-Fi tunnel: bundle cloudflared.exe if it is in launcher/bin/ (gitignored; get it from github.com/cloudflare/cloudflared/releases).
const cf = path.join(root, "launcher", "bin", "cloudflared.exe");
if (fs.existsSync(cf)) { fs.copyFileSync(cf, path.join(out, "cloudflared.exe")); console.log("bundled cloudflared.exe (any-Wi-Fi link on by default)"); }
else console.log("no launcher/bin/cloudflared.exe: the exe will use Wi-Fi links only");
fs.writeFileSync(path.join(out, "HOW-TO-RUN.txt"),
`dissPICable for Windows
1. Keep DuetAnything.exe next to the public folder.
2. Double-click DuetAnything.exe. The stage opens in its own Edge window (Chrome or your browser if Edge is missing).
3. First launch: paste your Gemini and ElevenLabs keys on the setup screen. They are saved in %APPDATA%\\DuetAnything\\.env.
4. Phones join with the link shown on the stage. With cloudflared.exe next to the exe that link works on ANY network (even 4G); without it, phones need the same Wi-Fi (or the laptop's Mobile hotspot).
5. Close the black console window to stop.
`);
console.log(`\nBuilt ${exe}`);
