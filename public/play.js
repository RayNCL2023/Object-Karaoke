// Duet Anything - /play: room code + name, then BATTLE (player on the mic, lib/players.mjs) or JUDGE (crowd, join.html).
const $ = (id) => document.getElementById(id);
const STORE = "duetPlayer";
const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { return {}; } };
const save = (o) => { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch { /* private mode */ } };
const buzz = (p) => { try { navigator.vibrate?.(p); } catch { /* not supported */ } };
let me = load(); // { playerId, name, code }

// Phones only allow the mic on a secure page: if someone opened the plain http Wi-Fi link (e.g. scanned the QR
// before the public link was ready), ask the server for the secure link and jump to it.
if (!window.isSecureContext && location.protocol === "http:" && !/^(localhost|127\.)/.test(location.hostname)) {
  fetch("/api/status").then((r) => r.json()).then((s) => {
    const secure = s.publicUrl ? `${s.publicUrl}/play` : `https://${location.hostname}:${Number(location.port || 80) + 1}/play`;
    location.replace(secure + location.search);
  }).catch(() => location.replace(`https://${location.hostname}:${Number(location.port || 80) + 1}/play${location.search}`));
}
const qs = new URLSearchParams(location.search);
$("code").value = (qs.get("code") || me.code || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
$("name").value = me.name || qs.get("name") || "";
$("code").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ""); });

function read() {
  const code = $("code").value.trim().toUpperCase(), name = $("name").value.trim();
  if (!code || !name) { $("err").textContent = "Need the room code and your name"; return null; }
  $("err").textContent = "";
  return { code, name };
}
async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

$("battleBtn").addEventListener("click", async () => {
  const f = read();
  if (!f) return;
  $("battleBtn").disabled = true;
  buzz(30);
  try {
    const r = await post("/api/players/join", { ...f, playerId: me.playerId });
    me = { playerId: r.player.id, name: r.player.name, code: f.code };
    save(me);
    // The mic needs a secure page: USB/localhost is already secure, Wi-Fi goes to the HTTPS link (port + 1).
    let mic = `${location.origin}/mic.html`;
    if (!["localhost", "127.0.0.1"].includes(location.hostname)) {
      try { const s = await (await fetch("/api/status")).json(); if (s.micUrl) mic = s.micUrl; } catch { /* mic.js jumps to https itself */ }
    }
    const u = new URL(mic, location.href);
    u.search = new URLSearchParams({ code: f.code, name: r.player.name, pid: r.player.id, colour: r.player.colour }).toString();
    location.href = u.toString();
  } catch (e) {
    $("err").textContent = e.message;
    $("battleBtn").disabled = false;
  }
});

$("judgeBtn").addEventListener("click", () => {
  const f = read();
  if (!f) return;
  save({ ...me, name: f.name, code: f.code });
  buzz(20);
  location.href = `/join.html?${new URLSearchParams({ code: f.code, name: f.name })}`;
});

// ---------- TEST MIC (any time; real check happens again on the secure mic page) ----------
import("./mictest.js").then(({ openMicTest, paintChips }) => {
  paintChips();
  document.addEventListener("click", (e) => {
    if (!e.target.closest?.("[data-mic-test]")) return;
    let client = null;
    try { client = localStorage.getItem("duetClientId"); } catch { /* private mode */ }
    openMicTest({ report: (ok) => post("/api/broadcast", { type: "mic-check", client, player: me.playerId, playerName: me.name || $("name").value.trim(), ok }).catch(() => {}) });
  });
});
