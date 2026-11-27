// Line 3 in the automation. Unlike lines 1 and 2 it is event-driven: it runs every hour and posts only when TxFlow's market list changed.
// A change is saved to the waiting list (state/markets.json) before anything is built, and leaves it only AFTER X has accepted the post,
// so a failed run loses nothing and the next run tries again. A change older than MAX_AGE_H hours is dropped with a log line (the text says "just").
// Everything that touches the outside world is passed in, so test.mjs can run this offline with a fake X.
import fs from "node:fs";
import path from "node:path";
import { decide, recordPost } from "./guard.mjs";
import { pointerFor } from "./lines.mjs";
import { KINDS, MAX_AGE_H, isStale, readMarketState, writeMarketState, snapshot, goneFrom, advance, buildPost, checkPost, linkReply } from "./newmarkets.mjs";

const SAVE_EVERY_H = 6;   // with nothing new, the "last checked" time is saved this often only (every save is a commit on GitHub)
const LINE = "new";

export async function runNewLine({ mode, cfg, config, now, force = false, marketsFile, outDir, loadPosted, savePosted, log, fetchMarkets, render, makeClient, killPaths, clock = () => Date.now() }) {
  const gateArgs = { line: LINE, cfg, config, now, force, ...(killPaths ? { killPaths } : {}) };
  const open = decide({ ...gateArgs, state: { lines: {}, days: {} } });   // kill file, pause, startAfter (the daily limits are checked before each post)
  if (!open.ok) { console.log(`[${LINE}] skip · ${open.reason}`); return 0; }   // console only: a log line every hour would be a commit every hour

  const prev = readMarketState(marketsFile);
  const cur = await fetchMarkets(), fetchedAt = clock();
  if (!prev) { writeMarketState(marketsFile, { savedAt: now.toISOString(), markets: snapshot(new Map(), cur), pending: [], sent: [] }); log({ line: LINE, decision: "baseline", reason: `first run: ${cur.length} markets saved, nothing to announce` }); return 0; }

  const old = new Map(prev.markets.map(m => [m.index, m]));
  const r = advance(old, cur, prev.pending || [], { since: prev.savedAt, foundAt: now.toISOString() });
  if (r.cancelled.length) log({ line: LINE, decision: "cancelled", reason: "undone before it was posted: " + r.cancelled.map(e => e.kind + " " + e.name).join(", ") });
  const byIndex = new Map(cur.map(m => [m.index, m]));
  const dropped = r.pending.filter(e => isStale(e, now) || !byIndex.has(e.index));
  if (dropped.length) log({ line: LINE, decision: "dropped", reason: `not posted, may be older than ${MAX_AGE_H} h or gone from the list (post by hand if still wanted): ` + dropped.map(e => e.kind + " " + e.name).join(", ") });
  const st = { savedAt: now.toISOString(), markets: [...snapshot(old, cur), ...goneFrom(prev.markets, cur)], pending: r.pending.filter(e => !dropped.includes(e)), sent: prev.sent || [] };
  const key = s => JSON.stringify([s.markets.map(m => [m.index, m.name, m.delisted, m.everLive ?? null]).sort((a, b) => a[0] - b[0]), s.pending || []]);
  // saved BEFORE any post is built: the changes are now in the waiting list
  if (key(st) !== key(prev) || now - new Date(prev.savedAt) >= SAVE_EVERY_H * 36e5) writeMarketState(marketsFile, st);
  if (!st.pending.length) { console.log(`[${LINE}] nothing waiting (${cur.length} markets read)`); return 0; }

  let code = 0;
  for (const kind of KINDS) {
    const waiting = st.pending.filter(e => e.kind === kind);
    if (!waiting.length) continue;
    // a dry run posts nothing, so the change stays waiting; do not build the same draft again every hour
    if (mode === "dry" && waiting.every(e => e.dryAt)) { console.log(`[${LINE}] ${kind}: dry draft already built, still waiting`); continue; }
    const posted = loadPosted(), g = decide({ ...gateArgs, state: posted });
    if (!g.ok) { log({ line: LINE, decision: "skip", reason: `${kind} waits: ${g.reason}` }); continue; }

    const p = buildPost(kind, waiting.map(e => byIndex.get(e.index)), now);
    const replyMode = cfg.reply || "none", autoReply = replyMode === "link" ? linkReply(now) : replyMode === "pointer" ? pointerFor(now) : null;
    const checks = checkPost(p, { reply: autoReply, replyMode }), listed = p.items.map(m => m.name);
    if (checks.fails.length) { log({ line: LINE, decision: "refused", reason: `${kind}: ${checks.fails.join("; ")}`, numbers: { listed } }); code = 1; continue; }

    fs.mkdirSync(outDir, { recursive: true });
    const iso = now.toISOString(), stem = `${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}-${LINE}-${kind}`, base = path.join(outDir, stem);
    await render(p, base);
    fs.writeFileSync(base + ".txt", `${p.text}\n\n--- reply mode: ${replyMode} ---\nautomatic reply: ${autoReply ? "\n" + autoReply : "none"}\n\n--- reply with the link, to paste by hand if you want it (NOT posted by the program) ---\n${linkReply(now)}\n\n--- alt text ---\n${p.alt}\n\n--- checks ---\nlength as X counts it: ${checks.len}; warnings: ${checks.warns.join("; ") || "none"}\n`);

    if (mode !== "live") {
      for (const e of waiting) e.dryAt = now.toISOString();
      writeMarketState(marketsFile, st);
      log({ line: LINE, decision: "dry-run", reason: `${kind}: built, nothing posted; see out/${stem}`, numbers: { listed }, warns: checks.warns }); continue;
    }
    if (clock() - fetchedAt > 5 * 60e3) { log({ line: LINE, decision: "refused", reason: "data older than 5 minutes at posting time" }); return 1; }
    const x = makeClient();   // an error from X is thrown: nothing below runs, the change stays waiting and the next run tries again
    const mediaId = await x.uploadImage(fs.readFileSync(base + ".png"));
    await x.setAlt(mediaId, p.alt);
    const postId = await x.post({ text: p.text, mediaIds: [mediaId] });
    st.pending = st.pending.filter(e => !waiting.includes(e));
    st.sent = [...st.sent, { kind, names: listed, at: now.toISOString(), postId }].slice(-100);
    writeMarketState(marketsFile, st);
    recordPost(posted, LINE, { postId, sig: kind + ":" + listed.join(","), now }); savePosted(posted);
    log({ line: LINE, decision: "posted", reason: `${kind}: post ${postId}`, numbers: { listed } });
    if (!autoReply) continue;
    try { await x.post({ text: autoReply, replyTo: postId }); log({ line: LINE, decision: "reply-posted", reason: replyMode + " reply sent" }); }
    catch (e) { posted.pendingReply = { postId, text: autoReply }; savePosted(posted); log({ line: LINE, decision: "reply-failed", reason: String(e.message).slice(0, 200) + " (will retry on the next run)" }); code = 1; }
  }
  return code;
}
