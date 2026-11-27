// Runs one line:   node run.mjs funding|up|down|new [--force]
// Master switch: SOCIAL_MODE = off (default: do nothing) | dry (build the post, save it to out/, never post) | live (post to X).
// Always exits 0 on a deliberate skip, 1 on an error (so GitHub shows a red run and emails the owner).
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/log.mjs";
import { log } from "./lib/log.mjs";
import { loadState, saveState, decide, recordPost, dayKey } from "./lib/guard.mjs";
import { fetchMarkets, renderCard } from "./lib/newmarkets.mjs";
import { runNewLine } from "./lib/line_new.mjs";
import { lint } from "./lib/check.mjs";
import { claimEvent } from "./lib/hooks.mjs";
import { serveDir, launchChrome, openApp } from "./lib/browser.mjs";
import { buildFunding, buildMovers } from "./lib/lines.mjs";
import { credsFromEnv, makeX } from "./lib/x.mjs";

const line = process.argv[2], force = process.argv.includes("--force") || process.env.FORCE === "1";
const mode = (process.env.SOCIAL_MODE || "off").toLowerCase();
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
if (!["funding", "up", "down", "new"].includes(line)) { console.error("usage: node run.mjs funding|up|down|new [--force]"); process.exit(2); }
if (!["off", "dry", "live"].includes(mode)) { console.error("SOCIAL_MODE must be off, dry or live (got " + mode + ")"); process.exit(2); }
if (mode === "off") { log({ line, decision: "off", reason: "SOCIAL_MODE is off" }); process.exit(0); }

const now = new Date(), state = loadState(), cfg = config.lines[line];
// a reply that failed last time is retried first (live only, never past the kill switch)
const killed = [path.join(ROOT, "KILL"), path.join(ROOT, "state", "KILL")].some(p => fs.existsSync(p));
if (mode === "live" && state.pendingReply && !killed) {
  try { const x = makeX(credsFromEnv()); const id = await x.post({ text: state.pendingReply.text, replyTo: state.pendingReply.postId }); log({ line, decision: "reply-retried", reason: "reply to " + state.pendingReply.postId + " sent as " + id }); state.pendingReply = null; saveState(state); }
  catch (e) { log({ line, decision: "reply-retry-failed", reason: String(e.message).slice(0, 200) }); }
}
// line 3 is event-driven and has its own flow (lib/line_new.mjs): no market page, a waiting list, up to maxPerDay posts
if (line === "new") {
  let code = 1;
  try {
    const c = mode === "live" ? credsFromEnv() : null;
    if (c && c.kind === "none") log({ line, decision: "error", reason: "live mode but X credentials are missing: " + c.missing.join(", ") });
    else code = await runNewLine({ mode, cfg, config, now, force, marketsFile: path.join(ROOT, "state", "markets.json"), outDir: path.join(ROOT, "out"),
      loadPosted: loadState, savePosted: saveState, log, fetchMarkets: () => fetchMarkets(), render: renderCard, makeClient: () => makeX(c) });
  } catch (e) { log({ line, decision: "error", reason: String(e.message || e).slice(0, 300) }); }
  process.exit(code);
}
const g = decide({ line, cfg, config, state, now, force });
if (!g.ok) { log({ line, decision: "skip", reason: g.reason }); process.exit(0); }

if (mode === "live") { const c = credsFromEnv(); if (c.kind === "none") { log({ line, decision: "error", reason: "live mode but X credentials are missing: " + c.missing.join(", ") }); process.exit(1); } }
let server, page;
async function main() {
  server = await serveDir(path.join(ROOT, "app"));
  page = await launchChrome();
  const markets = await openApp(page, server.url);
  const fetchedAt = Date.now(), built = line === "funding" ? await buildFunding(page, cfg, now) : await buildMovers(page, line, now);
  if (built.skip) { log({ line, decision: "skip", reason: built.skip, numbers: built.numbers }); return 0; }
  if (built.numbersNotInData.length) { log({ line, decision: "refused", reason: "numbers not in the data: " + built.numbersNotInData.join(" ") }); return 1; }
  const replyMode = cfg.reply || "none", autoReply = replyMode === "link" ? built.reply : replyMode === "pointer" ? built.pointer : null;
  const lt = lint({ ...built, reply: autoReply }, { replyMode }); if (lt.fails.length) { log({ line, decision: "refused", reason: "lint: " + lt.fails.join("; ") }); return 1; }
  const last = state.lines[line];
  if (line === "funding" && last?.sig === built.sig && (now - new Date(last.at)) < 36e5 * 30) { log({ line, decision: "skip", reason: "same pairs as the last post", numbers: built.numbers }); return 0; }

  const stem = `${dayKey(now)}-${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}-${line}`;
  fs.mkdirSync(path.join(ROOT, "out"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "out", stem + ".png"), built.png);
  fs.writeFileSync(path.join(ROOT, "out", stem + ".txt"), `${built.text}\n\n--- reply mode: ${replyMode} ---\nautomatic reply: ${autoReply ? "\n" + autoReply : "none"}\n\n--- reply with the link, to paste by hand if you want it (NOT posted by the program) ---\n${built.reply}\n\n--- alt text ---\n${built.alt}\n\n--- checks ---\nlength as X counts it: ${lt.len}; warnings: ${lt.warns.join("; ") || "none"}; markets read: ${markets}\n`);

  if (mode === "dry") { log({ line, decision: "dry-run", reason: "built, nothing posted; see out/" + stem, numbers: built.numbers, warns: lt.warns }); return 0; }

  // ---- live: the data must be fresh (rule: text, image and alt text come from one fetch, at most 5 minutes before posting)
  if (Date.now() - fetchedAt > 5 * 60e3) { log({ line, decision: "refused", reason: "data older than 5 minutes at posting time" }); return 1; }
  const x = makeX(credsFromEnv());
  const mediaId = await x.uploadImage(built.png);
  await x.setAlt(mediaId, built.alt);
  const postId = await x.post({ text: built.text, mediaIds: [mediaId] });
  recordPost(state, line, { postId, sig: built.sig, now }); saveState(state);
  if (built.claim) claimEvent(Math.floor(now / 864e5), built.claim);
  log({ line, decision: "posted", reason: "post " + postId, numbers: built.numbers });
  if (!autoReply) { log({ line, decision: "no-reply", reason: "reply mode is none: add the link by hand if you want it" }); return 0; }
  try { await x.post({ text: autoReply, replyTo: postId }); log({ line, decision: "reply-posted", reason: replyMode + " reply sent" }); }
  catch (e) { state.pendingReply = { postId, text: autoReply }; saveState(state); log({ line, decision: "reply-failed", reason: String(e.message).slice(0, 200) + " (will retry on the next run)" }); return 1; }
  return 0;
}
let code = 1;
try { code = await main(); } catch (e) { log({ line, decision: "error", reason: String(e.message || e).slice(0, 300) }); }
try { page?.close(); } catch {} try { server?.close(); } catch {}
setTimeout(() => process.exit(code), 300);
