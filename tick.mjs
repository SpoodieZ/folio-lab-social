// One call for every line:  node tick.mjs   (the workflow's line "all", meant for ONE outside timer that fires every 30 minutes, all day)
// A timed line runs only when the posting rules allow it right now; that check writes no log line, so a quiet tick makes no commit.
// Each line still goes through run.mjs with all its own rules. "force" is never used here.
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/log.mjs";
import { loadState, decide } from "./lib/guard.mjs";
import fs from "node:fs";

export const ORDER = ["up", "funding", "down", "new"];
export function tick({ config, load, now = () => new Date(), run, say = console.log, killPaths }) {
  let code = 0;
  for (const line of ORDER) {
    // line "new" is event-driven and checks itself. The state is read again before each line: once funding has posted, its backup stays closed
    if (line !== "new") {
      const g = decide({ line, cfg: config.lines[line], config, state: load(), now: now(), ...(killPaths ? { killPaths } : {}) });
      if (!g.ok) { say(`[${line}] not now · ${g.reason}`); continue; }
    }
    if (run(line) !== 0) code = 1;
  }
  return code;
}
if (import.meta.url === "file://" + process.argv[1]) {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
  const run = line => spawnSync(process.execPath, [path.join(ROOT, "run.mjs"), line], { stdio: "inherit", env: { ...process.env, FORCE: "0" }, timeout: 6 * 60e3 }).status ?? 1;
  process.exit(tick({ config, load: loadState, run }));
}
