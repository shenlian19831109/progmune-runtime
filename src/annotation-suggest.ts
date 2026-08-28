/**
 * annotation-suggest.ts — C 注解建议引擎（确定性启发式，无 LLM）
 *
 * 注解驱动定位的「采纳生死线」：未注解 C 项目的 SSG 层静默（0 flags——
 * 看不见问题，也看不见该在哪下注）。本模块按函数名词汇 + 已注解状态，
 * 为项目生成「原语注解建议清单」——每条建议含角色（verify/establish/
 * guard/open/close）、命名空间、状态转移与可直接粘贴的注释块模板。
 *
 * 设计原则：
 *   - 纯名称启发式，诚实标注置信度（high=多证据/强动词，medium=单证据）；
 *     不假装语义理解——建议是「填空起点」，人工确认后生效（与
 *     c-alias-propose.js 的人工确认门同一哲学）。
 *   - 词汇来自 3.7.6 金标 5/5 的真实注解反推（check_user_pass=verify、
 *     handle_PASS=establish、do_RETR/do_STOR=守卫、auth_password=verify、
 *     new_session_channel=会话守卫、open/close_data_connection=资源生命周期）。
 *   - 已注解函数、规则名函数（按名即命中，无需注解）、外部函数不重复建议。
 */

/** 建议的原语角色——对应 SSG 状态机的五类常见 C 原语 */
export type AnnotationRole = "verify" | "establish" | "guard" | "open" | "close";

export interface AnnotationSuggestion {
  function: string;
  file: string;
  role: AnnotationRole;
  namespace: string;
  pre: string[];
  post: string[];
  invalidate?: string[];
  confidence: "high" | "medium";
  /** 命中的词汇模式（人工可读理由） */
  reasons: string[];
  /** 可直接粘贴到函数定义上方的注释块 */
  template: string;
  /**
   * 掩蔽风险（实测，REALWORLD_C_V7.md）：注解会把函数变成状态机「原语」
   * （函数内顺序不检查）——若该函数体内调用了其他规则原语，注解后其
   * 体内序列不再被验证，可能掩蔽握有的违规（如演示层的植入流）。
   * 自动写入应跳过 maskRisk=true 的建议；人工确认后手写不受限。
   */
  maskRisk: boolean;
}

/** 建议所需的函数最小形态（与 extract-ir-c 的 FunctionInfo 兼容） */
export interface SuggestFunction {
  name: string;
  file?: string;
  calls?: string[];
  protocol?: { pre_states?: string[]; post_states?: string[]; namespace?: string } | null;
  external?: boolean;
}

/** 角色定义：状态转移 + 词汇模式 */
interface RoleDef {
  role: AnnotationRole;
  namespace: string;
  pre: string[];
  post: string[];
  invalidate?: string[];
  /** 每个模式是一组必须全部命中的子词（小写子串），命中任一模式即候选 */
  patterns: string[][];
}

const ROLE_DEFS: RoleDef[] = [
  {
    // 凭证比对（密码/口令/凭证 × 比对动词）——verify_password 同款语义
    role: "verify",
    namespace: "auth",
    pre: ["UNAUTHENTICATED"],
    post: ["PASSWORD_VERIFIED"],
    patterns: [
      ["password", "check"],
      ["password", "compare"],
      ["password", "verify"],
      ["password", "auth"],
      ["passwd", "check"],
      ["pass", "check"],
      ["pass", "compare"],
      ["credential", "check"],
      ["credential", "compare"],
      ["secret", "check"],
      ["secret", "compare"],
      ["kbdint", "get"],
      ["otp", "check"],
    ],
  },
  {
    // 登录完成（认证循环/命令处理器的完成点）——establish 原语
    role: "establish",
    namespace: "auth",
    pre: [],
    post: ["AUTHENTICATED"],
    patterns: [
      ["authenticate"],
      ["login"],
      ["logon"],
      ["sign_in"],
      ["auth_success"],
      ["auth_ok"],
      ["handle", "pass"],
      ["do", "login"],
      ["do", "user"],
    ],
  },
  {
    // 权限/会话守卫（权限词 × 检查动词，或 FTP/传输类命令处理器、
    // 通道开启回调）——check_resource_ownership 同款语义（auth 命名空间，
    // 见 REALWORLD_C_V6.md 发现 G5：跨命名空间 pre 不可满足）
    role: "guard",
    namespace: "auth",
    pre: ["AUTHENTICATED"],
    post: ["AUTHORIZED"],
    patterns: [
      ["perm", "check"],
      ["authoriz", "check"],
      ["acl", "check"],
      ["grant", "check"],
      ["privilege", "check"],
      ["do", "retr"],
      ["do", "stor"],
      ["handle", "retr"],
      ["handle", "stor"],
      ["do", "download"],
      ["do", "upload"],
      ["do", "transfer"],
      ["start", "transfer"],
      ["send", "transfer"],
      ["open", "channel"],
      ["accept", "channel"],
      ["new", "channel"],
      ["new", "session", "channel"],
      // 注意：不带 ["new","session"]——new_session 是会话工厂（创建而非检查），
      // 实测（V7）：守卫注解会误报其调用方（ftp_cb/tftp_cb/main 在登录前建会话）。
    ],
  },
  {
    // 资源获取（打开文件/连接/日志）——open_file 同款语义
    role: "open",
    namespace: "file",
    pre: [],
    post: ["FILE_OPEN"],
    patterns: [
      ["open", "file"],
      ["open", "data"],
      ["open", "connection"],
      ["open", "conn"],
      ["open", "log"],
      ["open", "db"],
      ["create", "connection"],
    ],
  },
  {
    // 资源释放（关闭/销毁文件/连接）——close_file 同款语义
    role: "close",
    namespace: "file",
    pre: ["FILE_OPEN"],
    post: [],
    invalidate: ["FILE_OPEN"],
    patterns: [
      ["close", "file"],
      ["close", "data"],
      ["close", "connection"],
      ["close", "conn"],
      ["close", "log"],
      ["close", "db"],
      ["release", "connection"],
      ["destroy", "connection"],
    ],
  },
];

