/**
 * Dev.to API client (B-level: semi-auto). Dev.to lets you create DRAFTS
 * via API (published:false) — the human confirms/publishes in the web UI.
 * Zero dependencies.
 */

const API = "https://dev.to/api";

function headers(env) {
  return { "api-key": env.DEV_API_KEY, "Content-Type": "application/json" };
}

/** Verify API key. Returns the authenticated user object. */
async function authCheck(env) {
  const res = await fetch(`${API}/users/me`, { method: "GET", headers: headers(env) });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Dev.to auth check failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

/** Create a draft article (not published). Returns the article. */
async function createDraft(env, { title, body_markdown, tags = [], published = false }) {
  const res = await fetch(`${API}/articles`, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify({
      article: { title, body_markdown, tags: tags.slice(0, 4), published },
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Dev.to draft create failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

module.exports = { authCheck, createDraft };
