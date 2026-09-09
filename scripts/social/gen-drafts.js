#!/usr/bin/env node
/**
 * Generate local B-level drafts (dev.to / 掘金 / V2EX) into scripts/social/drafts/
 * from week content. Copy-paste ready; dev.to additionally supports API drafts
 * via `node scripts/social/publish.js devto <day>` (see publish.js).
 */

const fs = require("fs");
const path = require("path");

const SOCIAL = __dirname;
const DRAFTS = path.join(SOCIAL, "drafts");
const { readDay, devtoArticle, juejinArticle, v2exArticle } = require("./lib/article-gen");

function genAll() {
  fs.mkdirSync(path.join(DRAFTS, "devto"), { recursive: true });
  fs.mkdirSync(path.join(DRAFTS, "juejin"), { recursive: true });
  fs.mkdirSync(path.join(DRAFTS, "v2ex"), { recursive: true });
  const out = [];
  for (let d = 1; d <= 7; d++) {
    const x = readDay("x", d);
    const w = readDay("weibo", d);
    const devto = devtoArticle(x);
    const juejin = juejinArticle(w);
    const v2ex = v2exArticle(w);
    fs.writeFileSync(path.join(DRAFTS, "devto", `day${d}.md`), devto.body_markdown);
    fs.writeFileSync(path.join(DRAFTS, "juejin", `day${d}.md`), juejin.body_markdown);
    fs.writeFileSync(path.join(DRAFTS, "v2ex", `day${d}.md`), v2ex.body_markdown);
    out.push(`day${d} → devto ${devto.body_markdown.length}B / juejin ${juejin.body_markdown.length}B / v2ex ${v2ex.body_markdown.length}B`);
  }
  console.log(out.join("\n"));
  console.log(`\n草稿目录：${DRAFTS}（gitignored，本地审阅后手动发布）`);
}

genAll();
