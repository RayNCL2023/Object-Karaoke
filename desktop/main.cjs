// Duet Anything desktop app: runs the same server.mjs in-process and shows the stage in a window.
// Phones still join through the web link (shown on the stage, or via "Show phone link").
const { app, BrowserWindow, Menu, Tray, session, nativeImage, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..");
const iconPath = path.join(__dirname, "icon.png");
let mainWin = null, linkWin = null, tray = null, port = 5173;

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });

/** True if nothing is listening on this port (checks the same 0.0.0.0 bind the server uses). */
const portFree = (p) => new Promise((resolve) => {
  const s = net.createServer().once("error", () => resolve(false)).once("listening", () => s.close(() => resolve(true)));
  s.listen(p, "0.0.0.0");
});
async function pickPort() {
  // The server uses PORT (HTTP) and PORT+1 (HTTPS for the phone mic), so both must be free.
  for (let p = 5173; p <= 5180; p++) if ((await portFree(p)) && (await portFree(p + 1))) return p;
  throw new Error("Ports 5173-5181 are all busy");
}

const getJson = (url, timeoutMs = 4000) => new Promise((resolve, reject) => {
  const req = http.get(url, { timeout: timeoutMs }, (res) => {
    let raw = ""; res.on("data", (c) => (raw += c));
    res.on("end", () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
  });
  req.on("timeout", () => req.destroy(new Error("timeout"))); req.on("error", reject);
});
const waitForServer = async (ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const ok = await new Promise((r) => http.get(`http://127.0.0.1:${port}/`, (res) => { res.resume(); r(true); }).on("error", () => r(false)));
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};

/** Windows dev convenience: start NMAFC memory with start-memory.ps1 if it isn't already running. Never fatal. */
function maybeStartMemory() {
  if (process.platform !== "win32" || app.isPackaged) return;
  const script = path.join(root, "start-memory.ps1");
  if (!fs.existsSync(script)) return;
  const probe = http.get("http://127.0.0.1:8765/", (res) => { res.resume(); /* already running */ });
  probe.setTimeout(1500, () => probe.destroy(new Error("timeout")));
  probe.on("error", () => {
    try {
      const ps = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], { cwd: root, windowsHide: true, stdio: "ignore", detached: true });
      ps.on("error", (e) => console.log(`[desktop] memory not started: ${e.message}`));
      ps.unref();
      console.log("[desktop] starting NMAFC memory via start-memory.ps1");
    } catch (e) { console.log(`[desktop] memory not started: ${e.message}`); }
  });
}

function isLocal(url) {
  try { const h = new URL(url).hostname; return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1"; } catch { return false; }
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1440, height: 900, backgroundColor: "#0d0d12", title: "Duet Anything", icon: iconPath,
    autoHideMenuBar: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, autoplayPolicy: "no-user-gesture-required" },
  });
  mainWin.once("ready-to-show", () => mainWin.show());
  mainWin.on("page-title-updated", (e) => e.preventDefault());
  mainWin.webContents.on("before-input-event", (e, input) => {
    if (input.type === "keyDown" && input.key === "F11") { mainWin.setFullScreen(!mainWin.isFullScreen()); e.preventDefault(); }
  });
  // External links open in the real browser; the app only shows localhost pages.
  mainWin.webContents.setWindowOpenHandler(({ url }) => { if (!isLocal(url)) shell.openExternal(url); return { action: isLocal(url) ? "allow" : "deny" }; });
  mainWin.webContents.on("did-finish-load", () => console.log(`[desktop] stage loaded: ${mainWin.webContents.getURL()}`));
  mainWin.webContents.on("did-fail-load", (_e, code, desc, url) => console.log(`[desktop] stage failed to load ${url}: ${desc} (${code})`));
  mainWin.webContents.on("console-message", (_e, level, message) => { if (level >= 3) console.log(`[stage error] ${message}`); });
  if (process.env.DUET_SELFTEST) mainWin.webContents.once("did-finish-load", () => setTimeout(showPhoneLink, 1500));
  mainWin.on("closed", () => { mainWin = null; });
  mainWin.loadURL(`http://localhost:${port}/`);
}

async function showPhoneLink() {
  let micUrl = `http://localhost:${port}/mic.html`;
  try { const s = await getJson(`http://127.0.0.1:${port}/api/status`); micUrl = s.micUrl || s.phoneUrl || micUrl; } catch { /* use fallback */ }
  if (linkWin && !linkWin.isDestroyed()) { linkWin.close(); }
  linkWin = new BrowserWindow({
    width: 420, height: 560, resizable: false, backgroundColor: "#0d0d12", title: "Phone link", icon: iconPath,
    autoHideMenuBar: true, parent: mainWin || undefined,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  linkWin.setMenu(null);
  linkWin.loadFile(path.join(__dirname, "phone-link.html"), { query: { url: micUrl } });
  linkWin.webContents.on("did-finish-load", () => console.log(`[desktop] phone link window open: ${micUrl}`));
  linkWin.on("closed", () => { linkWin = null; });
}

function buildMenus() {
  const template = [
    { label: "Duet Anything", submenu: [
      { label: "Show phone link", accelerator: "CmdOrCtrl+P", click: showPhoneLink },
      { label: "Open stage in browser", click: () => shell.openExternal(`http://localhost:${port}/`) },
      { type: "separator" },
      { label: "Toggle full screen", accelerator: "F11", click: () => mainWin && mainWin.setFullScreen(!mainWin.isFullScreen()) },
      { role: "reload" }, { role: "toggleDevTools" },
      { type: "separator" },
      { role: "quit" },
    ] },
    { role: "editMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  try {
    tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
    tray.setToolTip("Duet Anything");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Show stage", click: () => { if (mainWin) { mainWin.show(); mainWin.focus(); } else createMainWindow(); } },
      { label: "Show phone link", click: showPhoneLink },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]));
    tray.on("click", () => mainWin && mainWin.focus());
  } catch (e) { console.log(`[desktop] no tray: ${e.message}`); }
}

app.whenReady().then(async () => {
  try {
    // Packaged: keep .env, cache/ and certs/ in the user-data folder (the app folder is read-only).
    if (app.isPackaged && !process.env.DUET_DATA_DIR) process.env.DUET_DATA_DIR = app.getPath("userData");
    if (process.env.DUET_DATA_DIR) {
      fs.mkdirSync(process.env.DUET_DATA_DIR, { recursive: true });
      console.log(`[desktop] data folder (.env goes here): ${process.env.DUET_DATA_DIR}`);
    }
    port = process.env.PORT ? Number(process.env.PORT) : await pickPort();
    process.env.PORT = String(port);

    // Microphone for the laptop-mic fallback: allow media for localhost pages only.
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
      const url = (details && details.requestingUrl) || wc.getURL();
      cb(permission === "media" ? isLocal(url) : permission === "clipboard-sanitized-write");
    });
    session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => permission === "media" && isLocal(origin));

    maybeStartMemory();
    await import(pathToFileURL(path.join(root, "server.mjs")).href);
    if (!(await waitForServer())) console.log("[desktop] server did not answer in time, loading anyway");
    buildMenus();
    createMainWindow();
  } catch (e) {
    console.error("[desktop] failed to start:", e);
    app.exit(1);
  }
});

app.on("activate", () => { if (!mainWin) createMainWindow(); });
app.on("window-all-closed", () => app.quit());
// The HTTP/HTTPS servers live in this process, so quitting the app stops them.
app.on("will-quit", () => { if (tray) tray.destroy(); });
