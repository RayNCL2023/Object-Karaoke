// Duet Anything - Jackbox-style audience: phones join the crowd with a room code, react, and vote on battle rounds.
// Everything lives in memory (max 40 members). Events go out on the shared SSE stream via broadcast().
const MAX_MEMBERS = 40;
const REACT_GAP_MS = 700;
const REACTIONS = new Set(["cheer", "boo", "fire", "laugh"]);
const WORDS = ["MANC", "BREW", "MINT", "TRAM", "BEES", "RAIN", "PINT", "BUZZ", "BARM", "NANS", "GRAV", "KEBS"]; // Manc-flavoured, never rude
const BLOCK = /(fuck|shit|cunt|nigg|fag|twat|wank|dick|cock|pussy|bitch|slut|whore|rape|nazi|hitler|retard|paki|spast)/i;

const makeCode = () => WORDS[(Math.random() * WORDS.length) | 0];
const cleanName = (s) => {
  const n = String(s || "").replace(/[^\p{L}\p{N} '._-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 16);
  return !n || BLOCK.test(n.replace(/[^a-z]/gi, "")) ? "" : n;
};
const cleanColour = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || "")) ? String(c).toLowerCase() : "#ff5a36");
const cleanAvatar = (a) => (/^ph_[a-z0-9_]{1,20}$/.test(String(a || "")) ? String(a) : "ph_mug");
const newId = () => "a_" + Math.random().toString(36).slice(2, 10);

export function createAudience({ broadcast, readJson, sendJson, joinUrl }) {
  const code = makeCode();
  const members = new Map(); // id -> { id, name, avatar, colour, joinedAt, lastReact }
  const votes = new Map();   // sessionId -> Map("round|memberId" -> 'player'|'object')
  const pub = (m) => ({ id: m.id, name: m.name, avatar: m.avatar, colour: m.colour });

  /** Crowd vote across all rounds of a battle session: { player, object, total, bonus (-10..10), rounds }. */
  function getTally(sessionId) {
    const v = votes.get(String(sessionId || "")) || new Map();
    const rounds = {};
    let player = 0, object = 0;
    for (const [k, val] of v) {
      const r = k.split("|")[0];
      rounds[r] ||= { player: 0, object: 0 };
      rounds[r][val]++;
      if (val === "player") player++; else object++;
    }
    const total = player + object;
    const bonus = total ? Math.round(((player - object) / total) * 10) : 0;
    return { player, object, total, bonus, rounds };
  }

  const routes = {
    "GET /api/audience": async (req, res) => {
      sendJson(res, 200, { code, joinUrl: joinUrl(), count: members.size, max: MAX_MEMBERS, members: [...members.values()].map(pub) });
    },
    "POST /api/audience/join": async (req, res) => {
      const b = await readJson(req);
      if (String(b.code || "").trim().toUpperCase() !== code) return sendJson(res, 403, { error: "Wrong room code - check the big screen" });
      const name = cleanName(b.name);
      if (!name) return sendJson(res, 400, { error: "Pick a different nickname" });
      const existing = b.audienceId && members.get(String(b.audienceId));
      if (!existing && members.size >= MAX_MEMBERS) return sendJson(res, 409, { error: "The crowd is full (40 max) - watch from the stage!" });
      const m = existing || { id: newId(), joinedAt: Date.now(), lastReact: 0 };
      Object.assign(m, { name, avatar: cleanAvatar(b.avatar), colour: cleanColour(b.colour) });
      members.set(m.id, m);
      broadcast({ type: "audience-joined", member: pub(m), count: members.size, at: Date.now() });
      sendJson(res, 200, { audienceId: m.id, member: pub(m), code });
    },
    "POST /api/audience/leave": async (req, res) => {
      const { audienceId } = await readJson(req);
      const m = members.get(String(audienceId || ""));
      if (m) { members.delete(m.id); broadcast({ type: "audience-left", id: m.id, count: members.size, at: Date.now() }); }
      sendJson(res, 200, { ok: true });
    },
    "POST /api/audience/react": async (req, res) => {
      const { audienceId, type } = await readJson(req);
      const m = members.get(String(audienceId || ""));
      if (!m) return sendJson(res, 404, { error: "not in the crowd - join again" });
      if (!REACTIONS.has(type)) return sendJson(res, 400, { error: "unknown reaction" });
      const now = Date.now();
      if (now - m.lastReact < REACT_GAP_MS) return sendJson(res, 429, { error: "easy, tiger", retryMs: REACT_GAP_MS - (now - m.lastReact) });
      m.lastReact = now;
      broadcast({ type: "audience-react", id: m.id, name: m.name, colour: m.colour, reaction: type, at: now });
      sendJson(res, 200, { ok: true });
    },
    "POST /api/audience/vote": async (req, res) => {
      const b = await readJson(req);
      const m = members.get(String(b.audienceId || ""));
      if (!m) return sendJson(res, 404, { error: "not in the crowd - join again" });
      if (b.value !== "player" && b.value !== "object") return sendJson(res, 400, { error: "vote 'player' or 'object'" });
      const round = Math.max(1, Math.min(10, Math.round(Number(b.round)) || 1));
      const sid = String(b.id || b.sessionId || "").slice(0, 60);
      if (!sid) return sendJson(res, 400, { error: "no battle running" });
      if (!votes.has(sid)) { votes.set(sid, new Map()); if (votes.size > 50) votes.delete(votes.keys().next().value); }
      votes.get(sid).set(`${round}|${m.id}`, b.value);
      const t = getTally(sid);
      broadcast({ type: "audience-vote", id: sid, round, memberId: m.id, value: b.value, at: Date.now() });
      broadcast({ type: "audience-tally", id: sid, round, ...(t.rounds[round] || { player: 0, object: 0 }), totals: { player: t.player, object: t.object, bonus: t.bonus }, at: Date.now() });
      sendJson(res, 200, { ok: true, round, tally: t.rounds[round] });
    },
  };

  return { routes, getTally, code, count: () => members.size };
}
