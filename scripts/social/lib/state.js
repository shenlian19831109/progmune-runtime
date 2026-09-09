/**
 * Posting state (idempotency guard). Records which day/platform was already
 * posted, with returned tweet ids. State lives in scripts/social/.state/
 * (gitignored) — never in git.
 */

const fs = require("fs");
const path = require("path");

const STATE_DIR = path.join(__dirname, "..", ".state");
const STATE_FILE = path.join(STATE_DIR, "state.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return { posted: {} };
  }
}

function save(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Returns the recorded entry for (platform, day), or null. */
function get(platform, day) {
  return load().posted[`${platform}:${day}`] || null;
}

/** Mark (platform, day) as posted with the platform's returned ids. */
function mark(platform, day, ids) {
  const state = load();
  state.posted[`${platform}:${day}`] = { ids, postedAt: new Date().toISOString() };
  save(state);
}

module.exports = { get, mark, load, STATE_FILE };
