// Offline self-tests: the X signature (against the example in X's own OAuth 1.0a documentation), the posting rules, the post lint and the whole flow of line 3
// with a fake market list, a fake card renderer and a fake X. No network, no browser; line 3 writes to a throw-away folder only.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runNewLine } from "./lib/line_new.mjs";
import { buildFunding, buildMovers } from "./lib/lines.mjs";
import { checkKeys } from "./check_keys.mjs";
import { tick } from "./tick.mjs";
import { oauth1Header } from "./lib/x.mjs";
import { decide, recordPost, plannedOffset } from "./lib/guard.mjs";
import { lint, xLen } from "./lib/check.mjs";
let n = 0; const t = (name, fn) => { try { fn(); n++; console.log("ok  ", name); } catch (e) { console.log("FAIL", name, "\n    ", e.message); process.exitCode = 1; } };

t("OAuth 1.0a signature matches X's documented example", () => {
  const h = oauth1Header("POST", "https://api.twitter.com/1.1/statuses/update.json?include_entities=true",
    { key: "xvz1evFS4wEEPTGEFPHBog", secret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw", token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE" },
    { bodyParams: { status: "Hello Ladies + Gentlemen, a signed OAuth request!" }, nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", timestamp: 1318622958 });
  assert.match(h, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);   // the value of the "Creating a signature" example
});

const config = { dailyCap: 2 }, cfg = { enabled: true, utcHour: 13, windowMinutes: 180, minGapHours: 6 };
const at = (h, m = 0, d = 23) => new Date(Date.UTC(2026, 10, d, h, m));
const empty = () => ({ lines: {}, days: {}, pendingReply: null }), nokill = { killPaths: [] };
t("inside the window: allowed", () => assert.equal(decide({ line: "funding", cfg, config, state: empty(), now: at(13, 20), ...nokill }).ok, true));
t("too early / too late: refused", () => { for (const h of [12, 17]) assert.equal(decide({ line: "funding", cfg, config, state: empty(), now: at(h, 30), ...nokill }).ok, false); });
t("force skips the window but not the pause", () => {
  assert.equal(decide({ line: "funding", cfg, config, state: empty(), now: at(3), force: true, ...nokill }).ok, true);
  assert.equal(decide({ line: "funding", cfg: { ...cfg, enabled: false }, config, state: empty(), now: at(13), force: true, ...nokill }).ok, false);
});
t("one post a day per line", () => { const s = recordPost(empty(), "funding", { postId: "1", sig: "x", now: at(13, 5) }); assert.equal(decide({ line: "funding", cfg, config, state: s, now: at(14), ...nokill }).ok, false); });
t("daily cap", () => { let s = empty(); s = recordPost(s, "up", { postId: "1", sig: "a", now: at(8) }); s = recordPost(s, "down", { postId: "2", sig: "b", now: at(9) }); assert.equal(decide({ line: "funding", cfg, config, state: s, now: at(13, 10), ...nokill }).ok, false); });
t("kill file blocks even a forced run", () => assert.equal(decide({ line: "funding", cfg, config, state: empty(), now: at(13), force: true, killPaths: ["/etc/hosts"] }).ok, false));
t("startAfter in the future blocks", () => assert.equal(decide({ line: "up", cfg: { ...cfg, startAfter: "2026-12-07" }, config, state: empty(), now: at(13), ...nokill }).ok, false));

const good = { text: "WHAT DO YOU TRADE TODAY?\nTop funding on TxFlow (23 Nov, 13:00 UTC):\n\n🟢 Longs pay: $ABC +120% APR\n\nAPR = hourly rate × 24 × 365 · not financial advice", reply: "Live funding: txfolio.xyz\nFree, read-only. Independent tool, not affiliated with TxFlow.", alt: "Top funding. Independent tool, not financial advice." };
t("a good post passes the lint", () => assert.deepEqual(lint(good).fails, []));
t("advice words, missing disclaimer, missing link fail", () => {
  assert.ok(lint({ ...good, text: good.text + " buy now" }).fails.length);
  assert.ok(lint({ ...good, text: good.text.replace("not financial advice", "enjoy") }).fails.length);
  assert.ok(lint({ ...good, reply: "no link here, independent tool" }).fails.length);
});
t("length counts links as 23 and emoji as 2", () => { assert.equal(xLen("txfolio.xyz"), 23); assert.equal(xLen("🟢a"), 3); });
t("random minute is repeatable, differs by day and line, and the post waits for it", () => {
  const jc = { ...cfg, jitterMinutes: 120, windowMinutes: 240 };
  assert.equal(plannedOffset("funding", at(13), jc), plannedOffset("funding", at(15), jc));
  const offs = new Set([23, 24, 25, 26, 27, 28].map(d => plannedOffset("funding", at(13, 0, d), jc))); assert.ok(offs.size > 3, "offsets should vary by day");
  assert.ok(offs.size && [...offs].every(o => o >= 0 && o <= 120));
  const off = plannedOffset("funding", at(13), jc), before = at(13, Math.max(0, off - 1) % 60, 23);
  if (off > 0) assert.equal(decide({ line: "funding", cfg: jc, config, state: empty(), now: new Date(Date.UTC(2026, 10, 23, 13, 0) + (off - 1) * 60000), ...nokill }).ok, false);
  assert.equal(decide({ line: "funding", cfg: jc, config, state: empty(), now: new Date(Date.UTC(2026, 10, 23, 13, 0) + off * 60000), ...nokill }).ok, true);
});
const noReply = { ...good, reply: null };
t("reply mode none needs no reply; pointer must have no link; a domain in the main post fails", () => {
  assert.deepEqual(lint(noReply, { replyMode: "none" }).fails, []);
  assert.ok(lint({ ...good, reply: "Folio Lab, link in bio. Independent tool, not affiliated with TxFlow." }, { replyMode: "pointer" }).fails.length === 0);
  assert.ok(lint({ ...good, reply: "Folio Lab: txfolio.xyz independent" }, { replyMode: "pointer" }).fails.length > 0);
  assert.ok(lint({ ...good, reply: "link in bio, independent tool" }, { replyMode: "pointer" }).fails.length > 0, "pointer must name Folio Lab");
  assert.ok(lint({ ...noReply, text: good.text + "\ntxfolio.xyz" }, { replyMode: "none" }).fails.length > 0);
});

// ---- the plan in config.json: two scheduled posts a day
const real = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "config.json"), "utf8"));
t("backup line: down is refused after funding posted, even when forced, and allowed when it did not", () => {
  const now = at(16, 59), posted = recordPost(empty(), "funding", { postId: "1", sig: "x", now: at(13, 40) });
  assert.match(decide({ line: "down", cfg: real.lines.down, config: real, state: posted, now, force: true, ...nokill }).reason, /backup line/);
  assert.equal(decide({ line: "down", cfg: real.lines.down, config: real, state: empty(), now: at(17, 5), ...nokill }).ok, true);
  const yesterday = recordPost(empty(), "funding", { postId: "1", sig: "x", now: at(13, 40, 22) });
  assert.equal(decide({ line: "down", cfg: real.lines.down, config: real, state: yesterday, now: at(17, 5), ...nokill }).ok, true);
});
t("config.json: funding closes before down opens, so one day can never get both on schedule", () => {
  const { funding: f, down: d } = real.lines; assert.equal(d.onlyIfNoPost, "funding"); assert.ok(f.utcHour * 60 + f.windowMinutes < d.utcHour * 60);
  for (const l of [real.lines.up, f, d]) assert.ok(l.jitterMinutes + 60 <= l.windowMinutes, "at least two more runs after the latest planned minute");
});
t("config.json: every minute of a simulated day gives at most 2 scheduled posts, with and without funding news", () => {
  for (const day of [23, 24, 25, 26, 27, 28, 29]) for (const fundingHasNews of [true, false]) {
    let s = empty(); const got = [];
    for (let m = 0; m < 1440; m++) for (const line of ["up", "funding", "down"]) {
      if (line === "funding" && !fundingHasNews) continue;
      const now = new Date(Date.UTC(2026, 10, day, 0, m));
      if (decide({ line, cfg: real.lines[line], config: real, state: s, now, ...nokill }).ok) { s = recordPost(s, line, { postId: "p", sig: line, now }); got.push(line); }
    }
    assert.deepEqual(got, fundingHasNews ? ["up", "funding"] : ["up", "down"]);
  }
});
t("config.json: two line 3 posts earlier in the day do not block the two scheduled ones", () => {
  let s = empty(); for (const h of [1, 2]) s = recordPost(s, "new", { postId: "n" + h, sig: "n", now: at(h) });
  assert.equal(decide({ line: "up", cfg: real.lines.up, config: real, state: s, now: at(9, 30), ...nokill }).ok, true);
  s = recordPost(s, "up", { postId: "u", sig: "u", now: at(9, 30) });
  assert.equal(decide({ line: "down", cfg: real.lines.down, config: real, state: s, now: at(17, 30), ...nokill }).ok, true);
});

