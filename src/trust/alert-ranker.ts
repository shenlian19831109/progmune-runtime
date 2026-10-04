/**
 * §49.13 告警排序器 —— 把 §49.12 的评估结论变成可执行代码（2026-09-28）
 *
 * 一、为什么是排序而不是压制
 *   §49.9 把压制型判据的三个方向全否决了（缺席型伤真漏洞 3/18；组合型在真漏洞上 0/18）。
 *   剩下的只有**排序**：告警一条不少，但让真漏洞浮到前面。这不删除信息，
 *   所以对判据的要求比压制低——压制错了不可逆，排错了只是顺序次优。
 *
 * 二、两个信号为什么是**正交**的
 *   ① 族先验 rulePrior：这条规则**历史上**有多大比例是真漏洞（族级、来自标注）
 *   ② 语义自身信号 semanticScore：这个**函数自身**做了什么（函数级、来自 IR）
 *   ① 是「这一类告警值不值得看」，② 是「这一条告警像不像真的」。
 *   实测留一仓：单独 ① AUC 0.891、单独 ② AUC 0.744、合起来 **0.895**，
 *   且合起来前 10% 密度从 30.6% 提到 45.8% ⇒ ② 在 ① 分好的层里还能再分，确证互补。
 *
 * 三、三条必须知道的口径（不知道就会用错）
 *   ① **先验来自真值标注 ⇒ 有自证风险**。某族先验一旦是 0，它就被压到最后，
 *      没人看 ⇒ 永远发现不了它的真漏洞 ⇒ 先验永远是 0。缓解靠**调用方式**：
 *      默认用 `groupAlerts()` 分组（每个族都有一块，不会被整体沉底），
 *      或 `rankAlerts({ minPerRule })` 给每族保底名额。**不要**用无保底的纯全局排序。
 *      曾试图用「规则宽泛度（命中密度）」替代先验以绕开这个风险，实测与真漏洞率
 *      相关系数 r = -0.026（无关）⇒ 替代方案不成立，已否决。
 *   ② **信号必须语义定义，不能数据挑选**。§49.12 先让程序从数据里挑「真漏洞率高的
 *      call 名」，嵌套留一仓（选信号也只在训练仓内做）后前 10% 从 76.9% 掉到 25.3%
 *      ——挑出来的 `notifyothers` / `dbactor` / `createbytecountingstream` 是**项目专有
 *      函数名**，过拟合。这里全部改成语义集合（数据操作 / 防护证据 / 鉴权 / token）。
 *   ③ **这是排序，不是压制**：输出条数 == 输入条数，一条都不会少。
 *
 * 四、落地契约（要接进产品时照这个做）
 *   输入：告警 + 该函数的 IR（calls / params / 同函数命中了几条规则）。产品路径
 *   FunctionInfo 里这几项都有 ⇒ 不需要扩 IR，不需要改任何判定逻辑。
 *   先验：内置 DEFAULT_RULE_PRIOR（本轮从 fp-gold 学出）。**线上应该用自己项目
 *   的反馈数据重估**（learnPrior），并保留关闭先验的能力（usePrior:false，
 *   此时只剩语义信号，实测仍有前 10% 3.06× 的提升，不会归零）。
 *
 * 用法：
 *   import { rankAlerts, groupAlerts, learnPrior } from "./alert-ranker";
 *   const ranked = rankAlerts(alerts, { minPerRule: 1 });
 *
 * 2026-10-02：自 blind-benchmark/alert-ranker.ts 迁入产品代码（§49.15 方案 b
 * 落地——产品新增 safeguard 告警流）。评估脚本（alert-ranker-check /
 * rank-robustness / rank-alerts-cli）改为 import 本文件，对表测试保证同一实现。
 */

export interface RankableAlert {
  /** 规则名（族） */
  rule: string;
  /** IR 调用列表（含 __progmune_*__ 语义标记） */
  calls?: string[];
  /** 同一函数一共命中了几条规则 */
  nRules?: number;
  params?: Array<{ n: string; t: string }>;
  [k: string]: any;
}

export interface Ranked<T extends RankableAlert = RankableAlert> {
  alert: T;
  /** 总分 = W_PRIOR × 族先验 + 语义分 */
  score: number;
  /** 族先验（0~1） */
  prior: number;
  /** 语义自身信号分（可正可负） */
  semantic: number;
  /** 语义分的构成，用于向用户解释「为什么排前面」 */
  reasons: string[];
}

