// Writing rules every post must pass before it can go out (ported from tools/social/seo_lint.mjs). A FAIL blocks the post.
export const xLen = t => { let n = 0; for (const ch of t.replace(/https?:\/\/\S+|\b[\w.-]+\.(xyz|com)\b\S*/g, "x".repeat(23))) n += /\p{Extended_Pictographic}/u.test(ch) ? 2 : 1; return n; };   // links count 23, emoji 2
const BAN = [[/24\/7/i, "claims 24/7 trading"], [/never sleep/i, "claims markets never sleep"], [/\b(buy|sell now|long now|short now|guaranteed|moon|will (go|rise|fall|pump|dump))\b/i, "reads like advice or a prediction"], [/!{2,}/, "shouting"]];
const DOMAIN = /https?:\/\/|\b[\w-]+\.(xyz|com|io|app|net|org|co)\b/i;   // X prices a post that contains a link at $0.20 instead of $0.015
/* replyMode: "none" (no reply is posted), "pointer" (a reply without any link, tells people where to look) or "link" (a reply with txfolio.xyz, costs $0.20) */
export function lint({ text, reply, alt }, { replyMode = "link" } = {}) {
  const fails = [], warns = [], lines = text.split("\n"), first2 = lines.slice(0, 2).join(" ");
  const len = xLen(text);
  if (len > 280) fails.push(`too long: ${len} characters as X counts them (limit 280)`); else if (len > 260) warns.push(`${len} characters, close to the limit`);
  if (!/TxFlow/i.test(first2)) warns.push("TxFlow is not in the first two lines");
  const cash = (text.match(/\$[A-Za-z]{2,}/g) || []).length; if (cash > 6) fails.push(`${cash} cashtags`); else if (cash > 4) warns.push(`${cash} cashtags`);
  if ((text.match(/#\w+/g) || []).length > 1) warns.push("more than one hashtag");
  if (!/not financial advice/i.test(text)) fails.push("no 'not financial advice' line");
  if (DOMAIN.test(text)) fails.push("a link or domain in the main post (X would bill it as a post with a link, $0.20)");
  for (const [re, why] of BAN) if (re.test(text)) fails.push(why);
  if (!alt) fails.push("no alt text"); else { if (alt.length > 1000) fails.push("alt text over 1000 characters"); if (!/not financial advice/i.test(alt)) warns.push("alt text has no disclaimer"); }
  if (replyMode === "link") { if (!reply) fails.push("no first reply"); else { if (!/txfolio\.xyz/.test(reply)) fails.push("first reply has no link"); if (!/not affiliated|independent/i.test(reply)) fails.push("first reply does not say the tool is independent"); } }
  if (replyMode === "pointer") { if (!reply) fails.push("no pointer reply"); else { if (DOMAIN.test(reply)) fails.push("the pointer reply contains a link or domain ($0.20 instead of $0.015)"); if (!/not affiliated|independent/i.test(reply)) fails.push("pointer reply does not say the tool is independent"); if (!/folio lab/i.test(reply)) fails.push("pointer reply does not name Folio Lab"); } }
  return { fails, warns, len };
}
