/**
 * X (Twitter) API v2 client — user-context OAuth 1.0a, zero dependencies.
 * Endpoints used:
 *   POST /2/tweets            — create tweet (or reply via in_reply_to_tweet_id)
 *   GET  /2/users/me          — auth check (returns @username)
 */

const { buildAuthHeader } = require("./oauth1");

const API = "https://api.twitter.com";

function credsFrom(env) {
  return {
    consumerKey: env.X_API_KEY,
    consumerSecret: env.X_API_SECRET,
    token: env.X_ACCESS_TOKEN,
    tokenSecret: env.X_ACCESS_SECRET,
  };
}

function headersFor(method, urlPath, queryParams, creds) {
  const auth = buildAuthHeader(method, `${API}${urlPath}`, queryParams || {}, creds);
  return { Authorization: auth, "Content-Type": "application/json" };
}

/** Verify credentials. Returns { id, username } of the authenticated user. */
async function authCheck(env) {
  const creds = credsFrom(env);
  const res = await fetch(`${API}/2/users/me`, {
    method: "GET",
    headers: headersFor("GET", "/2/users/me", {}, creds),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`X auth check failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body.data;
}

/** Post a tweet, or a reply when opts.replyTo is given. Returns { id, text }. */
async function postTweet(env, text, opts = {}) {
  const creds = credsFrom(env);
  const payload = { text };
  if (opts.replyTo) payload.reply = { in_reply_to_tweet_id: String(opts.replyTo) };
  const res = await fetch(`${API}/2/tweets`, {
    method: "POST",
    headers: headersFor("POST", "/2/tweets", {}, creds),
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`X post failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body.data;
}

module.exports = { authCheck, postTweet };
