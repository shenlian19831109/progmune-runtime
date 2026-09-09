#!/usr/bin/env node
/**
 * Progmune social publisher — posts one day's content to X and/or Weibo.
 *
 * Usage:
 *   node scripts/social/publish.js x     1            # post X day 1
 *   node scripts/social/publish.js weibo 1            # post Weibo day 1
 *   node scripts/social/publish.js weibo today        # post today's piece
 *   node scripts/social/publish.js all   1            # X + Weibo day 1
 *   node scripts/social/publish.js x     1 --dry-run  # preview only
 *   node scripts/social/publish.js x     1 --force    # post even if recorded
 *
 * Credentials: read from scripts/social/.env (see .env.example) or process env.
 * Idempotent: a day already posted is skipped unless --force.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SOCIAL = __dirname;
const state = require("./lib/state");

// ── tiny .env loader (no dependency) ──
function loadEnv() {
  const envFile = path.join(SOCIAL, ".env");
  const out = { ...process.env };
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf-8").split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

function readContent(platform, day) {
  const file = path.join(SOCIAL, "content", platform, `day${day}.json`);
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

async function main() {
  const args = process.argv.slice(2);
  const platformArg = args[0];
  const dayArg = args[1];
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");

  if (!["x", "weibo", "all"].includes(platformArg) || !dayArg) {
    console.error(
      "usage: node scripts/social/publish.js <x|weibo|all> <1..7> [--dry-run] [--force]"
    );
    process.exit(2);
  }

  // Map "today" → matching day number by scanning content dates.
  let day;
  if (dayArg === "today") {
    const today = new Date().toISOString().slice(0, 10);
    for (const p of ["x", "weibo"]) {
      for (let d = 1; d <= 7; d++) {
        const c = readContent(p, d);
        if (c.date === today) {
          if (p === platformArg || platformArg === "all") day = d;
        }
      }
    }
    if (!day) {
      console.error(`no content dated ${today} — nothing to post today`);
      process.exit(1);
    }
  } else {
    day = parseInt(dayArg, 10);
    if (isNaN(day) || day < 1 || day > 7) {
      console.error("day must be 1..7 or 'today'");
      process.exit(2);
    }
  }

  const env = loadEnv();
  const targets = platformArg === "all" ? ["x", "weibo"] : [platformArg];

  // Dry-run only previews content — no credentials required.
  if (!dryRun) {
    const missing = [];
    if (targets.includes("x") && !(env.X_API_KEY && env.X_ACCESS_TOKEN)) missing.push("X (X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET)");
    if (targets.includes("weibo") && !env.WEIBO_ACCESS_TOKEN) missing.push("Weibo (WEIBO_ACCESS_TOKEN)");
    if (missing.length) {
      console.error(`missing credentials for: ${missing.join(", ")}\n→ fill scripts/social/.env (see .env.example)`);
      process.exit(2);
    }
  }

  for (const platform of targets) {
    const existing = state.get(platform, day);
    if (existing && !force) {
      console.log(`[skip] ${platform} day${day} already posted (${existing.postedAt}) — use --force to repost`);
      continue;
    }
    const content = readContent(platform, day);
    console.log(`\n── ${platform.toUpperCase()} · day ${day} · ${content.date} · ${content.label} ──`);

    if (platform === "x") {
      const twitter = require("./lib/twitter");
      if (dryRun) {
        content.tweets.forEach((t, i) => console.log(`\n[tweet ${i + 1}/${content.tweets.length}]\n${t}`));
        continue;
      }
      const me = await twitter.authCheck(env);
      console.log(`auth ok: @${me.username}`);
      const ids = [];
      let replyTo;
      for (const t of content.tweets) {
        const posted = await twitter.postTweet(env, t, replyTo ? { replyTo } : {});
        ids.push(posted.id);
        replyTo = posted.id;
        console.log(`posted tweet ${ids.length}/${content.tweets.length} → ${posted.id}`);
        await new Promise((r) => setTimeout(r, 1500)); // polite pacing
      }
      state.mark("x", day, ids);
    } else {
      const weibo = require("./lib/weibo");
      if (dryRun) {
        console.log(`\n[post]\n${content.text}`);
        continue;
      }
      const me = await weibo.authCheck(env);
      console.log(`auth ok: @${me.screen_name} (uid ${me.id})`);
      const posted = await weibo.postStatus(env, content.text);
      state.mark("weibo", day, [String(posted.idstr || posted.id)]);
      console.log(`posted weibo → ${posted.idstr || posted.id}`);
    }
  }
  console.log("\ndone.");
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
