// The posts of lines 1 and 2, ported from tools/social/funding_demo.mjs and snapshot_demo.mjs. Each builder returns
// { text, reply, alt, png, sig, numbersNotInData } or { skip: "reason" }.  Everything comes from ONE read of the app's live data (the rule "text, image and alt text agree").
import { pickHook, claimEvent, EVENT_MIN_VOLUME } from "./hooks.mjs";

const pad = n => String(n).padStart(2, "0");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const stampOf = now => `${now.getUTCDate()} ${MON[now.getUTCMonth()]}, ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())} UTC`;
const REPLIES = [
  `Live map of every TxFlow pair: txfolio.xyz\nFree, read-only, no wallet connection. Independent tool, not affiliated with TxFlow.`,
  `Every TxFlow market on one live map, plus funding and spreads: txfolio.xyz\nRead-only, no wallet needed. Independent tool, not affiliated with TxFlow.`,
  `Want the full picture? Live heatmap, funding and spread for every TxFlow pair: txfolio.xyz\nFree and read-only. Independent tool, not affiliated with TxFlow.`
];

// Replies WITHOUT a link, for the "pointer" mode: they say where to look (the profile link, the pinned post) instead of giving a URL.
const POINTERS = [
  `Live map, funding and spreads for every TxFlow pair: Folio Lab, link in our bio.\nFree, read-only, no wallet needed. Independent tool, not affiliated with TxFlow.`,
  `Want to check it yourself? Folio Lab shows every TxFlow pair live. Tap our profile for the link.\nRead-only, no wallet connection. Independent tool, not affiliated with TxFlow.`,
  `Same numbers, live, for every TxFlow market: Folio Lab (link in bio and in the pinned post).\nFree and read-only. Independent tool, not affiliated with TxFlow.`
];
export const pointerFor = (now, offset = 0) => POINTERS[(Math.floor(now / 864e5) + offset) % POINTERS.length];

/* ---------- line 1: FUNDING RADAR ---------- */
export async function buildFunding(page, cfg, now) {
  const out = JSON.parse(await page.ev(`(async()=>{ if(document.fonts&&document.fonts.ready) await document.fonts.ready;
    openShare(); $("shMode").value="fund"; await new Promise(r=>setTimeout(r,900)); drawShare();   /* openShare() defaults to the heatmap image, so choose the funding image after it */
    const T=topFunding(); const mk=r=>Object.assign({},r,{tf:hmHas(r.name,"tradfi",r.tags)}); return JSON.stringify({ high:T.high.slice(0,5).map(mk), low:T.low.slice(0,5).map(mk), n:T.n, png:$("shCanvas").toDataURL("image/png") }); })()`));
  if (!out.high?.length || !out.low?.length) throw new Error("no funding data on the page");
  const hi = out.high[0].apr, lo = out.low[0].apr;
  if (!(hi >= cfg.notableApr || lo <= -cfg.notableApr)) return { skip: `nothing notable: highest APR ${hi.toFixed(1)}%, lowest ${lo.toFixed(1)}% (needs ${cfg.notableApr}% either way)`, numbers: { hi, lo } };
  const stamp = stampOf(now), fmt = r => (r.apr >= 0 ? "+" : "−") + Math.abs(r.apr).toFixed(0) + "%";
  const tag = (n, tf) => (!tf && /^[A-Z]+$/.test(n)) ? "$" + n : n;   // cashtags on crypto only: stocks, ETFs and commodities would link to unrelated symbols
  const item = (r, withApr) => tag(r.name, r.tf) + " " + fmt(r) + (withApr ? " APR" : "");
  const H = out.high.filter(r => r.apr >= cfg.minApr).slice(0, cfg.maxPerSide), L = out.low.filter(r => r.apr <= -cfg.minApr).slice(0, cfg.maxPerSide);
  const side = [H.length ? `🟢 Longs pay: ${H.map((r, i) => item(r, i === 0)).join(" · ")}` : null, L.length ? `🔴 Shorts pay: ${L.map((r, i) => item(r, i === 0)).join(" · ")}` : null].filter(Boolean).join("\n\n");
  const topF = Math.abs(hi) >= Math.abs(lo) ? out.high[0] : out.low[0];
  const HOOK = pickHook("funding", Math.floor(now / 864e5), { name: topF.name, apr: topF.apr });
  const text = `${HOOK}\nTop funding on TxFlow (${stamp}):\n\n${side}\n\nAPR = hourly rate × 24 × 365 · not financial advice`;
  const reply = `Live funding, spreads and a heatmap for every TxFlow pair: txfolio.xyz\nFree, read-only, no wallet connection. Independent tool, not affiliated with TxFlow.`;
  const alt = `Top funding rates on TxFlow, ${stamp}. Highest, longs pay: ` + out.high.slice(0, 5).map(r => r.name + " " + fmt(r) + " APR").join(", ") + ". Lowest, shorts pay: " + out.low.slice(0, 5).map(r => r.name + " " + fmt(r) + " APR").join(", ") + ". Independent tool, not financial advice.";
  const allowed = new Set([...out.high.slice(0, 5), ...out.low.slice(0, 5)].map(fmt).concat([String(now.getUTCDate()), pad(now.getUTCHours()), pad(now.getUTCMinutes()), "24", "365"]));
  const numbersNotInData = ((text + " " + alt).match(/[+−]?\d[\d,]*(?:\.\d+)?%?/g) || []).filter(x => !allowed.has(x) && !/^\d{2}:\d{2}$/.test(x));
  return { text, reply, pointer: pointerFor(now), alt, png: Buffer.from(out.png.split(",")[1], "base64"), sig: JSON.stringify({ H: H.map(r => r.name), L: L.map(r => r.name) }), numbersNotInData, numbers: { hi, lo, listed: H.length + L.length } };
}