// ---- what lines 1 and 2 write (a fake page returns the data the real page would read from the app)
const fakePage = data => ({ sleep: async () => {}, send: async () => ({ result: { data: "" } }), ev: async x => x.includes("pairsRows") || x.includes("topFunding") ? JSON.stringify({ png: "data:image/png;base64,AAAA", ...data }) : x.includes("data:image/png;base64,") ? "data:image/png;base64,AAAA" : x.includes(".filter(i=>!i.complete)") ? 0 : 1 });
const mover = (n, c, v, crypto = true) => ({ n, c, v, crypto });
const when = new Date(Date.UTC(2026, 10, 27, 8, 31));
const run1 = async (name, fn) => { try { await fn(); n++; console.log("ok  ", name); } catch (e) { console.log("FAIL", name, "\n    ", e.message); process.exitCode = 1; } };
await run1("gainers: a thin leader is never skipped over by a 'LED WITH' headline", async () => {
  const p = await buildMovers(fakePage({ list: [mover("MINIMAX", 11.96, 8e3, false), mover("SEI", 11.6, 69e3), mover("SOXL", 11.1, 47e3, false), mover("PONS", 10.35, 13e3), mover("FET", 9.8, 29e3)], tiles: 24 }), "up", when);
  assert.doesNotMatch(p.text.split("\n")[0], /LED WITH|SEI/); assert.equal(p.claim, undefined);
});
await run1("gainers and losers: the headline names the first of the list when it is liquid and moved 10%+", async () => {
  const up = await buildMovers(fakePage({ list: [mover("ZZTOPA", 14.2, 90e3), mover("BBB", 9, 90e3), mover("CCC", 8, 90e3)], tiles: 9 }), "up", when);
  assert.equal(up.text.split("\n")[0], "ZZTOPA LED WITH +14.20%");
  const down = await buildMovers(fakePage({ list: [mover("ZZTOPB", -13.83, 63e3), mover("BBB", -9, 90e3), mover("CCC", -8, 90e3)], tiles: 9 }), "down", when);
  assert.equal(down.text.split("\n")[0], "ZZTOPB WAS HIT: −13.83%");
});
await run1("gainers: $ only on crypto among the first three places", async () => {
  const p = await buildMovers(fakePage({ list: [mover("MINIMAX", 5, 1e3, false), mover("SEI", 4, 1e3), mover("SOXL", 3, 1e3, false), mover("PONS", 2, 1e3), mover("FET", 1, 1e3)], tiles: 9 }), "up", when);
  assert.deepEqual(p.text.match(/\$[A-Z]+/g), ["$SEI"]); assert.match(p.text, /MINIMAX \+5\.00% · \$SEI \+4\.00% · SOXL \+3\.00% · PONS/);
});
const fcfg = { notableApr: 100, minApr: 50, maxPerSide: 3 }, f = (name, apr, tf = false) => ({ name, apr, tf, fund: apr / 8760 });
await run1("funding: no negative pair at all still builds, with no 'Shorts pay' line", async () => {
  const p = await buildFunding(fakePage({ high: [f("SKHYNIX", 123, true), f("XMR", 101)], low: [], n: 40 }), fcfg, when);
  assert.match(p.text, /Longs pay: SKHYNIX \+123% APR · \$XMR/); assert.doesNotMatch(p.text, /Shorts pay/); assert.match(p.alt, /Lowest, shorts pay: none right now\./); assert.deepEqual(p.numbersNotInData, []);
});
await run1("funding: only negative funding builds; quiet or empty data is skipped or refused", async () => {
  const p = await buildFunding(fakePage({ high: [], low: [f("CYBER", -217)], n: 40 }), fcfg, when);
  assert.match(p.text, /Shorts pay: \$CYBER −217% APR/); assert.doesNotMatch(p.text, /Longs pay/);
  assert.match((await buildFunding(fakePage({ high: [f("AAA", 51.7)], low: [], n: 40 }), fcfg, when)).skip, /nothing notable/);
  await assert.rejects(buildFunding(fakePage({ high: [], low: [], n: 0 }), fcfg, when), /no funding data/);
});

