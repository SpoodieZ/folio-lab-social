// Opening line ("hook") of each post. The series line below it never changes, the hook does:
//  - on an ordinary day it rotates through a short pool, one per day;
//  - when the data has something notable it is replaced by an event hook built from that data (same number format as the body, so the
//    "every number must be in the data" check still passes). No AI wording, no invented facts: fixed sentences plus numbers from the snapshot.
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "./log.mjs";
export const POOLS = {
  funding: ["WHAT DO YOU TRADE TODAY?", "WHO PAYS WHOM ON TXFLOW?", "WHAT DOES IT COST TO HOLD A POSITION RIGHT NOW?", "WHERE IS FUNDING EXTREME RIGHT NOW?", "LONG OR SHORT: WHO IS PAYING TODAY?", "THE PRICE OF HOLDING A POSITION, RIGHT NOW", "CHECK FUNDING BEFORE YOU TRADE"],
  stocks: ["HOW ARE STOCK PERPS DOING ON TXFLOW?", "WALL STREET NAMES, ON-CHAIN: WHO MOVED?", "STOCK PERPS ON TXFLOW: WHO MOVED?", "THE STOCK SCOREBOARD ON TXFLOW", "WHICH STOCKS ARE MOVING ON-CHAIN?", "THE STOCK PERP BOARD", "WHO MOVED IN STOCK PERPS TODAY?"],
  up: ["WHAT'S GREEN ON TXFLOW TODAY?", "WHO LED THE MARKET?", "WHERE IS THE MONEY CHASING?", "TODAY'S BIGGEST GAINERS ON TXFLOW", "WHO IS UP THE MOST?", "THE GREEN LIST", "TOP OF THE BOARD TODAY"],
  down: ["WHAT'S RED ON TXFLOW TODAY?", "WHO GOT HIT TODAY?", "WHERE DID IT HURT?", "TODAY'S BIGGEST DROPS ON TXFLOW", "WHO IS DOWN THE MOST?", "THE RED LIST", "BOTTOM OF THE BOARD TODAY"]
};
const sgn = c => (c >= 0 ? "+" : "−") + Math.abs(c).toFixed(2) + "%";
const aprFmt = a => (a >= 0 ? "+" : "−") + Math.abs(a).toFixed(0) + "%";
export const EVENT_MIN_VOLUME = 5e4;   // an event headline may only name a market with at least $50K of 24h volume
/* line: "funding" | "up" | "down";  day: whole days since 1970 (UTC);  top: { name, chg } or { name, apr } */
export function pickHook(line, day, top) {
  if (top) {
    if (line === "funding" && Math.abs(top.apr) >= 500) return `${top.name} FUNDING JUST HIT ${aprFmt(top.apr)} APR`;
    if ((line === "up" || line === "down") && Math.abs(top.chg) >= 10) return `${top.name} ${top.chg >= 0 ? "LED WITH" : "WAS HIT:"} ${sgn(top.chg)}`;
  }
  const pool = POOLS[line]; return pool[((day % pool.length) + pool.length) % pool.length];
}
const USED = path.join(STATE_DIR, "hooks-used.json");
/* One event headline per mover per day: the first line to ask for NAME gets it, a later line the same day falls back to the ordinary pool. */
export function claimEvent(day, name, { save = true } = {}) {
  let st = { day, names: [] };
  try { const o = JSON.parse(fs.readFileSync(USED, "utf8")); if (o.day === day) st = o; } catch {}
  if (st.names.includes(name)) return false;
  if (save) { st.names.push(name); fs.mkdirSync(path.dirname(USED), { recursive: true }); fs.writeFileSync(USED, JSON.stringify(st)); }
  return true;
}