/** 先验权重：先验取值 0~0.41，×3 后与语义分量级相当（§49.12 实测最优组合用的就是这个比例） */
export const W_PRIOR = 3.0;

/**
 * 内置族先验。来源：fp-gold.jsonl，2026-09-28，n=244（真漏洞 24 / 误报 220），
 * 贝叶斯平滑 alpha=8（伪计数按全局基线 0.0984 注入）。
 *
 * ⚠ 这张表反映的是**本项目这批标注**的分布，换项目必须重估（learnPrior）。
 *   尤其注意 "Data Mutation Without Audit Trail" = 0.0057：它在本批标注里 140 条
 *   全是误报，但那不代表它在**任何**项目上都是噪音（比如有审计合规要求的场景）。
 */
export const DEFAULT_RULE_PRIOR: Record<string, number> = {
  "Data Integrity (Foreign Key)": 0.4098,
  "Input Validation": 0.3456,
  "No Input Sanitization": 0.2367,
  "File Upload Without Validation": 0.2144,
  "Session Fixation (Logout without Invalidation)": 0.0874,
  "No Token Rotation After Privilege Change": 0.0874,
  "Token Security (Weak Generation)": 0.0874,
  "Authorization (Resource Ownership)": 0.0787,
  "Authorization (Unauthenticated Access)": 0.0787,
  "TLS Enforcement": 0.0656,
  "Rate Limiting": 0.0656,
  "API Without Rate Limiting": 0.0656,
  "Authorization (Ownership Check)": 0.0656,
  "Session No Timeout": 0.0605,
  "Notification Without Retry": 0.0605,
  "Authorization (Unauthenticated Mutation)": 0.0562,
  "Password Hashing": 0.0525,
  "Password Hashing (Weak)": 0.0525,
  "Registration Without Email Verification": 0.0525,
  // 2026-10-04：Data Mutation Without Audit Trail 规则已移除（fp-gold
  // 131/131 全 FP、全口径 TP=0，概念性失明——见 protocol-detector.ts 注记），
  // 先验条目随之删除。
};

/** 未知族的兜底先验 = 全局基线 */
export const DEFAULT_BASE = 0.0984;

// ── 语义信号集合（全部**语义定义**，不是从数据里挑出来的，见文件头 ③）──
/** 直接的数据操作：真漏洞多半要真的动数据 */
const DATA_OP = new Set([
  "insert", "select", "where", "update", "delete", "save", "remove", "upsert",
  "patch", "create", "destroy", "findone", "findmany", "find", "executetx",
  "add", "write", "execute",
]);
/** 提取器注入的「有校验证据」标记 —— 有防护 ⇒ 更像误报 */
const GUARD_MARKS = new Set(["__progmune_input_guard__", "__progmune_input_schema__"]);
/** 鉴权判定调用 */
const AUTHZ = new Set([
  "can", "cannot", "authorize", "checkpermission", "haspermission",
  "verifyjwt", "isauthorized",
]);
const INPUT_EFFECT = "__progmune_input_effect__";
const TOKEN_ISSUED = "__progmune_token_issued__";

// 权重（§49.12 评估用的就是这组，语义分与先验量级匹配）
const W = {
  dataOp: 0.5,      // 每个命中的数据操作名
  multiRule: 0.4,   // 同函数被多条规则命中
  inputEffect: 0.3, // 输入确实被使用
  guard: -0.6,      // 有校验证据 ⇒ 降权
  authz: -0.4,      // 有鉴权判定 ⇒ 降权
  token: -0.3,      // 已签发 token ⇒ 降权
};

/** 语义自身信号打分：这个函数**自身**做了什么。只吃 IR 可得字段。 */
export function semanticScore(a: RankableAlert): { score: number; reasons: string[] } {
  const calls = a.calls || [];
  const lower = new Set(calls.map((c) => String(c).toLowerCase()));
  const reasons: string[] = [];
  let s = 0;

  const nData = [...DATA_OP].filter((d) => lower.has(d)).length;
  if (nData) { s += W.dataOp * nData; reasons.push(`直接数据操作 ×${nData}`); }

  if ((a.nRules ?? 1) >= 2) { s += W.multiRule; reasons.push("同函数命中多条规则"); }

  if (calls.includes(INPUT_EFFECT)) { s += W.inputEffect; reasons.push("输入被使用"); }

  if (calls.some((c) => GUARD_MARKS.has(String(c)))) { s += W.guard; reasons.push("有校验证据（降权）"); }

  if ([...AUTHZ].some((x) => lower.has(x))) { s += W.authz; reasons.push("有鉴权判定（降权）"); }

  if (calls.includes(TOKEN_ISSUED)) { s += W.token; reasons.push("已签发 token（降权）"); }

  return { score: s, reasons };
}

