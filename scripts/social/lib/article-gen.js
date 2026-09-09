/**
 * Shared article builders for B-level channels (dev.to / 掘金 / V2EX).
 * Pure functions — no side effects, safe to require from publish.js and
 * gen-drafts.js. Zero dependencies.
 */

const path = require("path");

const SOCIAL = __dirname + "/..";
const CONTENT = path.join(SOCIAL, "content");
const SITE = "https://progmune.top";
const REPO = "https://github.com/shenlian19831109/progmune-runtime";
const NPM = "https://www.npmjs.com/package/progmune-runtime";

function readDay(platform, day) {
  return JSON.parse(require("fs").readFileSync(path.join(CONTENT, platform, `day${day}.json`), "utf-8"));
}

function devtoTitle(x) {
  const m = (x.label || "").match(/—\s*(.+)$/);
  return m ? m[1] : x.label || "Progmune";
}

function splitHead(t) {
  const lead = t.match(/^(?:\d\/\d|Step \d+|Part \d+) — [^.:]{0,60}?(?=[:.])/);
  if (lead) {
    const head = lead[0].replace(/\s*:$/, "");
    const restBody = t.slice(lead[0].length).replace(/^[:.]\s*/, "").trim();
    return { head, body: restBody || t };
  }
  const firstPara = t.split(/\n\n/)[0];
  const sent = firstPara.match(/^(.{0,64}?)[.:](?:\s|$)/);
  if (sent && firstPara.length > 40) {
    const body = t.slice(firstPara.length).trim();
    return { head: sent[1], body: body || t };
  }
  if (firstPara.length <= 70) {
    return { head: firstPara, body: t.slice(firstPara.length).trim() || firstPara };
  }
  return { head: firstPara.slice(0, 70).trim() + "…", body: t.slice(firstPara.length).trim() || firstPara };
}

/** dev.to article from the day's X thread. */
function devtoArticle(x) {
  const title = devtoTitle(x);
  const [hook, ...rest] = x.tweets;
  const sections = rest
    .map((t, i) => {
      const { head, body } = splitHead(t);
      return `## ${i + 1}. ${head}\n\n${body}`;
    })
    .join("\n\n");
  const body_markdown =
    `# ${title}\n\n` +
    `${hook}\n\n` +
    `${sections}\n\n` +
    `---\n\n` +
    `**Progmune** verifies that AI-generated code follows correct protocol lifecycles — TLS handshakes, auth flows, payment integrity, resource management. Violations SAST/SCA cannot see because they span function-call sequences.\n\n` +
    `- Site: ${SITE}\n- Repo: ${REPO}\n- npm: ${NPM}\n`;
  return { title, body_markdown, tags: ["ai", "security", "opensource", "llm"] };
}

/** 掘金 draft (CN short article from the Weibo post). */
function juejinArticle(w) {
  const title = (w.label || "").replace(/^Day \d+ —\s*/, "") || "Progmune";
  const body_markdown =
    `# ${title}\n\n` +
    `> 首发于微博，扩写为掘金短文。\n\n` +
    `${w.text}\n\n` +
    `---\n` +
    `**Progmune** —— AI 代码的协议生命周期验证（TLS 握手 / 认证流 / 支付完整性 / 资源管理），SAST/SCA 看不见的跨函数违规，Progmune 看得见。\n\n` +
    `- 官网：${SITE}\n- 仓库：${REPO}\n- npm：\`npm i progmune-runtime\`\n`;
  return { title, body_markdown };
}

/** V2EX draft (title + short body). */
function v2exArticle(w) {
  const title = (w.label || "").replace(/^Day \d+ —\s*/, "") || "Progmune";
  return { title, body_markdown: `${w.text}\n\n${SITE}\n` };
}

module.exports = { readDay, devtoArticle, juejinArticle, v2exArticle };