// ---- the key check (a fake X answers)
const KEYS = { X_API_KEY: "ck-AAAAAAAAAAAAAAAAAAAA", X_API_SECRET: "cs-BBBBBBBBBBBBBBBBBBBB", X_ACCESS_TOKEN: "12-CCCCCCCCCCCCCCCCCCCC", X_ACCESS_SECRET: "as-DDDDDDDDDDDDDDDDDDDD" };
const ask = async (env, status, body, level) => { const lines = [], calls = []; const code = await checkKeys({ env, say: t => lines.push(t), fetcher: async (url, o) => { calls.push({ url, method: o.method || "GET", auth: o.headers.Authorization }); return { ok: status < 300, status, headers: { get: () => level || null }, text: async () => JSON.stringify(body) }; } }); return { code, text: lines.join("\n"), calls }; };
await run1("key check: right account passes with one read and nothing else", async () => {
  const r = await ask(KEYS, 200, { data: { username: "Txfoliolab" } }, "read-write");
  assert.equal(r.code, 0); assert.match(r.text, /act for @Txfoliolab[\s\S]*read-write/); assert.equal(r.calls.length, 1); assert.equal(r.calls[0].method, "GET"); assert.equal(r.calls[0].url, "https://api.x.com/2/users/me"); assert.match(r.calls[0].auth, /^OAuth .*oauth_signature=/);
});
await run1("key check: another account, refused keys, no credits, missing or broken keys all fail", async () => {
  assert.match((await ask(KEYS, 200, { data: { username: "someoneelse" } })).text, /expected @Txfoliolab/);
  assert.equal((await ask(KEYS, 200, { data: { username: "someoneelse" } })).code, 1);
  assert.match((await ask(KEYS, 401, { title: "Unauthorized" })).text, /401[\s\S]*key is wrong/);
  assert.match((await ask(KEYS, 402, { title: "CreditsDepleted" })).text, /402[\s\S]*credits/);
  const none = await ask({ ...KEYS, X_ACCESS_SECRET: "" }, 200, {}); assert.equal(none.code, 1); assert.equal(none.calls.length, 0); assert.match(none.text, /missing X_ACCESS_SECRET/);
  const spaced = await ask({ ...KEYS, X_API_KEY: "ab cd" }, 200, {}); assert.equal(spaced.code, 1); assert.equal(spaced.calls.length, 0);
});
await run1("key check: a key echoed back by X never reaches the log", async () => {
  const r = await ask(KEYS, 401, { detail: "bad token " + Object.values(KEYS).join(" ") });
  for (const v of Object.values(KEYS)) assert.ok(!r.text.includes(v)); assert.match(r.text, /\[hidden\]/);
});

