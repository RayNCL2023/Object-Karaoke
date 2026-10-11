// Duet Anything - Jackbox-style audience: phones join the crowd with a room code, react, and vote on battle rounds.
// Everything lives in memory (max 40 members). Events go out on the shared SSE stream via broadcast().
const MAX_MEMBERS = 40;
const REACT_GAP_MS = 700;
const REACTIONS = new Set(["cheer", "boo", "fire", "laugh"]);
const WORDS = ["MANC", "BREW", "MINT", "TRAM", "BEES", "RAIN", "PINT", "BUZZ", "BARM", "NANS", "GRAV", "KEBS"]; // Manc-flavoured, never rude
import { nameOk } from "./safety.mjs"; // shared swear/slur filter (word-boundary + leetspeak)

const makeCode = () => WORDS[(Math.random() * WORDS.length) | 0];
const cleanName = (s) => {
  const n = String(s || "").replace(/[^\p{L}\p{N} '._-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 16);
  return !n || !nameOk(n) ? "" : n;
};
const cleanColour = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || "")) ? String(c).toLowerCase() : "#ff5a36");
const cleanAvatar = (a) => (/^ph_[a-z0-9_]{1,20}$/.test(String(a || "")) ? String(a) : "ph_mug");
const newId = () => "a_" + Math.random().toString(36).slice(2, 10);

