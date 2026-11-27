// Headless Chrome driven over the DevTools protocol (no dependencies), plus a tiny static server for the app copy in ./app.
// The images are drawn by the app itself (the same code as the site's "Share image" button), so a post image always matches the public site.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
export const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg", ".txt": "text/plain" };

export function serveDir(dir) {
  const root = path.resolve(dir);
  return new Promise((resolve, reject) => {
    const srv = createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
      const f = path.join(root, path.normalize(p));
      if (!f.startsWith(root) || !existsSync(f) || statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); rsp.end(readFileSync(f));
    });
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${srv.address().port}/`, close: () => srv.close() }));
  });
}

export function findChrome() {
  const c = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
  const f = c.find(x => existsSync(x)); if (!f) throw new Error("no Chrome found: set the CHROME environment variable"); return f;
}

export async function launchChrome() {
  const port = 9300 + Math.floor(Math.random() * 600), profile = mkdtempSync(path.join(os.tmpdir(), "folio-chrome-"));
  const proc = spawn(findChrome(), ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let targets; for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.length) break; } catch {} await sleep(250); }
  if (!targets?.length) { proc.kill(); throw new Error("Chrome did not start"); }
  const ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const w = new Map(); ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; w.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error("page error: " + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };
  await send("Page.enable"); await send("Runtime.enable");
  return { send, ev, sleep, close() { try { ws.close(); } catch {} proc.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch {} } };
}

/* Opens the app's live pairs page (no wallet needed) and waits until the 24h stats of every market are read. Throws when the data does not arrive. */
export async function openApp(page, url) {
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.send("Page.navigate", { url: url + "?x=" + Date.now() });
  await sleep(3500);
  await page.ev(`[...document.querySelectorAll("button,a")].find(b=>/browse live pairs/i.test(b.textContent)).click(); 1`);
  let keys = 0;
  for (let k = 0; k < 120; k++) {
    const o = JSON.parse(await page.ev(`JSON.stringify({busy:!!PX.volBusy,keys:Object.keys(PX.vol).length})`)); keys = o.keys;
    if (!o.busy && o.keys > 100) break; await sleep(1500);
  }
  if (keys <= 100) throw new Error("market data did not load (only " + keys + " markets)");
  await sleep(3000);   // a little more for the live prices
  return keys;
}