t("workflow timers match config.json: every timer picks a line, and each timed line gets a run soon after any planned minute", () => {
  const yml = fs.readFileSync(path.join(import.meta.dirname, ".github", "workflows", "social.yml"), "utf8");
  const crons = [...yml.matchAll(/^\s*- cron: "([^"]+)"/gm)].map(m => m[1]), picks = Object.fromEntries([...yml.matchAll(/^\s*"([^"]+)"\) LINE=(\w+) ;;/gm)].map(m => [m[1], m[2]]));
  assert.deepEqual(Object.keys(picks).sort(), [...crons].sort()); assert.deepEqual(Object.values(picks).sort(), Object.keys(real.lines).sort());
  for (const cron of crons) {
    const line = picks[cron], c = real.lines[line], [mins, hours] = cron.split(" ");
    if (c.anyTime) { assert.equal(hours, "*"); continue; }
    const [a, b] = hours.split("-").map(Number), times = []; for (let h = a; h <= (b ?? a); h++) for (const m of mins.split(",").map(Number)) times.push(h * 60 + m);
    for (let off = 0; off <= c.jitterMinutes; off++) { const planned = c.utcHour * 60 + off; assert.ok(times.some(x => x >= planned && x - planned <= 30 && x <= c.utcHour * 60 + c.windowMinutes), `${line}: no run within 30 min after minute ${off}`); }
  }
});

