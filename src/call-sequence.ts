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
}

const MAX_DEPTH = 4;

/** 项目函数判定：有真实文件且非外部导入条目（external 条目无函数体可内联）。 */
function isProjectFn(f: FunctionInfo): boolean {
  return !f.external && !!f.file && f.file !== "(external)";
}

/**
 * 从 IR 构建验证序列：入口函数展开 + 非入口抑制。
 * @param ir - FunctionInfo 列表（TS 或 Python 提取器输出）
 * @param keepNames - 协议规则名集合：命中这些名字的项目函数是验证单元
 *   （其调用名保留给规则匹配），不内联其函数体——否则 create_session 等
 *   规则函数的平凡函数体会把调用名"吞掉"
 */
export function buildCallSequences(ir: FunctionInfo[], keepNames?: Set<string>): CallSequence[] {
  const fnMap = new Map<string, FunctionInfo>();
  for (const f of ir) {
    if (isProjectFn(f)) fnMap.set(f.name, f);
  }

  // 被项目函数调用过的函数不是入口（其片段并入调用方展开序列）
  const calledBy = new Set<string>();
  for (const f of ir) {
    if (!isProjectFn(f)) continue;
    for (const c of f.calls || []) {
      if (fnMap.has(c)) calledBy.add(c);
    }
  }

  /** 展开函数体内的调用（入口序列 = 函数体调用，不含函数自己的名字） */
  const expandBody = (fn: FunctionInfo, depth: number, visiting: Set<string>): string[] => {
    const out: string[] = [];
    for (const c of fn.calls || []) {
      if (typeof c !== "string" || c.startsWith("__progmune_")) continue;
      out.push(...expandCall(c, depth, visiting));
    }
    return out;
  };

  const expandCall = (name: string, depth: number, visiting: Set<string>): string[] => {
    if (depth > MAX_DEPTH || visiting.has(name)) return [];
    const fn = fnMap.get(name);
    // 外部调用或规则函数：调用名保留给匹配层，不内联
    if (!fn || (keepNames && keepNames.has(name))) return [name];
    // 叶子函数（函数体只调外部原语）是协议原语或叶子 helper：
    // 保留名字，不内联——否则 S5 改名协议函数的平凡函数体会吞掉调用名
    const hasProjectCalls = (fn.calls || []).some((c) => fnMap.has(c));
    if (!hasProjectCalls) return [name];
    visiting.add(name);
    const out = expandBody(fn, depth + 1, visiting);
    visiting.delete(name);
    return out;
  };

  const sequences: CallSequence[] = [];
  for (const f of ir) {
    if (!isProjectFn(f)) continue;
    if (calledBy.has(f.name)) continue; // 非入口：片段并入调用方
    if (keepNames && keepNames.has(f.name)) continue; // 协议原语不是入口：只在调用链内验证
    const calls = expandBody(f, 0, new Set());
    if (calls.length === 0) continue;
    sequences.push({ calls, file: f.file, function: f.name });
  }
  return sequences;
}
