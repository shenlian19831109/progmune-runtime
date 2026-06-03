/**
 * Terminal formatting utilities shared across observability modules.
 * ANSI color helpers, padding, charts, and badge rendering.
 */

// ── ANSI colors ──
export const COLORS = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m", gray: "\x1b[90m", bold: "\x1b[1m", dim: "\x1b[2m" };
const C = COLORS;
export const G = (s: string) => `${C.green}${s}${C.reset}`;
export const R = (s: string) => `${C.red}${s}${C.reset}`;
export const Y = (s: string) => `${C.yellow}${s}${C.reset}`;
export const C_ = (s: string) => `${C.cyan}${s}${C.reset}`;
export const D = (s: string) => `${C.gray}${s}${C.reset}`;
export const B = (s: string) => `${C.bold}${s}${C.reset}`;

export function pad(s: string, w: number): string {
  let visual = 0;
  for (const ch of s) { visual += /[\x1b]/.test(ch) ? 0 : (ch.charCodeAt(0) > 127 ? 2 : 1); }
  return s + " ".repeat(Math.max(0, w - visual));
}

export function barChart(count: number, total: number): string {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const barLen = Math.max(1, Math.round(pct / 5));
  const bar = "█".repeat(barLen);
  const empty = "░".repeat(20 - barLen);
  return `${bar}${empty} ${pct}% (${count}/${total})`;
}

export function aclBadge(level: string): string {
  switch (level) {
    case "ACL-4": return G("◆ ACL-4");
    case "ACL-3": return C_("◇ ACL-3");
    case "ACL-2": return Y("○ ACL-2");
    case "ACL-1": return D("· ACL-1");
    default: return D(`? ${level}`);
  }
}

export function svlLabel(svl: string): string {
  switch (svl) {
    case "SVL-1": return Y("SVL-1");
    case "SVL-2": return Y("SVL-2");
    case "SVL-3": return R("SVL-3");
    case "SVL-4": return R("SVL-4");
    default: return svl;
  }
}

export function describeSVLLayer(svl: string): string {
  switch (svl) {
    case "SVL-1": return "符号存在性（禁止幻觉API）";
    case "SVL-2": return "类型有效性（参数类型/数量匹配）";
    case "SVL-3": return "数据流正确性（变量定义/循环引用）";
    case "SVL-4": return "协议合法性（状态机）";
    default: return "未知";
  }
}