// ---- one outside timer for every line (tick.mjs)
const day = (fundingHasNews, every, shift, mode = "live") => {
  let s = empty(); const posted = [], ran = {};
  for (let m = shift; m < 1440; m += every) {
    const now = new Date(Date.UTC(2026, 10, 28, 0, m));
    tick({ config: real, load: () => s, now: () => now, say: () => {}, killPaths: [], run: line => { ran[line] = (ran[line] || 0) + 1; if (line !== "new" && !(line === "funding" && !fundingHasNews)) { if (mode === "live") s = recordPost(s, line, { postId: "p", sig: line, now }); posted.push(line); } return 0; } });
  }
  return { posted, ran };
};
t("one timer every 30 minutes, whatever minute it starts on, gives the two posts of the day", () => {
  for (let shift = 0; shift < 30; shift++) { assert.deepEqual(day(true, 30, shift).posted, ["up", "funding"], "shift " + shift); assert.deepEqual(day(false, 30, shift).posted, ["up", "down"], "quiet, shift " + shift); }
});
t("one timer: line new is looked at on every call; timed lines are not started outside their windows", () => {
  const { ran } = day(true, 30, 5); assert.equal(ran.new, 48); assert.equal(ran.up, 1); assert.equal(ran.funding, 1); assert.equal(ran.down, undefined);
});
t("one timer: a failing line does not stop the next one, and the call reports the failure", () => {
  const seen = []; const code = tick({ config: real, load: empty, now: () => at(9, 30), say: () => {}, killPaths: [], run: line => { seen.push(line); return line === "up" ? 1 : 0; } });
  assert.deepEqual(seen, ["up", "new"]); assert.equal(code, 1);
});
t("one timer: the kill file keeps every timed line closed", () => { const seen = []; tick({ config: real, load: empty, now: () => at(9, 30), say: () => {}, killPaths: ["/etc/hosts"], run: l => (seen.push(l), 0) }); assert.deepEqual(seen, ["new"]); });

t("workflow reads the newest state: runs are serialised and each one checks out the branch head, not the commit it was asked from", () => {
  const yml = fs.readFileSync(path.join(import.meta.dirname, ".github", "workflows", "social.yml"), "utf8");
  assert.match(yml, /concurrency:\n  group: social\n  cancel-in-progress: false/); assert.match(yml, /uses: actions\/checkout@v4\n        with:\n          ref: \$\{\{ github\.ref_name \}\}/);
});

