// Shared phone event stream. SSE (/api/events) on localhost / Wi-Fi; long-poll (/api/poll) on the Cloudflare tunnel,
// which buffers SSE. Also falls back to polling if SSE hasn't opened within 5 s. Force polling with ?poll=1.
//   const stop = listen((ev) => ..., { onOpen, onError });
export function listen(handler, { onOpen = () => {}, onError = () => {} } = {}) {
  let stopped = false, es = null, timer = null, ctrl = null;
  const deliver = (ev) => { try { handler(ev); } catch (e) { console.error(e); } };
  const forcePoll = /\.trycloudflare\.com$/i.test(location.hostname) || new URLSearchParams(location.search).has("poll");

  function startPoll() {
    if (stopped) return;
    let since = null, delay = 1000, up = false;
    const loop = async () => {
      while (!stopped) {
        try {
          ctrl = new AbortController();
          const url = since == null ? "/api/poll?wait=0" : `/api/poll?since=${since}&wait=25000`;
          const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
          if (!res.ok) throw new Error(`poll ${res.status}`);
          const data = await res.json();
          if (!up) { up = true; onOpen(); }
          delay = 1000;
          if (since != null && data.seq < since) { since = data.seq; continue; } // server restarted
          for (const ev of data.events || []) {
            if (since != null && ev.seq <= since) continue; // de-dupe
            deliver(ev);
            since = ev.seq;
          }
          since = Math.max(since ?? 0, data.seq);
        } catch (e) {
          if (stopped) return;
          up = false; onError(e);
          await new Promise((r) => { timer = setTimeout(r, delay); });
          delay = Math.min(delay * 2, 10000);
        }
      }
    };
    loop();
  }

  function startSse() {
    let opened = false;
    es = new EventSource("/api/events");
    const fallback = setTimeout(() => { if (!opened && !stopped) { es.close(); es = null; startPoll(); } }, 5000);
    es.onopen = () => { opened = true; clearTimeout(fallback); onOpen(); };
    es.onerror = (e) => onError(e); // EventSource reconnects by itself
    es.onmessage = (m) => { let ev; try { ev = JSON.parse(m.data); } catch { return; } deliver(ev); };
  }

  if (forcePoll || typeof EventSource === "undefined") startPoll(); else startSse();
  return () => { stopped = true; es?.close(); ctrl?.abort(); clearTimeout(timer); };
}
