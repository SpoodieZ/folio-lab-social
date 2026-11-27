// Posting to X through the official API. NOT tested against the live API yet (it needs the account's keys): the first real post must be done together with the owner.
// Auth: OAuth 1.0a user context (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET) or an OAuth 2.0 user token (X_USER_TOKEN, scopes tweet.read tweet.write users.read media.write).
// Endpoints (docs.x.com, read 2026-11-23): POST /2/media/upload (tweet_image, PNG up to 5 MB), POST /2/media/metadata (alt text), POST /2/tweets (text, media ids, reply).
import crypto from "node:crypto";
const API = "https://api.x.com";
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/* OAuth 1.0a header. bodyParams: only for form-encoded bodies (JSON and multipart bodies are not part of the signature). */
export function oauth1Header(method, url, c, { bodyParams = {}, nonce, timestamp } = {}) {
  const u = new URL(url);
  const oa = { oauth_consumer_key: c.key, oauth_nonce: nonce || crypto.randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1", oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)), oauth_token: c.token, oauth_version: "1.0" };
  const all = { ...oa, ...bodyParams }; for (const [k, v] of u.searchParams) all[k] = v;
  const pairs = Object.entries(all).map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1);
  const base = [method.toUpperCase(), enc(u.origin + u.pathname), enc(pairs.map(p => p.join("=")).join("&"))].join("&");
  const sig = crypto.createHmac("sha1", enc(c.secret) + "&" + enc(c.tokenSecret)).update(base).digest("base64");
  return "OAuth " + Object.entries({ ...oa, oauth_signature: sig }).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(", ");
}

export function credsFromEnv(env = process.env) {
  if (env.X_USER_TOKEN) return { kind: "oauth2", token: env.X_USER_TOKEN };
  const need = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"], miss = need.filter(k => !env[k]);
  if (miss.length) return { kind: "none", missing: miss };
  return { kind: "oauth1", key: env.X_API_KEY, secret: env.X_API_SECRET, token: env.X_ACCESS_TOKEN, tokenSecret: env.X_ACCESS_SECRET };
}

export function makeX(creds) {
  if (creds.kind === "none") throw new Error("X credentials missing: " + creds.missing.join(", "));
  const auth = (method, url) => creds.kind === "oauth2" ? "Bearer " + creds.token : oauth1Header(method, url, creds);
  async function call(method, path, { json, form }) {
    const url = API + path, headers = { Authorization: auth(method, url) }; let body;
    if (json) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); } else body = form;
    const r = await fetch(url, { method, headers, body }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 300) }; }
    if (!r.ok) throw new Error(`X API ${method} ${path} -> ${r.status} ${JSON.stringify(j).slice(0, 400)}`);
    return j;
  }
  return {
    async uploadImage(png) { const f = new FormData(); f.append("media_category", "tweet_image"); f.append("media", new Blob([png], { type: "image/png" }), "card.png"); const j = await call("POST", "/2/media/upload", { form: f }); return j.data?.id || (() => { throw new Error("no media id in " + JSON.stringify(j).slice(0, 200)); })(); },
    async setAlt(id, text) { await call("POST", "/2/media/metadata", { json: { id, metadata: { alt_text: { text } } } }); },
    async post({ text, mediaIds, replyTo }) { const body = { text }; if (mediaIds?.length) body.media = { media_ids: mediaIds }; if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo }; const j = await call("POST", "/2/tweets", { json: body }); return j.data?.id || (() => { throw new Error("no post id in " + JSON.stringify(j).slice(0, 200)); })(); }
  };
}
