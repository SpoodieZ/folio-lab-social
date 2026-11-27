import fs from "node:fs";
import path from "node:path";
export const ROOT = path.resolve(import.meta.dirname, "..");
export const STATE_DIR = path.join(ROOT, "state");
const LOG = path.join(STATE_DIR, "log.jsonl");
/* One line per decision, so a skipped day always has a reason. Committed back to the repo by the workflow. */
export function log(entry) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const e = { at: new Date().toISOString(), ...entry };
  fs.appendFileSync(LOG, JSON.stringify(e) + "\n");
  console.log("[" + e.line + "] " + e.decision + (e.reason ? " · " + e.reason : ""));
  return e;
}
