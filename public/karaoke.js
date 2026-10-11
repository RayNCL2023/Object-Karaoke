// Duet Anything - karaoke SONG PICKER (stage idle, karaoke mode) + REAL SONGS runner (embedded YouTube karaoke video).
// Copyright rule: we only store originals (Gemma writes them) or public-domain lyrics. Real songs are an embedded
// official karaoke video via the YouTube IFrame Player API: embed only, player visible with its own controls/branding.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j; });

  // ---------- styles (own file so the stage CSS bot's work is untouched) ----------
  const css = document.createElement("style");
  css.textContent = `
  .cap.parted .cap-who { background: var(--singer) !important; color: #111 !important; outline: 4px solid #111; outline-offset: -4px; }
  .cap.parted .w.on .wi, .cap.parted.obj .w .wi { color: var(--singer); -webkit-text-stroke: 2px #111; paint-order: stroke fill; }
  body.kpick-on #joinCard { transform: scale(.42); transform-origin: top right; transition: transform .3s ease; }
  #kpick { position: absolute; right: 40px; top: 398px; width: 800px; max-height: 668px; overflow: hidden; z-index: 40; background: #fff8e7; color: #111; border: 6px solid #111; box-shadow: 14px 14px 0 #111; transform: rotate(-0.6deg); padding: 14px 20px 12px; font-family: var(--mono, ui-monospace, monospace); display: none; }
  #kpick.on { display: block; }
  #kpick h2 { margin: 0 0 2px; font: 900 36px/1 var(--display, Impact, sans-serif); letter-spacing: .02em; text-transform: uppercase; }
  #kpick .sub { font-size: 15px; margin-bottom: 6px; }
  #kpick .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; }
  #kpick .col h3 { margin: 4px 0 3px; font-size: 14px; letter-spacing: .1em; background: #111; color: #ffd400; display: inline-block; padding: 3px 10px; transform: rotate(-1.5deg); }
  #kpick .col.yt { grid-column: 1 / -1; }
  #kpick ul { list-style: none; margin: 0; padding: 0; }
  #kpick .col.yt ul { columns: 2; column-gap: 18px; }
  #kpick li { font-size: 16px; padding: 1px 6px; cursor: pointer; border: 3px solid transparent; break-inside: avoid; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #kpick li small { opacity: .6; font-size: 12px; }
  #kpick li.sel { background: #ffd400; border-color: #111; transform: rotate(-0.8deg); }
  #kpick .row { display: flex; gap: 10px; margin-top: 8px; align-items: center; flex-wrap: wrap; }
  #kpick input { flex: 1; min-width: 260px; font: 16px var(--mono, monospace); padding: 6px 10px; border: 4px solid #111; background: #fff; }
  #kpick button { font: 900 18px var(--display, Impact, sans-serif); letter-spacing: .05em; padding: 6px 14px; border: 4px solid #111; background: #fff; cursor: pointer; box-shadow: 5px 5px 0 #111; }
  #kpick button.go { background: #ff4fa3; color: #fff; }
  #kpick button.sur { background: #2ee6a6; }
  #kpick .who { font-size: 15px; margin-top: 6px; }
  #kpick .who b { padding: 1px 8px; border: 3px solid #111; margin-right: 6px; display: inline-block; }
  #kpick .busy { font-size: 22px; font-weight: 900; margin-top: 10px; color: #c2185b; }
  #kyt { position: absolute; left: 640px; top: 120px; width: 1240px; z-index: 45; display: none; }
  #kyt.on { display: block; }
  #kyt .frame { width: 1240px; height: 698px; background: #000; border: 6px solid #111; box-shadow: 14px 14px 0 #111; }
  #kyt .frame { position: relative; } #kyt .frame iframe, #kyt #kytPlayer { width: 100%; height: 100%; display: block; }
  #kyt .bar { display: flex; gap: 12px; align-items: center; margin-top: 18px; flex-wrap: wrap; font-family: var(--mono, monospace); }
  #kyt .chip { font: 900 24px var(--display, Impact, sans-serif); padding: 6px 14px; border: 4px solid #111; background: #fff; color: #111; opacity: .45; }
  #kyt .chip.on { opacity: 1; transform: rotate(-2deg) scale(1.08); box-shadow: 6px 6px 0 #111; }
  #kyt button { font: 900 20px var(--display, Impact, sans-serif); padding: 8px 14px; border: 4px solid #111; background: #ffd400; cursor: pointer; }
  #kyt .msg { margin-left: 8px; font: 900 30px var(--display, Impact, sans-serif); color: #fff; text-shadow: 3px 3px 0 #111; min-height: 40px; }
  #kyt .heckle { position: absolute; left: -40px; top: -70px; max-width: 760px; background: #fff; color: #111; border: 5px solid #111; padding: 10px 16px; font: 900 28px var(--display, Impact, sans-serif); transform: rotate(-2deg); box-shadow: 8px 8px 0 #111; opacity: 0; transition: opacity .25s ease, transform .25s ease; }
  #kyt .heckle.on { opacity: 1; transform: rotate(-2deg) translateY(-6px); }
  #kyt .err { position: absolute; inset: 6px; display: none; place-items: center; text-align: center; background: #111; color: #ffd400; font: 900 44px var(--display, Impact, sans-serif); padding: 40px; }
  #kyt .err.on { display: grid; }`;
  document.head.appendChild(css);

  // ---------- song picker ----------
  let mode = "battle", data = null, flat = [], sel = -1, busy = false, lastLoad = 0;
  const pick = document.createElement("div");
  pick.id = "kpick";
  document.body.appendChild(pick);
  fetch("/api/mode").then((r) => r.json()).then((j) => { mode = j.mode || mode; }).catch(() => {});
  try { const es = new EventSource("/api/events"); es.onmessage = (e) => { try { const ev = JSON.parse(e.data); if (ev.type === "mode") mode = ev.mode; if (ev.type === "players" || ev.type === "song-ready") lastLoad = 0; if (ev.type === "karaoke-building") { busy = true; render(); } if (ev.type === "song-ready" || ev.type === "reset" || ev.type === "error") { busy = false; } } catch {} }; } catch {}

  const visible = () => document.body.dataset.screen === "idle" && mode === "karaoke";
  async function load() {
    lastLoad = Date.now();
    try { data = await (await fetch("/api/songs")).json(); render(); } catch {}
  }
  function render() {
    if (!data) return;
    flat = [...data.originals, ...data.classics, ...data.youtube];
    const armedId = data.armed?.id || (data.armed?.videoId ? "yt:" + data.armed.videoId : null);
    if (sel < 0 && armedId) sel = flat.findIndex((s) => s.id === armedId);
    const li = (s, i) => `<li data-i="${i}" class="${i === sel ? "sel" : ""}">${esc(s.title)} ${s.artist ? `<small>· ${esc(s.artist)}</small>` : s.year ? `<small>· ${esc(s.year)}</small>` : `<small>· ${esc(s.genre || "")}</small>`}</li>`;
    let i = 0;
    const col = (title, list, cls = "") => `<div class="col ${cls}"><h3>${title}</h3><ul>${list.map((s) => li(s, i++)).join("") || "<li><small>(none yet - paste a link below)</small></li>"}</ul></div>`;
    const ps = data.players || [];
    const partner = data.snap ? `${esc(data.snap.name)} the ${esc(data.snap.object)}` : "Karaoke Kev (snap something to swap in your object)";
    const who = !ps.length ? `Nobody's joined: <b style="background:#ff4fa3">AI DEMO</b> ${partner} sings it all. Scan the QR + BATTLE to sing.`
      : ps.length === 1 ? `<b style="background:${esc(ps[0].colour)}">${esc(ps[0].name)}</b> duets with ${partner} (chorus together)`
      : `${ps.map((p, k) => `<b style="background:${esc(p.colour)}">P${k + 1} ${esc(p.name)}</b>`).join("")} take turns on verses · chorus = EVERYONE`;
    pick.innerHTML = `<h2>Pick a song</h2><div class="sub">↑↓ choose · Enter START · S surprise me · or snap your object first</div>
      <div class="cols">${col("BRITISH BANGERS (ORIGINALS)", data.originals)}${col("CLASSICS (OUT OF COPYRIGHT)", data.classics)}${col("REAL SONGS (YOUTUBE KARAOKE)", data.youtube, "yt")}</div>
      <div class="row"><input id="kpYt" placeholder="…or paste any YouTube karaoke link" /><button id="kpYtGo">PLAY LINK</button><button class="sur" id="kpSur">SURPRISE ME</button><button class="go" id="kpGo">START ▶</button></div>
      <div class="who">${who}</div>${busy ? `<div class="busy">Warming up the band…</div>` : ""}`;
    pick.querySelectorAll("li[data-i]").forEach((n) => { n.onclick = () => choose(+n.dataset.i); n.ondblclick = () => go(); });
    $("kpGo").onclick = () => go();
    $("kpSur").onclick = () => surprise();
    $("kpYtGo").onclick = () => go({ youtube: $("kpYt").value.trim() });
    $("kpYt").onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") go({ youtube: e.target.value.trim() }); };
  }
  function choose(i) {
    sel = Math.max(0, Math.min(flat.length - 1, i));
    const s = flat[sel];
    pick.querySelectorAll("li[data-i]").forEach((n) => n.classList.toggle("sel", +n.dataset.i === sel));
    clearTimeout(choose.t);
    choose.t = setTimeout(() => s && post("/api/karaoke/pick", { songId: s.id }).catch(() => {}), 250); // armed: a snap now uses this song
  }
  async function go(extra) {
    if (busy) return;
    const body = extra?.youtube ? { youtube: extra.youtube } : extra?.songId ? { songId: extra.songId } : flat[sel] ? { songId: flat[sel].id } : null;
    if (!body) return toastMsg("Pick a song first");
    if (body.youtube !== undefined && !body.youtube) return toastMsg("Paste a YouTube link first");
    busy = true; render();
    try { await post("/api/karaoke/start" + (/[?&]mock=1/.test(location.search) ? "?mock=1" : ""), body); }
    catch (e) { toastMsg(String(e.message || e)); }
    finally { busy = false; }
  }
  const surprise = () => go({ songId: "surprise" });
  function toastMsg(m) { const t = $("toast"); if (!t) return; t.textContent = m; t.classList.add("on"); setTimeout(() => t.classList.remove("on"), 2600); }
  setInterval(() => {
    const v = visible();
    pick.classList.toggle("on", v);
    document.body.classList.toggle("kpick-on", v);
    if (v && Date.now() - lastLoad > 5000) load();
  }, 500);
  addEventListener("keydown", (e) => {
    if (!visible() || e.target.tagName === "INPUT") return;
    if (e.key === "ArrowDown") { e.preventDefault(); choose(sel + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); choose(sel - 1); }
    else if (e.key === "Enter") { e.preventDefault(); go(); }
    else if (e.key === "s" || e.key === "S") surprise();
  });

  // ---------- REAL SONGS: YouTube runner ----------
  let ytReady = null;
  function loadYT() {
    if (window.YT?.Player) return Promise.resolve(true);
    if (ytReady) return ytReady;
    ytReady = new Promise((res) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { try { prev?.(); } catch {} res(true); };
      const sc = document.createElement("script"); sc.src = "https://www.youtube.com/iframe_api"; sc.onerror = () => res(false);
      document.head.appendChild(sc);
      setTimeout(() => res(!!window.YT?.Player), 9000);
    });
    return ytReady;
  }
  const box = document.createElement("div");
  box.id = "kyt";
  document.body.appendChild(box);
  let asked = {};

  async function run(s, ctx) {
    const singers = s.singers || [];
    const yt = s.youtube;
    asked = {};
    let cur = 0, everyone = singers.length < 2, ended = false, failed = false, chunk = 0;
    box.innerHTML = `<div class="frame"><div id="kytPlayer"></div><div class="err" id="kytErr">This video can't be embedded — paste another link</div></div>
      <div class="heckle" id="kytHeckle"></div>
      <div class="bar">${singers.map((p, k) => `<span class="chip" data-k="${k}" style="background:${esc(p.colour)}">P${k + 1} ${esc(p.name)}</span>`).join("") || `<span class="chip on" style="background:#ff4fa3">AI DEMO · join to sing</span>`}
      ${singers.length > 1 ? `<button id="kytPass">PASS MIC (P)</button><button id="kytAll">EVERYONE (E)</button>` : ""}<button id="kytEnd">END SONG (X)</button><span class="msg" id="kytMsg"></span></div>`;
    box.classList.add("on");
    const chips = () => box.querySelectorAll(".chip[data-k]").forEach((c) => c.classList.toggle("on", everyone || +c.dataset.k === cur));
    const msg = (t) => { $("kytMsg").textContent = t; };
    const pass = () => { everyone = false; cur = (cur + 1) % Math.max(1, singers.length); chips(); msg(`${String(singers[cur]?.name || "").toUpperCase()}: YOUR TURN`); lastTurn = Date.now(); };
    const all = () => { everyone = !everyone; chips(); msg(everyone ? "EVERYONE SING!" : `${String(singers[cur]?.name || "").toUpperCase()}: YOUR TURN`); };
    let lastTurn = Date.now();
    if ($("kytPass")) $("kytPass").onclick = pass;
    if ($("kytAll")) $("kytAll").onclick = all;
    $("kytEnd").onclick = () => { ended = true; };
    const keys = (e) => { if (e.key === "p" || e.key === "P") pass(); else if (e.key === "e" || e.key === "E") all(); else if (e.key === "x" || e.key === "X") ended = true; };
    addEventListener("keydown", keys);
    chips();
    let player = null;
    try {
      const ok = await loadYT();
      ctx.guard();
      if (ok) {
        await new Promise((res) => {
          player = new YT.Player("kytPlayer", {
            videoId: yt.videoId, width: 1228, height: 686,
            playerVars: { autoplay: 1, controls: 1, rel: 0, playsinline: 1, modestbranding: 1, origin: location.origin, widget_referrer: location.href },
            events: {
              onReady: (e) => { try { e.target.setVolume(85); e.target.playVideo(); } catch {} res(); },
              onStateChange: (e) => { if (e.data === 0) ended = true; },
              onError: (e) => { console.warn("[karaoke] YouTube error", e.data); if ([2, 5, 100, 101, 150].includes(e.data)) { failed = true; $("kytErr").classList.add("on"); } res(); },
            },
          });
          setTimeout(res, 8000);
        });
      } else { failed = !s.mock; if (failed) $("kytErr").classList.add("on"); }
      if (failed) { msg("Can't be embedded — paste another link on the picker"); await ctx.sleep(3500); ctx.guard(); return; }
      ctx.listen(true);
      msg(singers.length ? (singers.length > 1 && everyone ? "EVERYONE SING!" : `${String(singers[cur].name).toUpperCase()}: YOUR TURN`) : "AI DEMO — scan the QR + BATTLE to sing");
      const maxMs = Math.min(300000, ((player?.getDuration?.() || 0) * 1000) || (s.mock ? 36000 : 240000));
      const t0 = Date.now();
      let heckled = 0;
      while (!ended && Date.now() - t0 < maxMs) {
        ctx.guard();
        const ms = (yt.chunkMs || 8000) - 400;
        if (singers.length) {
          const target = everyone ? { all: true } : { player: singers[cur].id, playerName: singers[cur].name, playerColour: singers[cur].colour };
          (everyone ? singers : [singers[cur]]).forEach((p) => { asked[p.id] = (asked[p.id] || 0) + 1; });
          ctx.broadcast({ type: "record-start", id: s.id, line: chunk++, ms, ...target });
        }
        await ctx.sleep(yt.chunkMs || 8000);
        // Auto-rotate each ~30 s verse, and the character heckles between verses (max 3).
        if (Date.now() - lastTurn > (yt.turnMs || 30000)) {
          if (singers.length > 1 && !everyone) pass(); else lastTurn = Date.now();
          if (heckled++ < 3) heckle(s, ctx, player).catch(() => {});
        }
      }
    } finally {
      removeEventListener("keydown", keys);
      ctx.listen(false);
      try { player?.destroy?.(); } catch {}
      box.classList.remove("on"); box.innerHTML = "";
    }
  }
  async function heckle(s, ctx, player) {
    const h = await post("/api/karaoke/heckle", { id: s.id });
    const b = $("kytHeckle"); if (!b) return;
    b.textContent = `${s.character?.name || "AI"}: ${h.text}`; b.classList.add("on");
    try { player?.setVolume?.(30); } catch {}
    ctx.sing(true);
    try {
      if (h.audio && !h.ttsFailed) await ctx.playMp3(h.audio, h.ms || 4000);
      else await ctx.speak(h.text, h.ms || 3000);
    } catch {} finally { ctx.sing(false); try { player?.setVolume?.(85); } catch {} b.classList.remove("on"); }
  }
  window.KaraokeYT = { run, asked: () => ({ ...asked }) };
})();
