// Asks X which account the saved keys belong to:  node check_keys.mjs
// One read (GET /2/users/me). It never posts, uploads or changes anything. No key is ever printed.
// It proves the four keys are accepted and which account they act for; it does NOT prove that posting will work (write permission, credits for posting).
import { credsFromEnv, oauth1Header } from "./lib/x.mjs";

const URL_ME = "https://api.x.com/2/users/me";
export async function checkKeys({ env = process.env, fetcher = fetch, say = console.log } = {}) {
  const expected = env.EXPECT_USER || "Txfoliolab";
  const secrets = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET", "X_USER_TOKEN"].map(k => env[k]).filter(Boolean);
  const out = t => say(secrets.reduce((s, v) => s.split(v).join("[hidden]"), String(t)));   // whatever X sends back, a key never reaches the log
  const c = credsFromEnv(env);
  if (c.kind === "none") { out("FAIL: missing " + c.missing.join(", ")); return 1; }
  const spaced = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"].filter(k => env[k] && /\s/.test(env[k]));
  if (spaced.length) { out("FAIL: there is a space or line break inside " + spaced.join(", ") + ". Save it again."); return 1; }
  let r, body;
  try {
    r = await fetcher(URL_ME, { headers: { Authorization: c.kind === "oauth2" ? "Bearer " + c.token : oauth1Header("GET", URL_ME, c) }, signal: AbortSignal.timeout(30000) });
    const t = await r.text(); try { body = JSON.parse(t); } catch { body = { detail: t.slice(0, 300) }; }
  } catch (e) { out("FAIL: could not reach X: " + e.message); return 1; }
  const level = r.headers?.get?.("x-access-level");
  if (!r.ok) {
    out(`FAIL: X answered ${r.status}: ${[body.title, body.detail].filter(Boolean).join(" · ") || JSON.stringify(body).slice(0, 300)}`);
    if (r.status === 401) out("Hint: a key is wrong or no longer valid. Check that the four names hold the matching values, and that the Access Token was made after the last Consumer Key regeneration.");
    if (r.status === 402) out("Hint: this usually means the account has no API credits (Billing > Credits in the Developer Console).");
    if (r.status === 403) out("Hint: X refused the request for this app or account. Read X's message above.");
    if (r.status === 429) out("Hint: too many requests, try again later.");
    return 1;
  }
  const user = body.data?.username;
  if (!user) { out("FAIL: X answered without an account name"); return 1; }
  if (user.toLowerCase() !== expected.toLowerCase()) { out(`FAIL: the keys act for @${user}, expected @${expected}. Do not switch to live.`); return 1; }
  out(`OK: X accepts the keys and they act for @${user}.`);
  out(level ? `Access level reported by X: ${level}` : "X did not report an access level: write permission is only proven by a real post.");
  return 0;
}
if (import.meta.url === "file://" + process.argv[1]) process.exit(await checkKeys());
