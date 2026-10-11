// dissPICable - first-launch key setup. Keys only ever go to this laptop's own server (localhost).
const $ = (id) => document.getElementById(id);
const force = /[?&]force=1\b/.test(location.search) ? "?force=1" : "";

async function post(url) {
  const body = { gemini: $("gemini").value.trim(), elevenlabs: $("elevenlabs").value.trim() };
  const res = await fetch(url + force, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
function mark(field, ok) {
  const st = $(field + "St");
  if (ok === undefined) { st.textContent = ""; st.className = "st"; return; }
  st.textContent = ok ? "Key works - mint" : "That key didn't work";
  st.className = "st " + (ok ? "ok" : "bad");
}
function busy(on) { $("test").disabled = on; $("save").disabled = on; }

$("test").addEventListener("click", async () => {
  if (!$("gemini").value.trim() && !$("elevenlabs").value.trim()) { $("msg").textContent = "Paste a key first."; return; }
  busy(true); $("msg").textContent = "Testing...";
  try {
    const r = await post("/api/setup/test");
    mark("gemini", r.gemini); mark("elevenlabs", r.elevenlabs);
    $("msg").textContent = Object.values(r).every(Boolean) ? "All good. Hit Save & start." : "Check the key marked above.";
  } catch (e) { $("msg").textContent = e.message; }
  busy(false);
});

$("save").addEventListener("click", async () => {
  busy(true); $("msg").textContent = "Saving...";
  try {
    const r = await post("/api/setup/save");
    $("gemini").value = ""; $("elevenlabs").value = "";
    if (r.needsSetup) { $("msg").textContent = `Saved. Still missing: ${!r.gemini ? "Gemini" : ""}${!r.gemini && !r.elevenlabs ? " and " : ""}${!r.elevenlabs ? "ElevenLabs" : ""}.`; busy(false); return; }
    $("msg").textContent = "Saved. Starting the show...";
    setTimeout(() => location.replace("/stage"), 700);
  } catch (e) { $("msg").textContent = e.message; busy(false); }
});

// Status: is this the laptop? Are keys already there?
fetch("/api/setup").then((r) => r.json()).then((s) => {
  if (!s.local) { $("blocked").style.display = "block"; busy(true); }
  for (const f of ["gemini", "elevenlabs"]) if (s[f]) $(f).placeholder = "already set - leave empty to keep it";
  if (!s.needsSetup && !force) location.replace("/stage");
}).catch(() => {});