export interface RankOptions {
  /** 族先验表；不给就用内置表 */
  prior?: Record<string, number>;
  /** 未知族的兜底先验 */
  base?: number;
  /** 关掉先验只剩语义信号（实测仍有前 10% 3.06× 提升） */
  usePrior?: boolean;
  /**
   * 全局模式下每个族至少排在前面的条数。**强烈建议 ≥1** —— 见文件头 ①的自证风险。
   * 0 = 不保底（可能把整个族沉底）
   */
  minPerRule?: number;
}

export function scoreOne<T extends RankableAlert>(a: T, o: RankOptions = {}): Ranked<T> {
  const prior = (o.prior ?? DEFAULT_RULE_PRIOR)[a.rule] ?? (o.base ?? DEFAULT_BASE);
  const sem = semanticScore(a);
  const p = o.usePrior === false ? 0 : W_PRIOR * prior;
  return { alert: a, score: p + sem.score, prior, semantic: sem.score, reasons: sem.reasons };
}

/**
 * 全局排序：输出一条平铺列表。
 * minPerRule>0 时先给每族保底名额，再排剩下的 —— 避免整族沉底。
 */
export function rankAlerts<T extends RankableAlert>(alerts: T[], o: RankOptions = {}): Ranked<T>[] {
  const all = alerts.map((a) => scoreOne(a, o));
  const min = o.minPerRule ?? 0;
  if (min <= 0) return all.sort((x, y) => y.score - x.score);

  const byRule = new Map<string, Ranked<T>[]>();
  for (const r of all) {
    const k = r.alert.rule;
    if (!byRule.has(k)) byRule.set(k, []);
    byRule.get(k)!.push(r);
  }
  const head: Ranked<T>[] = [];
  const tail: Ranked<T>[] = [];
  for (const [, list] of byRule) {
    list.sort((x, y) => y.score - x.score);
    head.push(...list.slice(0, min));
    tail.push(...list.slice(min));
  }
  const cmp = (x: Ranked<T>, y: Ranked<T>) => y.score - x.score;
  return [...head.sort(cmp), ...tail.sort(cmp)];
}

export interface AlertGroup<T extends RankableAlert = RankableAlert> {
  rule: string;
  prior: number;
  count: number;
  alerts: Ranked<T>[];
}

/**
 * **推荐形态**：按族分组，组间按先验排序，组内按语义分排序。
 * 每个族都有一块 ⇒ 天然不会因为先验低而被整体沉底（缓解自证风险）。
 */
export function groupAlerts<T extends RankableAlert>(alerts: T[], o: RankOptions = {}): AlertGroup<T>[] {
  const scored = alerts.map((a) => scoreOne(a, o));
  const m = new Map<string, Ranked<T>[]>();
  for (const r of scored) {
    const k = r.alert.rule;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  const groups: AlertGroup<T>[] = [...m.entries()].map(([rule, list]) => ({
    rule,
    prior: list[0].prior,
    count: list.length,
    alerts: list.sort((x, y) => y.score - x.score),
  }));
  return groups.sort((a, b) => b.prior - a.prior);
}

/**
 * 从**已标注**的告警里学族先验。线上应该用自己项目的反馈数据调它重估。
 * alpha 越大越保守（越接近全局基线）——样本少的时候调大。
 */
export function learnPrior(
  labeled: Array<{ rule: string; gold: "TP" | "FP" }>,
  alpha = 8
): { base: number; prior: Record<string, number> } {
  const cnt = new Map<string, { tp: number; n: number }>();
  let tpAll = 0;
  for (const r of labeled) {
    const c = cnt.get(r.rule) ?? { tp: 0, n: 0 };
    c.n++;
    if (r.gold === "TP") { c.tp++; tpAll++; }
    cnt.set(r.rule, c);
  }
  const base = labeled.length ? tpAll / labeled.length : DEFAULT_BASE;
  const prior: Record<string, number> = {};
  for (const [rule, c] of cnt) prior[rule] = (c.tp + alpha * base) / (c.n + alpha);
  return { base, prior };
}
