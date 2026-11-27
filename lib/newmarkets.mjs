// Line 3 (NEW ON TXFLOW), shared by the automation (lib/line_new.mjs) and the manual draft tool (tools/social/new_markets.mjs):
// reading the market list, finding what changed, the list of changes waiting to be posted, the post texts, their checks and the card.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { lint, xLen } from "./check.mjs";
import { findChrome } from "./browser.mjs";

export const MAX_AGE_H = 24, KINDS = ["new", "relisted", "delisted"];
export const isStale = (e, now) => now - new Date(e.since) > MAX_AGE_H * 36e5;   // `since` = the last check before the change was seen, so this is its oldest possible age
const pad = n => String(n).padStart(2, "0");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const stampOf = now => `${now.getUTCDate()} ${MON[now.getUTCMonth()]}, ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())} UTC`;

// ---- live data (TxFlow switched off webData2 in Nov 2026: categories come from the public marketTags call)
const info = async body => {
  for (let k = 0; k < 2; k++) {
    try {
      const r = await fetch("https://rpc.txflow.com/info", { method: "POST", headers: { "Content-Type": "application/json", "x-api-version": "2026-08-16" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      const j = await r.json(); if (j.success) return j.data;
    } catch {}
  }
  throw new Error("TxFlow API request failed: " + body.type);
};
/* requireTags: false = go on without categories (no $ and no "Category") when marketTags fails; true = throw */
export async function fetchMarkets({ requireTags = true } = {}) {
  const [meta, mt] = await Promise.all([info({ type: "perpMeta" }), info({ type: "marketTags" }).catch(e => { if (requireTags) throw e; console.log("WARNING: marketTags failed, posts will have no category and no $: " + e.message); return null; })]);
  const l2Name = new Map(((mt && mt.l2) || []).map(x => [x.id, x.name]));   // 1 Stocks, 2 Commodities, 4 Layer 1, 6 Layer 2, 7 DeFi, 8 AI, 9 Meme, 34 RWA, 67 FX, 68 Pre-IPO, 100 Indices, 10 Others
  const tagsById = new Map(((mt && mt.instrumentTags) || []).map(x => [String(x.instrumentId), x.tagIds || []]));
  const cur = meta.universe.map(u => {
    const cat = (tagsById.get(String(u.index)) || []).map(t => l2Name.get(t)).find(Boolean) || null;
    return { index: u.index, name: u.baseCurrency, lev: u.maxLeverage, halted: !!u.haltTrading, delisted: !!u.delisted, cat };
  });
  if (cur.length < 50) throw new Error("market list looks too short (" + cur.length + "), refusing to compare");
  return cur;
}

// ---- saved market state { savedAt, markets, pending, sent }. Only a missing file means "first run": a damaged file must stop the run, not silently start over
export function readMarketState(file) {
  let st = null;
  try { st = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw new Error("cannot read " + file + " (not starting over, fix or restore it): " + e.message); return null; }
  if (!Array.isArray(st.markets)) throw new Error(file + " has no market list, refusing to continue");
  return st;
}
export function writeMarketState(file, st) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + ".tmp", JSON.stringify(st, null, 1)); fs.renameSync(file + ".tmp", file); }

// everLive: has this market ever been seen open? false = only ever delisted (opening it later is a NEW market); null = unknown (saved by the old script)
export const snapshot = (old, cur) => cur.map(m => { const o = old.get(m.index); return { index: m.index, name: m.name, delisted: m.delisted, everLive: !m.delisted ? true : !o ? false : !o.delisted ? true : (o.everLive ?? null) }; });
export const goneFrom = (saved, cur) => { const have = new Set(cur.map(m => m.index)); return saved.filter(o => !have.has(o.index)); };

/* What changed against `old` (Map index -> saved market), applied to the pending list: new changes are added, changes undone before they were posted are cancelled. */
export function advance(old, cur, pendingIn, { since, foundAt }) {
  const found = [], cancelled = [];
  for (const m of cur) {
    const o = old.get(m.index);
    if (!o) { if (!m.delisted) found.push({ kind: "new", m }); }
    else if (o.delisted && !m.delisted) found.push({ kind: o.everLive === false ? "new" : "relisted", m });
    else if (!o.delisted && m.delisted) found.push({ kind: "delisted", m });
  }
  let pending = [...pendingIn];
  for (const { kind, m } of found) {
    const opposite = pending.filter(e => e.index === m.index && (kind === "delisted") !== (e.kind === "delisted"));
    if (opposite.length) { pending = pending.filter(e => !opposite.includes(e)); cancelled.push(...opposite); continue; }
    if (!pending.some(e => e.index === m.index && e.kind === kind)) pending.push({ kind, index: m.index, name: m.name, since, foundAt });
  }
  return { found, pending, cancelled };
}

// ---- the posts (numbers come only from the API fields above; a check rejects any other number)
// $ only when the API's own tags say it is crypto (Layer 1/2, DeFi, AI, Meme) and the ticker is letters only. A brand-new market with no tag gets no $,
// because the app's stock/commodity lists cannot know it yet and a wrong cashtag links to an unrelated symbol. Never on delisted markets.
const CRYPTO_CATS = new Set(["Layer 1", "Layer 2", "DeFi", "AI", "Meme"]);
const tag = m => (m.cat && CRYPTO_CATS.has(m.cat) && /^[A-Z]+$/.test(m.name)) ? "$" + m.name : m.name;
const REPLIES = [
  `Live map of every TxFlow pair: txfolio.xyz\nFree, read-only, no wallet connection. Independent tool, not affiliated with TxFlow.`,
  `Every TxFlow market on one live map, plus funding and spreads: txfolio.xyz\nRead-only, no wallet needed. Independent tool, not affiliated with TxFlow.`,
  `Want the full picture? Live heatmap, funding and spread for every TxFlow pair: txfolio.xyz\nFree and read-only. Independent tool, not affiliated with TxFlow.`
];
export const linkReply = now => REPLIES[Math.floor(now / 864e5) % REPLIES.length];
// one sentence with a list of names: every name if the post still fits, else the first ones "and N more"
const sentence = (list, build) => { for (let k = list.length; k >= 1; k--) { const t = build(list.slice(0, k).join(" · ") + (k < list.length ? ` and ${list.length - k} more` : ""), list.length > 1); if (xLen(t) <= 280 || k === 1) return t; } };
const CARD_MAX = 18;   // up to three lines at the small size
const cardNames = items => items.slice(0, CARD_MAX).map(m => m.name).join(" · ") + (items.length > CARD_MAX ? ` · +${items.length - CARD_MAX} more` : "");

function wording(kind, items, stamp) {
  const one = items.length === 1 ? items[0] : null, state = m => m.halted ? "Trading is paused right now" : "Trading: open";
  if (kind === "new") {
    let text = one ? `A NEW MARKET JUST APPEARED ON TXFLOW\nNEW ON TXFLOW · ${stamp}\n\n${tag(one)} is now in TxFlow's market list.\n${[one.cat ? "Category: " + one.cat : null, "Max leverage: " + one.lev + "x", state(one)].filter(Boolean).join(" · ")}\n\nNot financial advice` : null;
    for (let k = Math.min(5, items.length); !one && k >= 1; k--) {
      text = `NEW MARKETS JUST APPEARED ON TXFLOW\nNEW ON TXFLOW · ${stamp}\n\n${items.slice(0, k).map(m => [tag(m), m.cat, "max " + m.lev + "x"].filter(Boolean).join(" · ")).join("\n")}${items.length > k ? `\n…and ${items.length - k} more` : ""}\n\nNot financial advice`;
      if (xLen(text) <= 280) break;
    }
    return { text, headline: one ? one.name : items.length + " new markets", sub: one ? [one.cat, "Max leverage " + one.lev + "x"].filter(Boolean).join(" · ") : cardNames(items), title: "NEW ON TXFLOW", accent: "#7dfd6b", label: "New on TxFlow" };
  }
  if (kind === "relisted") {
    const text = one ? `A MARKET IS BACK ON TXFLOW\nTXFLOW MARKET WATCH · ${stamp}\n\n${tag(one)} is no longer marked as delisted in TxFlow's market list.\n${state(one)}\n\nNot financial advice`
      : sentence(items.map((m, i) => i < 3 ? tag(m) : m.name), l => `MARKETS ARE BACK ON TXFLOW\nTXFLOW MARKET WATCH · ${stamp}\n\n${l} are no longer marked as delisted in TxFlow's market list.\n\nNot financial advice`);
    return { text, headline: one ? one.name : items.length + " markets", sub: one ? "No longer marked as delisted" : cardNames(items), title: "BACK ON TXFLOW", accent: "#7dfd6b", label: "Back on TxFlow" };
  }
  const text = sentence(items.map(m => m.name), (l, many) => `${many ? "MARKETS WERE" : "A MARKET WAS"} DELISTED ON TXFLOW\nTXFLOW MARKET WATCH · ${stamp}\n\n${l} ${many ? "are" : "is"} now marked as delisted in TxFlow's market list.\n\nNot financial advice`);
  return { text, headline: one ? one.name : items.length + " markets", sub: one ? "Marked as delisted" : cardNames(items), title: "DELISTED ON TXFLOW", accent: "#ff7b7b", label: "Delisted on TxFlow" };
}
export function buildPost(kind, items, now) {
  const stamp = stampOf(now), p = { kind, items, stamp, now, ...wording(kind, items, stamp) };
  p.alt = `Card: ${p.label}. ${p.headline}. ${p.sub}. Seen ${stamp}. Independent tool, not financial advice.`;
  return p;
}
/* The gates: every number must come from the data, and the writing rules must pass. `reply` is only what would be posted automatically. */
export function checkPost(p, { reply = null, replyMode = "none" } = {}) {
  const digits = t => String(t || "").match(/\d+/g) || [];
  const allowed = new Set([String(p.now.getUTCDate()), pad(p.now.getUTCHours()), pad(p.now.getUTCMinutes()), String(p.items.length), ...p.items.flatMap(m => [String(m.lev), ...digits(m.name), ...digits(m.cat)]),
    ...[...(p.text + " " + p.sub).matchAll(/(?:and |\+)(\d+) more/g)].filter(x => +x[1] > 0 && +x[1] < p.items.length).map(x => x[1])]);
  const bad = digits(p.text + " " + p.alt).filter(t => !allowed.has(t));
  const lt = lint({ text: p.text, alt: p.alt, reply }, { replyMode });
  return { fails: [...(bad.length ? ["numbers not in the data: " + bad.join(" ")] : []), ...lt.fails], warns: lt.warns, len: lt.len };
}

// ---- simple text card (dark, same look as the funding card), drawn by headless Chrome at 2x. The mark is the notched Folio Lab logo used on the app's share images.
const MARK = `<svg width="26" height="26" viewBox="0 0 20 20"><polygon points="0,0 20,0 20,12 12,12 12,20 0,20" fill="#7dfd6b"/></svg>`;
export const cardHtml = p => `<!doctype html><meta charset=utf-8><link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet"><style>
  html,body{margin:0;width:1200px;height:630px;background:#0b0b0b;color:#fff;font-family:'Space Grotesk',-apple-system,Helvetica,Arial,sans-serif;overflow:hidden}
  .g{position:absolute;inset:0;background:radial-gradient(60% 70% at 30% 70%,${p.accent}22,transparent 70%),linear-gradient(#ffffff08 1px,transparent 1px) 0 0/60px 60px,linear-gradient(90deg,#ffffff08 1px,transparent 1px) 0 0/60px 60px}
  .b{position:absolute;left:60px;top:48px;display:flex;align-items:center;gap:12px;font-size:30px;font-weight:700}
  .t{position:absolute;left:60px;top:182px;font-size:26px;letter-spacing:.14em;color:${p.accent};font-weight:700}
  .h{position:absolute;left:60px;top:232px;font-size:${p.headline.length > 9 ? 110 : 150}px;font-weight:700;line-height:1;white-space:nowrap}
  .s{position:absolute;left:62px;right:60px;top:412px;font-size:${p.items.length > 8 ? 30 : 36}px;line-height:1.35;color:#cfd3cf}
  .s span{white-space:nowrap}
  .f{position:absolute;left:60px;bottom:40px;font-size:18px;color:#9aa09a}</style>
  <div class=g></div><div class=b>${MARK}Folio Lab</div><div class=t>${p.title}</div><div class=h>${p.headline}</div><div class=s>${p.sub.split(" · ").map(x => "<span>" + x + "</span>").join(" · ")}</div>
  <div class=f>${p.stamp} · Independent tool · not affiliated with TxFlow · not financial advice</div>`;

/* Writes <base>.png from <base>-card.html (written here too). Throws if no image comes out. */
export function renderCard(p, base) {
  fs.writeFileSync(base + "-card.html", cardHtml(p)); fs.rmSync(base + ".png", { force: true });
  execFileSync(findChrome(), ["--headless=new", "--disable-gpu", "--hide-scrollbars", ...(process.platform === "linux" ? ["--no-sandbox"] : []), "--window-size=1200,630", "--force-device-scale-factor=2", "--virtual-time-budget=4000", "--screenshot=" + base + ".png", "file://" + path.resolve(base + "-card.html")], { stdio: "ignore", timeout: 60000 });
  if (!fs.existsSync(base + ".png")) throw new Error("Chrome made no image");
}