/* ---------- line 2: TOP GAINERS / TOP LOSERS (mode "up" | "down") ---------- */
const MAX_TILES = 24;   // the image shows only the 24 biggest moves so the labels stay readable in the X timeline (list and image still match)
export async function buildMovers(page, mode, now) {
  const UP = mode === "up";
  await page.ev(`HM.max=${MAX_TILES}; document.querySelector('#hmChips [data-hmcat="all"]').click(); document.querySelector('#hmSize [data-hmsize="move"]').click(); document.querySelector('#hmDir [data-hmdir="${mode}"]').click(); 1`);
  await page.sleep(2500);
  // the card image: ONLY the live heatmap (size = 24h move, direction = mode), scaled to fill a 1200x675 frame (no logo, title or footer text)
  await page.ev(`(()=>{
    const m=document.getElementById("hmMap"); m.scrollIntoView({block:"center"});
    const Wm=m.clientWidth,Hm=m.clientHeight, P=12, s=Math.min((1200-2*P)/Wm,(675-2*P)/Hm);
    const card=document.createElement("div"); card.id="xcard";
    card.style.cssText="position:fixed;left:0;top:0;width:1200px;height:675px;background:#0b0b0b;z-index:99999;color:#fff;overflow:hidden;font-family:"+getComputedStyle(document.body).fontFamily;
    card.innerHTML='<style>#xcard *{transition:none!important;animation:none!important}</style>';
    const holder=document.createElement("div"); holder.style.cssText="position:absolute;top:"+((675-Hm*s)/2)+"px;left:"+((1200-Wm*s)/2)+"px;width:"+Wm+"px;height:"+Hm+"px;transform-origin:0 0;transform:scale("+s+")";
    const clone=m.cloneNode(true); clone.removeAttribute("id"); clone.style.cssText="position:relative;width:"+Wm+"px;height:"+Hm+"px"; holder.appendChild(clone); card.appendChild(holder);
    document.body.appendChild(card); return 1; })()`);
  await page.sleep(600);
  for (let k = 0; k < 16; k++) { const left = await page.ev(`[...document.querySelectorAll("#xcard img")].filter(i=>!i.complete).length`); if (!left) break; await page.sleep(500); }   // logos from the web load a moment after the tiles
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false }); await page.sleep(1500);
  const sc = await page.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  // the card sits in the top-left 1200x675 CSS px of the viewport (2400x1350 device px): crop it inside the page, no image library needed
  const cropped = await page.ev(`(async()=>{ const img=new Image(); img.src="data:image/png;base64,${sc.result.data}"; await img.decode(); const c=document.createElement("canvas"); c.width=2400; c.height=1350; c.getContext("2d").drawImage(img,0,0,2400,1350,0,0,2400,1350); return c.toDataURL("image/png").split(",")[1]; })()`);
  const png = Buffer.from(cropped, "base64");
  // the data is read from the tiles that are ON the image, so the post always matches the heatmap exactly
  const data = JSON.parse(await page.ev(`JSON.stringify((()=>{
    const volById=new Map(pairsRows().map(r=>[String(r.id),r.vol]));
    const vis=[...document.querySelectorAll("#xcard .hmTile")].map(e=>{ const lab=e.getAttribute("aria-label")||"", i=lab.lastIndexOf(", "), n=lab.slice(0,i);
      return { n, c:parseFloat(lab.slice(i+2).replace("\\u2212","-")), v:volById.get(e.dataset.id)||0, cm:hmHas(n,"comm",(PX.vol[e.dataset.id]||{}).tags) }; }).filter(r=>r.n&&isFinite(r.c));
    vis.sort((a,b)=>${UP ? "b.c-a.c" : "a.c-b.c"});
    return { list:vis.slice(0,5), tiles:vis.length };
  })())`));
  if (data.list.length < 3) return { skip: `only ${data.list.length} market(s) on this side of the map`, numbers: { tiles: data.tiles } };
  const stamp = stampOf(now), sgn = c => (c >= 0 ? "+" : "−") + Math.abs(c).toFixed(2) + "%";
  const CASHTAGS = 3;   // $ on the first 3 tickers (letters only); commodities and FX never get one
  const item = (r, i) => ((i < CASHTAGS && !r.cm && /^[A-Z]+$/.test(r.n)) ? "$" + r.n : r.n) + " " + sgn(r.c);
  const dayIdx = Math.floor(now / 864e5);
  let hookTop = null; const cand = data.list.find(r => r.v >= EVENT_MIN_VOLUME);
  if (cand && Math.abs(cand.c) >= 10 && claimEvent(dayIdx, cand.n, { save: false })) hookTop = { name: cand.n, chg: cand.c, claim: cand.n };
  const HOOK = pickHook(mode, dayIdx, hookTop);
  const text = `${HOOK}\n${UP ? "TOP GAINERS" : "TOP LOSERS"} · TxFlow · ${stamp} (24h)\n\n${UP ? "🟢" : "🔴"} ${data.list.map(item).join(" · ")}\n\nBiggest 24h moves on the heatmap · not financial advice`;
  const reply = REPLIES[(dayIdx + (UP ? 0 : 1)) % REPLIES.length];
  const alt = `Heatmap of TxFlow markets that are ${UP ? "up" : "down"} over 24h, ${stamp}. Tile size is the size of the 24h move. Biggest: ` + data.list.map(r => r.n + " " + sgn(r.c)).join(", ") + ". Independent tool, not financial advice.";
  const allowed = new Set(data.list.map(r => sgn(r.c)).concat([String(now.getUTCDate()), pad(now.getUTCHours()), pad(now.getUTCMinutes()), "24"]));
  const numbersNotInData = ((text + " " + alt).match(/[+−]?\$?\d[\d.,]*[%MKB]?/g) || []).filter(t => !allowed.has(t) && !/^\d{2}:\d{2}$/.test(t));
  return { text, reply, pointer: pointerFor(now, UP ? 0 : 1), alt, png, sig: JSON.stringify(data.list.map(r => r.n)), numbersNotInData, claim: hookTop?.claim, numbers: { listed: data.list.length, top: data.list[0].c } };
}
