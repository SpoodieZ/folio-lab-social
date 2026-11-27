// The rules about WHEN a line may post: master switches, kill file, posting window, posts a day per line (one unless maxPerDay says more), minimum gap, daily cap.
// A line with anyTime (event-driven, line 3) has no posting window and no minimum gap. A line with onlyIfNoPost is a backup: it posts only on a day the named line has not posted.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, STATE_DIR } from "./log.mjs";
const STATE = path.join(STATE_DIR, "posted.json");
export const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return { lines: {}, days: {}, pendingReply: null }; } };
export const saveState = s => { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s, null, 1)); };
export const dayKey = d => d.toISOString().slice(0, 10);
/* A random-looking but repeatable minute (0..jitterMinutes) after the line's hour: the same line and day always give the same answer, so several runs agree on one time. */
export function plannedOffset(line, now, cfg) { const j = cfg.jitterMinutes || 0; if (!j) return 0; return crypto.createHash("sha256").update(dayKey(now) + "|" + line).digest().readUInt32BE(0) % (j + 1); }
export const hhmm = m => String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");

/* Returns { ok, reason }. Nothing here touches the network. `force` skips only the window and the minimum gap (used for a manual test run), never the kill file or the pause. */
export function decide({ line, cfg, config, state, now, force = false, killPaths = [path.join(ROOT, "KILL"), path.join(STATE_DIR, "KILL")] }) {
  if (killPaths.some(p => fs.existsSync(p))) return { ok: false, reason: "kill switch file is present" };
  if (!cfg) return { ok: false, reason: "unknown line " + line };
  if (cfg.enabled === false) return { ok: false, reason: "line is paused in config.json" };
  if (cfg.startAfter && now < new Date(cfg.startAfter)) return { ok: false, reason: "not started yet (startAfter " + cfg.startAfter + ")" };
  const today = dayKey(now), st = state.lines[line] || {};
  if (!force && !cfg.anyTime) {
    const mins = (now - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), cfg.utcHour)) / 60000;
    const off = plannedOffset(line, now, cfg);
    if (mins >= 0 && mins < off) return { ok: false, reason: `not yet: today's planned time is ${hhmm(cfg.utcHour * 60 + off)} UTC (random within ${cfg.jitterMinutes} min after ${String(cfg.utcHour).padStart(2, "0")}:00)` };
    if (mins < 0 || mins > cfg.windowMinutes) return { ok: false, reason: `outside the posting window (${String(cfg.utcHour).padStart(2, "0")}:00 UTC plus ${cfg.windowMinutes} min)` };
    if (st.at && (now - new Date(st.at)) / 36e5 < cfg.minGapHours) return { ok: false, reason: `last post was ${((now - new Date(st.at)) / 36e5).toFixed(1)} h ago (minimum ${cfg.minGapHours} h)` };
  }
  if (cfg.onlyIfNoPost && state.lines[cfg.onlyIfNoPost]?.day === today) return { ok: false, reason: `backup line: "${cfg.onlyIfNoPost}" already posted today` };
  const done = st.day === today ? (st.count || 1) : 0, max = cfg.maxPerDay || 1;
  if (done >= max) return { ok: false, reason: max === 1 ? "this line already posted today" : `this line already posted ${done} times today (maximum ${max})` };
  if ((state.days[today] || 0) >= config.dailyCap) return { ok: false, reason: `daily cap of ${config.dailyCap} posts reached` };
  return { ok: true };
}
export function recordPost(state, line, { postId, sig, now }) {
  const count = state.lines[line]?.day === dayKey(now) ? (state.lines[line].count || 1) + 1 : 1;
  state.lines[line] = { day: dayKey(now), at: now.toISOString(), postId, sig, count };
  state.days[dayKey(now)] = (state.days[dayKey(now)] || 0) + 1;
  for (const k of Object.keys(state.days).sort().slice(0, -14)) delete state.days[k];   // keep two weeks
  return state;
}