/** 匹配命中数 ≥2 视为高置信（多个独立证据） */
const HIGH_CONFIDENCE_HITS = 2;

/**
 * 为一组函数生成注解建议（确定性，同输入同输出）。
 *
 * @param functions — 项目函数列表（C IR）
 * @param ruleNames — 已加载规则名集合（规则名函数按名即命中，无需注解建议）
 * @param limit — 输出上限（默认 20，防大仓库刷屏；按置信度排序）
 */
export function suggestAnnotations(
  functions: SuggestFunction[],
  ruleNames?: Set<string>,
  limit = 20
): AnnotationSuggestion[] {
  const suggestions: AnnotationSuggestion[] = [];
  const seen = new Set<string>();

  for (const fn of functions) {
    if (!fn.name) continue;
    if (fn.protocol && (fn.protocol.pre_states?.length || fn.protocol.post_states?.length)) {
      continue; // 已注解
    }
    if (ruleNames?.has(fn.name)) continue; // 规则名函数按名命中，无需注解
    if (fn.external) continue;
    if (seen.has(fn.name)) continue;
    seen.add(fn.name);

    const lower = fn.name.toLowerCase();
    for (const def of ROLE_DEFS) {
      const hits: string[] = [];
      for (const pattern of def.patterns) {
        if (pattern.every((word) => lower.includes(word))) {
          hits.push(pattern.join("+"));
        }
      }
      if (hits.length === 0) continue;
      const confidence: "high" | "medium" = hits.length >= HIGH_CONFIDENCE_HITS ? "high" : "medium";
      const invalidatePart = def.invalidate
        ? `, invalidate=${fmtStates(def.invalidate)}`
        : "";
      suggestions.push({
        function: fn.name,
        file: fn.file || "",
        role: def.role,
        namespace: def.namespace,
        pre: def.pre,
        post: def.post,
        invalidate: def.invalidate,
        confidence,
        reasons: hits,
        template: `/* @progmune(namespace="${def.namespace}", pre=${fmtStates(def.pre)}, post=${fmtStates(def.post)}${invalidatePart}) */`,
        maskRisk: false, // 两遍计算（见下）
      });
      break; // 一个函数只取最先命中的角色
    }
  }

  // 第二遍：掩蔽风险——函数体调用了「已存在规则原语」或「本批同被建议的
  // 函数」→ 注解后体内序列不再被验证，可能掩蔽其握有的违规（V7 实测：
  // 植入流被 establish 注解变不透明后违规消失）。
  const coSuggested = new Set(suggestions.map((s) => s.function));
  for (const s of suggestions) {
    const fnInfo = functions.find((f) => f.name === s.function);
    s.maskRisk = (fnInfo?.calls || []).some(
      (c) => (ruleNames?.has(c) ?? false) || coSuggested.has(c)
    );
  }

  // 稳定性排序：置信度高优先，其次按 文件+名字（结果可复现）
  const rank = { high: 0, medium: 1 } as const;
  suggestions.sort(
    (a, b) =>
      rank[a.confidence] - rank[b.confidence] ||
      a.file.localeCompare(b.file) ||
      a.function.localeCompare(b.function)
  );
  return suggestions.slice(0, limit);
}

function fmtStates(states: string[]): string {
  return `[${states.map((s) => `"${s}"`).join(", ")}]`;
}
