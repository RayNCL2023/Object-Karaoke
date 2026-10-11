// Test page: one button per feature so you can check everything works before building the real idea.
import { gemma, speak, sfx, voices, remember, recall, listMemories, status, onPhone } from "./api.js";

const $ = (id) => document.getElementById(id);
const show = (el, v) => (el.textContent = typeof v === "string" ? v : JSON.stringify(v, null, 2));
const busy = async (btn, fn) => {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "…";
  try { await fn(); } catch (e) { alert(e.message); } finally { btn.disabled = false; btn.textContent = label; }
};

status().then((s) => {
  $("status").innerHTML = ["gemma", "elevenlabs", "memory"]
    .map((k) => `<span class="${s[k] ? "on" : "off"}">${k}</span>`).join("");
  $("phoneLink").href = $("phoneLink").textContent = s.phoneUrl;
});

voices().then((list) => {
  $("voice").innerHTML = list.map((v) => `<option value="${v.id}">${v.name}</option>`).join("");
}).catch(() => { $("voice").innerHTML = "<option>no voices (key?)</option>"; });

$("ask").onclick = () => busy($("ask"), async () => {
  const r = await gemma($("prompt").value, { json: $("asJson").checked, image: $("image").files[0] });
  show($("gemmaOut"), r.json ?? r.text);
});
$("speak").onclick = () => busy($("speak"), async () => new Audio(await speak($("say").value, $("voice").value)).play());
$("sfx").onclick = () => busy($("sfx"), async () => new Audio(await sfx($("sfxPrompt").value)).play());
$("remember").onclick = () => busy($("remember"), async () => show($("memOut"), await remember($("fact").value)));
$("recall").onclick = () => busy($("recall"), async () => show($("memOut"), await recall($("query").value)));
$("listMem").onclick = () => busy($("listMem"), async () => show($("memOut"), await listMemories()));

const log = [];
onPhone((e) => {
  log.unshift(JSON.stringify(e));
  show($("phoneOut"), log.slice(0, 12).join("\n"));
});
