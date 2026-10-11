// Duet Anything - player lobby (phones that rap) + the match the host picks on the stage.
// Players join from /play with the room code, then open the mic page with ?pid=. Max 8, in memory.
// match = { type: "object", current } (VS THE OBJECT, current = who's up, rotates after each battle)
//       | { type: "pvp", players: [p1, p2] } (PLAYER vs PLAYER).
// Events: players { players, match }.
const MAX_PLAYERS = 8;
const STALE_MS = 40 * 1000; // a mic page pings every 10 s; drop phones gone for 40 s (closed tab, lost signal)
const BOOT = Date.now().toString(36); // changes on every server restart: phones reset when they see a new one
const COLOURS = ["#ff4f9a", "#ffd400", "#3b6fe0", "#2f8f6a", "#ff7a1a", "#8a5cff", "#e23b4e", "#00b3b3"];
const BLOCK = /(fuck|shit|cunt|nigg|fag|twat|wank|dick|cock|pussy|bitch|slut|whore|rape|nazi|hitler|retard|paki|spast)/i;
const cleanName = (s) => {
  const n = String(s || "").replace(/[^\p{L}\p{N} '._-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 16);
  return !n || BLOCK.test(n.replace(/[^a-z]/gi, "")) ? "" : n;
};
const newId = () => "p_" + Math.random().toString(36).slice(2, 10);

export function createPlayers({ broadcast, readJson, sendJson, roomCode }) {
  const players = new Map(); // id -> { id, name, colour, joinedAt, lastSeen }
  let match = { type: "object", current: null };
  setInterval(() => { if (prune()) announce(); }, 10000).unref?.(); // drop gone phones even when nobody asks
  const pub = (p) => ({ id: p.id, name: p.name, colour: p.colour });
  const list = () => [...players.values()].sort((a, b) => a.joinedAt - b.joinedAt);

  function prune() {
    const now = Date.now();
    let changed = false;
    for (const p of players.values()) if (now - p.lastSeen > STALE_MS) { players.delete(p.id); changed = true; }
    if (changed) fixMatch();
    return changed;
  }
  /** Keep the match pointing at players who still exist (default: first in the queue). */
  function fixMatch() {
    const ids = list().map((p) => p.id);
    if (match.type === "pvp" || match.type === "ovo") match.players = (match.players || []).filter((id) => players.has(id));
    if (match.type === "object" && !players.has(match.current)) match.current = ids[0] || null;
  }
  const snapshot = () => ({ players: list().map(pub), match: { ...match }, max: MAX_PLAYERS });
  const announce = () => broadcast({ type: "players", ...snapshot(), at: Date.now() });

  function upsert(b) {
    if (String(b.code || "").trim().toUpperCase() !== roomCode()) return { code: 403, error: "Wrong room code - check the big screen" };
    const name = cleanName(b.name);
    if (!name) return { code: 400, error: "Pick a different name" };
    prune();
    let p = b.playerId && players.get(String(b.playerId));
    if (!p) {
      if (players.size >= MAX_PLAYERS) return { code: 409, error: "8 players max - join as a JUDGE instead!" };
      const used = new Set(list().map((x) => x.colour));
      const id = /^p_[a-z0-9]{4,12}$/.test(String(b.playerId || "")) ? String(b.playerId) : newId(); // same id after a server restart
      p = { id, joinedAt: Date.now(), colour: COLOURS.find((c) => !used.has(c)) || COLOURS[players.size % COLOURS.length] };
      players.set(p.id, p);
    }
    const changed = p.name !== name || !p.lastSeen;
    Object.assign(p, { name, lastSeen: Date.now() });
    fixMatch();
    if (changed) announce();
    return { code: 200, player: pub(p) };
  }

  const routes = {
    "GET /api/players": async (req, res) => { if (prune()) announce(); sendJson(res, 200, { ...snapshot(), code: roomCode() }); },
    "POST /api/players/join": async (req, res) => { const r = upsert(await readJson(req)); sendJson(res, r.code, r.error ? { error: r.error } : { player: r.player, code: roomCode() }); },
    // Mic page heartbeat (also re-joins after a server restart, so it carries code + name).
    "POST /api/players/ping": async (req, res) => { const r = upsert(await readJson(req)); sendJson(res, r.code, r.error ? { error: r.error } : { player: r.player, boot: BOOT }); },
    "POST /api/players/leave": async (req, res) => {
      const { playerId } = await readJson(req);
      if (players.delete(String(playerId || ""))) { fixMatch(); announce(); }
      sendJson(res, 200, { ok: true });
    },
    "GET /api/match": async (req, res) => sendJson(res, 200, snapshot()),
    "POST /api/match": async (req, res) => {
      const b = await readJson(req);
      if (b.type === "pvp") {
        const ids = (Array.isArray(b.players) ? b.players : []).map(String).filter((id, i, a) => players.has(id) && a.indexOf(id) === i).slice(0, 2);
        match = { type: "pvp", players: ids };
      } else if (b.type === "ovo") { // OBJECT vs OBJECT: 0-2 trainers (none = any phone snaps both)
        const ids = (Array.isArray(b.players) ? b.players : []).map(String).filter((id, i, a) => players.has(id) && a.indexOf(id) === i).slice(0, 2);
        match = { type: "ovo", players: ids };
      } else if (b.type === "object") {
        match = { type: "object", current: players.has(String(b.current)) ? String(b.current) : (match.current && players.has(match.current) ? match.current : null) };
      } else return sendJson(res, 400, { error: "type must be object, pvp or ovo" });
      fixMatch();
      announce();
      sendJson(res, 200, snapshot());
    },
  };

  return {
    routes,
    get: (id) => (players.has(id) ? pub(players.get(id)) : null),
    match: () => ({ ...match }),
    /** The two PvP players, ready to battle (null unless the host picked two). */
    pvpPair: () => (match.type === "pvp" && match.players?.length === 2 ? match.players.map((id) => pub(players.get(id))) : null),
    /** OBJECT vs OBJECT: true when the host picked that match type. */
    isOvo: () => match.type === "ovo",
    /** OBJECT vs OBJECT trainers [t1, t2] (one picked = same phone snaps both; none = null). */
    ovoTrainers: () => {
      if (match.type !== "ovo") return null;
      const t = (match.players || []).filter((id) => players.has(id)).map((id) => pub(players.get(id)));
      return t.length === 2 ? t : t.length === 1 ? [t[0], t[0]] : null;
    },
    /** VS THE OBJECT: who's up (only when someone has joined). */
    current: () => (match.type === "object" && match.current && players.has(match.current) ? pub(players.get(match.current)) : null),
    /** After a VS-object battle: next player in the queue is up. */
    rotate() {
      if (match.type !== "object") return;
      const ids = list().map((p) => p.id);
      if (ids.length < 2) return;
      const i = ids.indexOf(match.current);
      match.current = ids[(i + 1) % ids.length];
      announce();
    },
    count: () => players.size,
    /** Everyone in the lobby, join order (karaoke parts P1..P4). */
    all: () => (prune(), list().map(pub)),
  };
}
