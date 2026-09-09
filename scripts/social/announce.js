#!/usr/bin/env node
/**
 * Event-type announcements (C级) — human-gated by design:
 *   1) `node scripts/social/announce.js release --dry-run`
 *        → prints bilingual draft (never posts)
 *   2) 人审通过后 `--go x|weibo|all` 才真正发布
 * Types: release（版本发布公告，自动从 git log 拉要点）
 * Usage:
 *   node scripts/social/announce.js release [--dry-run|--go x|--go weibo|--go all]
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SOCIAL = __dirname;
const ROOT = path.join(__dirname, "..", "..");
const state = require("./lib/state");

const SITE = "https://progmune.top";
const REPO = "https://github.com/shenlian19831109/progmune-runtime";

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

function gitLogLines() {
  try {
    const prev = execSync("git describe --tags --abbrev=0 HEAD~1 2>/dev/null || git rev-list --max-parents=0 HEAD", {
      cwd: ROOT, encoding: "utf-8",
    }).trim();
    const out = execSync(`git log --oneline --no-merges ${prev}..HEAD`, { cwd: ROOT, encoding: "utf-8" });
    return out
      .split("\n")
      .map((l) => l.replace(/^[0-9a-f]{7,}\s*/, "").replace(/^(chore|docs|release)[:：(].*/i, ""))
      .filter((l) => l.trim())
      .slice(0, 6);
  } catch {
    return [];
  }
}

function buildReleaseText() {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")).version;
  const lines = gitLogLines();
  const bulletList = Array.isArray(lines) && lines.length ? lines : null;
  const bullets = bulletList ? bulletList.map((l) => `- ${l}`).join("\n") : "- see the repo changelog";
  const en =
    `Progmune v${version} is out 🎉\n\n` +
    `Highlights:\n${bullets}\n\n` +
    `Protocol lifecycle verification for AI-generated code — the class of bugs SAST/SCA can't see (cross-function sequences).\n\n` +
    `Try: npm i progmune-runtime\nSite: ${SITE} · Code: ${REPO}\n#AISecurity #AICode #opensource`;
  const zhBullets = bulletList ? bulletList.map((l) => `· ${l}`).join("\n") : "· 详见仓库 changelog";
  const zh =
    `Progmune v${version} 发布 🎉\n\n` +
    `本次要点：\n${zhBullets}\n\n` +
    `AI 代码的协议生命周期验证（跨函数序列违规，SAST/SCA 看不见）。\n\n` +
    `试试：npm i progmune-runtime\n官网：${SITE} · 代码：${REPO}\n#AI代码安全 #开源`;
  return { version, en, zh };
}

async function post(platform, env, text) {
  if (platform === "x") {
    const twitter = require("./lib/twitter");
    const me = await twitter.authCheck(env);
    const posted = await twitter.postTweet(env, text);
    return { id: posted.id, who: `@${me.username}` };
  }
  if (platform === "mail") {
    // 版本邮件推送：调中央 hub 的管理端点（Bearer 认证），hub 用 Gmail 群发
    const HUB = process.env.PROGMUNE_HUB || "https://progmune-runtime.fly.dev";
    const token = env.PROGMUNE_HUB_TOKEN;
    if (!token) {
      console.error("缺 PROGMUNE_HUB_TOKEN（scripts/social/.env），邮件推送跳过");
      return { id: "skipped", who: "mail" };
    }
    const r = await fetch(`${HUB}/api/newsletter/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ subject: `Progmune v${version} released 新版本发布`, text }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`newsletter send failed: ${r.status} ${JSON.stringify(d)}`);
    return { id: `${d.sent}/${d.total}`, who: `mail (${d.sent} sent, ${d.failed} failed)` };
  }
  const weibo = require("./lib/weibo");
  const me = await weibo.authCheck(env);
  const posted = await weibo.postStatus(env, text);
  return { id: posted.idstr || posted.id, who: `@${me.screen_name}` };
}

async function main() {
  const type = process.argv[2];
  if (type !== "release") {
    console.error("usage: node scripts/social/announce.js release [--dry-run|--go x|--go weibo|--go all]");
    process.exit(2);
  }
  const { version, en, zh } = buildReleaseText();
  const dryRun = process.argv.includes("--dry-run");
  const goIdx = process.argv.indexOf("--go");
  const go = goIdx >= 0 ? process.argv[goIdx + 1] : null;
  if (go && !["x", "weibo", "mail", "all"].includes(go)) {
    console.error("--go 参数需为 x | weibo | mail | all");
    process.exit(2);
  }

  if (dryRun || !go) {
    console.log(`\n════ v${version} 发布公告草稿（人审后 --go 才发）════\n`);
    console.log(`[X / EN]\n${en}\n`);
    console.log(`[微博 / CN]\n${zh}\n`);
    console.log(`[邮件 / Mail] 主题：Progmune v${version} released 新版本发布（正文=中文版）\n`);
    if (!go) console.log("\n（dry-run：未发送。确认后运行 --go x|weibo|mail|all）");
    return;
  }

  const key = `announce:release:${version}`;
  if (state.get("x", key) && !go.includes("all")) {
    console.log(`[skip] v${version} 公告已发过（state 记录）`);
    return;
  }

  const env = loadEnv();
  const targets = go === "all" ? ["x", "weibo", "mail"] : [go];
  for (const p of targets) {
    const text = p === "x" ? en : zh;
    if (p === "x" && !(env.X_API_KEY && env.X_ACCESS_TOKEN)) { console.error("缺 X 凭据"); process.exit(2); }
    if (p === "weibo" && !env.WEIBO_ACCESS_TOKEN) { console.error("缺微博凭据"); process.exit(2); }
    const r = await post(p, env, text);
    state.mark(p, key, [r.id]);
    console.log(`posted ${p} → ${r.id} (${r.who})`);
  }
  console.log("done.");
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
