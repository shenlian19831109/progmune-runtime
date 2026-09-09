/**
 * Zero-dependency OAuth 1.0a (HMAC-SHA1) signing — used for X API v2
 * user-context requests. Pure Node (crypto), no packages required.
 */

const crypto = require("crypto");

function rfc3986(str) {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

/** Build the OAuth Authorization header for an HTTP request.
 * @param {string} method  e.g. "POST"
 * @param {string} url     full URL, WITHOUT query string
 * @param {object} queryParams  query-string params (empty for JSON POSTs)
 * @param {object} creds   { consumerKey, consumerSecret, token, tokenSecret }
 * @returns {string} value for the Authorization header
 */
function buildAuthHeader(method, url, queryParams, creds) {
  const oauth = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.token,
    oauth_version: "1.0",
  };

  // Signature base string: all oauth params + query params, sorted, encoded.
  const params = { ...queryParams, ...oauth };
  const paramStr = Object.keys(params)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(String(params[k]))}`)
    .join("&");

  const base = `${method.toUpperCase()}&${rfc3986(url)}&${rfc3986(paramStr)}`;
  const key = `${rfc3986(creds.consumerSecret)}&${rfc3986(creds.tokenSecret)}`;
  const signature = crypto.createHmac("sha1", key).update(base).digest("base64");
  oauth.oauth_signature = signature;

  return (
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${rfc3986(k)}="${rfc3986(String(oauth[k]))}"`)
      .join(", ")
  );
}

module.exports = { buildAuthHeader, rfc3986 };
