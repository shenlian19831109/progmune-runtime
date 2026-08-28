/**
 * 跨函数调用序列构建（P4.6：跨函数传播）
 *
 * per-function 序列验证的扩展模型：
 *   - 入口函数（不被任何项目函数调用的函数）的调用序列做传递展开——
 *     内联被调项目函数体（深度 ≤ MAX_DEPTH、环安全），外部调用（非项目函数）
 *     原样保留给规则匹配层（别名/词段匹配）。
 *   - 非入口函数的孤立片段不再单独验证——违规归因到调用它的入口函数，
 *     消除"helper 单独 close_file / read_file"类的片段误报。
 *
 * 边界（与 C 的 L3 同类，如实记录）：展开是语法内联（调用链扁平化），
 * 不做数据流/指针/分支分析；跨文件依赖 IR 的 calls[] 图。
 */

import type { FunctionInfo } from "./extract-ir";

export interface CallSequence {
  calls: string[];
  file: string;
  function?: string;
  /** 展开被调用预算截断（真实 C 巨型函数的宽度爆炸可达百万级调用）——
   *  序列尾部的违规不可见，是诚实的召回边界，非静默回归 */
  truncated?: boolean;
  /** 入口函数的直接调用（展开前的原始调用列表）——endState 检查的
   *  资源获取溯源用：经内联 helper 获取的资源不归因给入口 */
  directCalls?: string[];
}

const MAX_DEPTH = 4;

/**
 * 每序列调用预算上限。真实语料实测：Python 盲测语料 350 序列最大 23、
 * TS 自身 IR 469 序列最大 824——2,000 对现有语料零影响；C 巨型函数
 * （openssl 单序列可达 1M+ 调用）在预算处截断。
 */
export const MAX_SEQUENCE_CALLS = 2000;

/** 项目函数判定：有真实文件且非外部导入条目（external 条目无函数体可内联）。 */
export function isProjectFn(f: FunctionInfo): boolean {
  return !f.external && !!f.file && f.file !== "(external)";
}

/**
 * 构建项目函数名集合——词段匹配门控用（ssg-bridge 的 projectFunctions 参数）。
 * 每个项目函数收录三种形态：全名（FlowService.svc_x）、裸名（svc_x）与
 * 小写变体（调用名大小写差异，如 createActiveSession vs createactivesession）。
 */
export function collectProjectFunctionNames(ir: FunctionInfo[]): Set<string> {
  const names = new Set<string>();
  for (const f of ir) {
    if (!isProjectFn(f)) continue;
    const name = String(f.name || "");
    if (!name) continue;
    const lower = name.toLowerCase();
    names.add(name);
    names.add(lower);
    const dotIdx = name.lastIndexOf(".");
    if (dotIdx >= 0) {
      const bare = name.slice(dotIdx + 1);
      names.add(bare);
      names.add(bare.toLowerCase());
    }
  }
  return names;
}

/**
 * 从 IR 构建验证序列：入口函数展开 + 非入口抑制。
 * @param ir - FunctionInfo 列表（TS 或 Python 提取器输出）
 * @param keepNames - 协议规则名集合：命中这些名字的项目函数是验证单元
 *   （其调用名保留给规则匹配），不内联其函数体——否则 create_session 等
 *   规则函数的平凡函数体会把调用名"吞掉"
 */
export function buildCallSequences(
  ir: FunctionInfo[],
  keepNames?: Set<string>,
  maxCalls: number = MAX_SEQUENCE_CALLS,
): CallSequence[] {
  // 全局按名回退 + 同文件优先映射：C 中跨文件同名 static 函数极常见
  // （每个 .c 都有 static cleanup/helper），名字级 Map 会让 last-wins 的
  // 定义绑定到错误的调用方。同翻译单元（文件）定义优先解析——
  // 文件内回调（cf->close_one() → 本文件 static close_one）因此接回序列构建；
  // 跨文件函数指针分发仍不可见（L3 结论不变）。
  const fnMap = new Map<string, FunctionInfo>();
  const fnMapByFile = new Map<string, Map<string, FunctionInfo>>();
  for (const f of ir) {
    if (!isProjectFn(f)) continue;
    fnMap.set(f.name, f);
    let byFile = fnMapByFile.get(f.file);
    if (!byFile) { byFile = new Map(); fnMapByFile.set(f.file, byFile); }
    if (!byFile.has(f.name)) byFile.set(f.name, f);
  }

  /** 调用解析：同文件定义优先，全局按名回退（跨文件同名时每个文件绑自己的） */
  const resolveCall = (fromFile: string, name: string): FunctionInfo | undefined =>
    fnMapByFile.get(fromFile)?.get(name) ?? fnMap.get(name);

  // 被项目函数调用过的函数不是入口（其片段并入调用方展开序列）——
  // 按 文件+名字 粒度判定，避免 A 文件的 static x 被 B 文件的调用误判非入口
  const fnKey = (file: string, name: string) => file + "::" + name;
  const calledBy = new Set<string>();
  for (const f of ir) {
    if (!isProjectFn(f)) continue;
    for (const c of f.calls || []) {
      const resolved = resolveCall(f.file, c);
      if (resolved) calledBy.add(fnKey(resolved.file, resolved.name));
    }
  }

  /** 调用预算：预算制展开——入口自身调用按序优先，预算耗尽即停（截断），
   *  不在事后截断百万级序列（内存/时间双浪费） */
  const budget = { left: maxCalls, truncated: false };

  /** 展开函数体内的调用（入口序列 = 函数体调用，不含函数自己的名字） */
  const expandBody = (fn: FunctionInfo, depth: number, visiting: Set<string>): string[] => {
    if (budget.left <= 0) { budget.truncated = true; return []; }
    const out: string[] = [];
    for (const c of fn.calls || []) {
      if (typeof c !== "string" || c.startsWith("__progmune_")) continue;
      if (budget.left <= 0) { budget.truncated = true; return out; }
      out.push(...expandCall(c, depth, visiting, fn.file));
    }
    return out;
  };

  const expandCall = (name: string, depth: number, visiting: Set<string>, fromFile: string): string[] => {
    if (depth > MAX_DEPTH || visiting.has(name)) return [];
    const fn = resolveCall(fromFile, name);
    // 外部调用或规则函数：调用名保留给匹配层，不内联（记 1 个调用）
    if (!fn || (keepNames && keepNames.has(name))) {
      budget.left--;
      return [name];
    }
    // 叶子函数（函数体只调外部原语）是协议原语或叶子 helper：
    // 保留名字，不内联——否则 S5 改名协议函数的平凡函数体会吞掉调用名
    const hasProjectCalls = (fn.calls || []).some((c) => resolveCall(fn.file, c));
    if (!hasProjectCalls) {
      budget.left--;
      return [name];
    }
    // 内联：函数体自身的调用在递归内各自记账
    visiting.add(name);
    const out = expandBody(fn, depth + 1, visiting);
    visiting.delete(name);
    return out;
  };

  const sequences: CallSequence[] = [];
  for (const f of ir) {
    if (!isProjectFn(f)) continue;
    if (calledBy.has(fnKey(f.file, f.name))) continue; // 非入口：片段并入调用方
    if (keepNames && keepNames.has(f.name)) continue; // 协议原语不是入口：只在调用链内验证
    budget.left = maxCalls;
    budget.truncated = false;
    const calls = expandBody(f, 0, new Set());
    if (calls.length === 0) continue;
    sequences.push({
      calls,
      file: f.file,
      function: f.name,
      truncated: budget.truncated || undefined,
      directCalls: f.calls || [],
    });
  }
  return sequences;
}