// ---- line 3 (NEW ON TXFLOW), the whole run offline
const mk = (i, name, o = {}) => ({ index: i, name, lev: 20, halted: false, delisted: false, cat: "Stocks", ...o });
const BASE = Array.from({ length: 60 }, (_, i) => mk(i + 1, "AAA" + String.fromCharCode(65 + Math.floor(i / 26), 65 + i % 26)));
const hour = (h, d = 23) => new Date(Date.UTC(2026, 10, d, h, 23));
function rig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "folio-line3-"));
  const w = { dir, cur: BASE, posts: [], logs: [], renders: 0, failAt: null, posted: { lines: {}, days: {}, pendingReply: null } };
  const step = name => { if (w.failAt === name) throw new Error("fake X: " + name + " failed"); };
  w.run = (now, { mode = "live", cfg = {}, config = { dailyCap: 5 }, killPaths = [], late = 0 } = {}) => {
    let calls = 0;
    return runNewLine({ mode, config, now, cfg: { enabled: true, anyTime: true, maxPerDay: 2, reply: "none", ...cfg }, killPaths,
      marketsFile: path.join(dir, "state", "markets.json"), outDir: path.join(dir, "out"), clock: () => now.getTime() + (calls++ ? late : 0),
      loadPosted: () => structuredClone(w.posted), savePosted: s => { w.posted = structuredClone(s); }, log: e => w.logs.push(e),
      fetchMarkets: async () => w.cur, render: async (post, base) => { step("render"); w.renders++; fs.writeFileSync(base + ".png", "png"); },
      makeClient: () => ({ uploadImage: async () => { step("upload"); return "m1"; }, setAlt: async () => step("alt"), post: async b => { step("post"); w.posts.push(b); return "p" + w.posts.length; } }) });
  };
  w.state = () => JSON.parse(fs.readFileSync(path.join(dir, "state", "markets.json"), "utf8"));
  w.waiting = () => w.state().pending.map(e => e.kind + " " + e.name).join();
  w.said = decision => w.logs.filter(e => e.decision === decision).length;
  return w;
}
const add = (...names) => [...BASE, ...names.map((n, i) => mk(61 + i, n))];
const ta = async (name, fn) => { const q = console.log; let err = null; console.log = () => {}; try { await fn(); } catch (e) { err = e; } console.log = q; if (err) { console.log("FAIL", name, "\n    ", err.message); process.exitCode = 1; } else { n++; console.log("ok  ", name); } };
const rigs = []; const start = async () => { const w = rig(); rigs.push(w); await w.run(hour(1)); return w; };