// sessionInfo(id) -> { rounds, done } | null (server.mjs): votes for unknown sessions, rounds that don't exist,
// or after the verdict / close() are rejected. code: fixed room code (ROOM_CODE / persisted), else a random word.
export function createAudience({ broadcast, readJson, sendJson, joinUrl, sessionInfo, code: fixedCode }) {
  const code = String(fixedCode || "").trim().toUpperCase() || makeCode();
  const closed = new Set(); // "sessionId" (all rounds) or "sessionId|round" - voting over
  /** Stop accepting votes for a session (round omitted = every round). */
  const close = (sessionId, round) => { closed.add(round ? `${sessionId}|${Math.round(Number(round))}` : String(sessionId)); if (closed.size > 500) closed.delete(closed.values().next().value); };
  const members = new Map(); // id -> { id, name, avatar, colour, joinedAt, lastReact }
  const votes = new Map();   // sessionId -> Map("round|memberId" -> 'player'|'object')
  const pub = (m) => ({ id: m.id, name: m.name, avatar: m.avatar, colour: m.colour });

  /** Crowd vote across all rounds of a battle session: { player, object, total, bonus (-10..10), rounds }. */
  function getTally(sessionId) {
    const v = votes.get(String(sessionId || "")) || new Map();
    const rounds = {};
    let player = 0, object = 0;
    const byValue = {}; // every vote value, incl. PvP player ids (lib/pvp.mjs)
    for (const [k, val] of v) {
      const r = k.split("|")[0];
      rounds[r] ||= { player: 0, object: 0 };
      rounds[r][val] = (rounds[r][val] || 0) + 1;
      byValue[val] = (byValue[val] || 0) + 1;
      if (val === "player") player++; else if (val === "object") object++;
    }
    const total = player + object;
    const bonus = total ? Math.round(((player - object) / total) * 10) : 0;
    return { player, object, total, bonus, rounds, byValue };
  }

  // Show state for late / reloaded judges (GET /api/audience/state). server.mjs feeds every broadcast to observe().
  let show = { phase: "idle", round: 0, voteOpen: false, voteRound: 0, session: null };
  function observe(e) {
    if (!e || typeof e !== "object") return;
    if (e.type === "song-ready" && e.session) {
      const s = e.session;
      show = { phase: "song", round: 0, voteOpen: false, voteRound: 0, session: { id: s.id, name: s.character?.name || "The object", object: s.object || "", battle: s.mode === "battle" || !!s.battle, pvp: s.pvp?.players?.map((p) => ({ id: p.id, name: p.name })) || null } };
    } else if (e.type === "ovo-ready" && e.session) { // OBJECT vs OBJECT: vote values ovo_a / ovo_b, shaped like PvP for the phones
      const s = e.session;
      show = { phase: "song", round: 0, voteOpen: false, voteRound: 0, session: { id: s.id, name: s.title || "Object vs Object", object: "", battle: true, ovo: true, pvp: (s.sides || []).map((x) => ({ id: x.value, name: x.character?.name || "Object" })) } };
    } else if (e.type === "ovo-vote" && show.session?.ovo) Object.assign(show, { phase: "take", voteOpen: true, voteRound: Number(e.round) || 1 });
    else if (e.type === "ovo-verdict") Object.assign(show, { phase: "verdict", voteOpen: false });
    else if (e.type === "record-start") Object.assign(show, { phase: "record", round: Number(e.round ?? e.line) || show.round, voteOpen: false, playerName: e.playerName || "" });
    else if (e.type === "take-received" && show.session?.battle && e.round) {
      show.phase = "take"; show.round = Number(e.round) || show.round;
      if (show.session.pvp) { if (e.voteOpen) Object.assign(show, { voteOpen: true, voteRound: Number(e.pvpRound) || 1 }); }
      else Object.assign(show, { voteOpen: true, voteRound: Number(e.round) || 1 });
    } else if (e.type === "verdict") Object.assign(show, { phase: "verdict", voteOpen: false });
    else if (e.type === "reset") show = { phase: "idle", round: 0, voteOpen: false, voteRound: 0, session: null };
  }
  const voteOptions = () => {
    const s = show.session;
    if (!s) return [];
    return s.pvp ? s.pvp.map((p) => ({ value: p.id, label: p.name })) : [{ value: "player", label: "The human" }, { value: "object", label: s.name }];
  };

  const routes = {
    "GET /api/audience/state": async (req, res) => {
      sendJson(res, 200, { ...show, options: voteOptions(), code, count: members.size });
    },
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
      if (b.value !== "player" && b.value !== "object" && b.value !== "ovo_a" && b.value !== "ovo_b" && !/^p_[a-z0-9]{4,12}$/.test(String(b.value || ""))) return sendJson(res, 400, { error: "vote 'player', 'object' or a player id" });
      const round = Math.max(1, Math.min(10, Math.round(Number(b.round)) || 1));
      const sid = String(b.id || b.sessionId || "").slice(0, 60);
      if (!sid) return sendJson(res, 400, { error: "no battle running" });
      const info = sessionInfo ? sessionInfo(sid) : { rounds: 10 };
      if (!info) return sendJson(res, 404, { error: "no battle running" });
      if (info.done || closed.has(sid) || closed.has(`${sid}|${round}`)) return sendJson(res, 409, { error: "voting's closed for that one" });
      if (info.rounds && (Math.round(Number(b.round)) || 1) > info.rounds) return sendJson(res, 400, { error: "no such round" });
      if (!votes.has(sid)) { votes.set(sid, new Map()); if (votes.size > 50) votes.delete(votes.keys().next().value); }
      votes.get(sid).set(`${round}|${m.id}`, b.value);
      const t = getTally(sid);
      broadcast({ type: "audience-vote", id: sid, round, memberId: m.id, value: b.value, at: Date.now() });
      broadcast({ type: "audience-tally", id: sid, round, ...(t.rounds[round] || { player: 0, object: 0 }), totals: { player: t.player, object: t.object, bonus: t.bonus }, counts: t.rounds[round] || {}, byValue: t.byValue, at: Date.now() });
      sendJson(res, 200, { ok: true, round, tally: t.rounds[round] });
    },
    // Stage: voting for a round (or the whole battle) is over. body { id, round? }. Judge also closes the session.
    "POST /api/audience/close": async (req, res) => {
      const b = await readJson(req);
      const sid = String(b.id || b.sessionId || "").slice(0, 60);
      if (!sid) return sendJson(res, 400, { error: "send { id, round? }" });
      close(sid, b.round);
      broadcast({ type: "votes-closed", id: sid, round: b.round ?? null, at: Date.now() });
      sendJson(res, 200, { ok: true, tally: getTally(sid) });
    },
  };

  return { routes, getTally, observe, code, close, count: () => members.size };
}
