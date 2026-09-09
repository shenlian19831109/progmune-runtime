/**
 * Weibo client — POST https://api.weibo.com/2/statuses/update.json
 * Form-encoded (application/x-www-form-urlencoded), zero dependencies.
 *
 * ⚠️ Access reality check (2026): Weibo has restricted app-based posting —
 *    statuses/update generally requires an 企业认证 app with the 微博
 *    content permission. A personal/open-platform token will likely be
 *    rejected with error 20019 / 10006 etc. Validate with authCheck() first.
 */

const API = "https://api.weibo.com/2";

/** Verify token. Returns { id, screen_name } of the authenticated user. */
async function authCheck(env) {
  const res = await fetch(`${API}/account/get_uid.json?access_token=${encodeURIComponent(env.WEIBO_ACCESS_TOKEN)}`, {
    method: "GET",
  });
  const body = await res.json();
  if (!res.ok || body.error_code) {
    throw new Error(`Weibo auth check failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

/** Post a status. Returns the created status id. */
async function postStatus(env, text) {
  const form = new URLSearchParams();
  form.set("access_token", env.WEIBO_ACCESS_TOKEN);
  form.set("status", text);
  if (env.WEIBO_APP_KEY) form.set("source", env.WEIBO_APP_KEY);

  const res = await fetch(`${API}/statuses/update.json`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const body = await res.json();
  if (!res.ok || body.error_code) {
    throw new Error(`Weibo post failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

module.exports = { authCheck, postStatus };