await ta("line 3: first run saves a baseline and posts nothing", async () => { const w = await start(); assert.equal(w.posts.length, 0); assert.equal(w.state().markets.length, 60); assert.equal(w.said("baseline"), 1); });
await ta("line 3: nothing new writes nothing (no commit every hour); the check time is saved after 6 h", async () => {
  const w = await start(), a = w.state().savedAt; await w.run(hour(2)); assert.equal(w.state().savedAt, a); assert.equal(w.logs.length, 1); await w.run(hour(8)); assert.notEqual(w.state().savedAt, a);
});
await ta("line 3: a new market is posted once, with image and alt text, and not again", async () => {
  const w = await start(); w.cur = add("NEWCO"); assert.equal(await w.run(hour(2)), 0);
  assert.equal(w.posts.length, 1); assert.match(w.posts[0].text, /NEW ON TXFLOW[\s\S]*NEWCO/); assert.deepEqual(w.posts[0].mediaIds, ["m1"]); assert.equal(w.waiting(), ""); assert.equal(w.posted.days["2026-11-23"], 1);
  await w.run(hour(3)); assert.equal(w.posts.length, 1);
});
for (const where of ["render", "upload", "alt", "post"]) await ta(`line 3: failure at "${where}" keeps the change waiting, the next run posts it once`, async () => {
  const w = await start(); w.cur = add("NEWCO"); w.failAt = where; await assert.rejects(w.run(hour(2)), /fake X/);
  assert.equal(w.waiting(), "new NEWCO"); assert.equal(w.posts.length, 0); assert.deepEqual(w.posted.days, {});
  w.failAt = null; await w.run(hour(3)); await w.run(hour(4)); assert.equal(w.posts.length, 1); assert.equal(w.waiting(), "");
});
await ta("line 3: second post of a run fails, the first one is not repeated", async () => {
  const w = await start(); w.cur = BASE.map(m => m.index === 5 ? { ...m, delisted: true } : m).concat(mk(61, "NEWCO"));
  const real = w.run; let k = 0; const posts = w.posts; const push = posts.push.bind(posts); posts.push = b => { if (++k === 2) throw new Error("fake X: second post failed"); return push(b); };
  await assert.rejects(real(hour(2)), /second post/); assert.equal(w.waiting(), "delisted " + BASE[4].name); assert.equal(posts.length, 1);
  await real(hour(3)); assert.equal(posts.length, 2); assert.match(posts[1].text, /DELISTED/); assert.equal(w.waiting(), "");
});
await ta("line 3: dry run posts nothing, builds each draft once; switching to live posts it", async () => {
  const w = await start(); w.cur = add("NEWCO"); await w.run(hour(2), { mode: "dry" }); await w.run(hour(3), { mode: "dry" });
  assert.equal(w.posts.length, 0); assert.equal(w.renders, 1); assert.equal(w.said("dry-run"), 1); assert.equal(w.waiting(), "new NEWCO");
  await w.run(hour(4)); assert.equal(w.posts.length, 1);
});
await ta("line 3: a change older than 24 h is dropped with a log line, never posted", async () => {
  const w = await start(); w.cur = add("NEWCO"); await w.run(hour(9, 25)); assert.equal(w.posts.length, 0); assert.equal(w.waiting(), ""); assert.equal(w.said("dropped"), 1); assert.match(w.logs.find(e => e.decision === "dropped").reason, /new NEWCO/);
});
await ta("line 3: at most 2 posts a day, the rest waits", async () => {
  const w = await start(); for (const [h, names] of [[2, ["ONE"]], [3, ["ONE", "TWO"]], [4, ["ONE", "TWO", "THREE"]]]) { w.cur = add(...names); await w.run(hour(h)); }
  assert.equal(w.posts.length, 2); assert.equal(w.waiting(), "new THREE"); assert.match(w.logs.at(-1).reason, /maximum 2/); await w.run(hour(0, 24)); assert.equal(w.posts.length, 3);
});
await ta("line 3: the shared daily cap counts it too", async () => { const w = await start(); w.posted.days["2026-11-23"] = 5; w.cur = add("NEWCO"); await w.run(hour(2)); assert.equal(w.posts.length, 0); assert.equal(w.waiting(), "new NEWCO"); });
await ta("line 3: paused or kill file: nothing is read, written or logged", async () => {
  for (const o of [{ cfg: { enabled: false } }, { killPaths: ["/etc/hosts"] }]) { const w = rig(); rigs.push(w); await w.run(hour(1), o); assert.equal(fs.existsSync(path.join(w.dir, "state")), false); assert.equal(w.logs.length, 0); }
});
await ta("line 3: data older than 5 minutes is not posted", async () => { const w = await start(); w.cur = add("NEWCO"); assert.equal(await w.run(hour(2), { late: 6 * 60e3 }), 1); assert.equal(w.posts.length, 0); assert.equal(w.waiting(), "new NEWCO"); });
await ta("line 3: a damaged state file stops the run", async () => { const w = await start(); fs.writeFileSync(path.join(w.dir, "state", "markets.json"), "{broken"); await assert.rejects(w.run(hour(2)), /not starting over/); });
await ta("line 3: reopened market gets the BACK post", async () => {
  const w = rig(); rigs.push(w); await w.run(hour(1)); w.cur = BASE.map(m => m.index === 5 ? { ...m, delisted: true } : m); await w.run(hour(2)); w.cur = BASE; await w.run(hour(3));
  assert.equal(w.posts.length, 2); assert.match(w.posts[1].text, /A MARKET IS BACK ON TXFLOW/);
});
for (const w of rigs) fs.rmSync(w.dir, { recursive: true, force: true });
console.log(n + " checks passed");
