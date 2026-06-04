"use strict";
/**
 * Terminal formatting utilities shared across observability modules.
 * ANSI color helpers, padding, charts, and badge rendering.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.B = exports.D = exports.C_ = exports.Y = exports.R = exports.G = exports.COLORS = void 0;
exports.pad = pad;
exports.barChart = barChart;
exports.aclBadge = aclBadge;
exports.svlLabel = svlLabel;
exports.describeSVLLayer = describeSVLLayer;
// ── ANSI colors ──
exports.COLORS = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m", gray: "\x1b[90m", bold: "\x1b[1m", dim: "\x1b[2m" };
const C = exports.COLORS;
const G = (s) => `${C.green}${s}${C.reset}`;
exports.G = G;
const R = (s) => `${C.red}${s}${C.reset}`;
exports.R = R;
const Y = (s) => `${C.yellow}${s}${C.reset}`;
exports.Y = Y;
const C_ = (s) => `${C.cyan}${s}${C.reset}`;
exports.C_ = C_;
const D = (s) => `${C.gray}${s}${C.reset}`;
exports.D = D;
const B = (s) => `${C.bold}${s}${C.reset}`;
exports.B = B;
function pad(s, w) {
    let visual = 0;
    for (const ch of s) {
        visual += /[\x1b]/.test(ch) ? 0 : (ch.charCodeAt(0) > 127 ? 2 : 1);
    }
    return s + " ".repeat(Math.max(0, w - visual));
}
function barChart(count, total) {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    const barLen = Math.max(1, Math.round(pct / 5));
    const bar = "█".repeat(barLen);
    const empty = "░".repeat(20 - barLen);
    return `${bar}${empty} ${pct}% (${count}/${total})`;
}
function aclBadge(level) {
    switch (level) {
        case "ACL-4": return (0, exports.G)("◆ ACL-4");
        case "ACL-3": return (0, exports.C_)("◇ ACL-3");
        case "ACL-2": return (0, exports.Y)("○ ACL-2");
        case "ACL-1": return (0, exports.D)("· ACL-1");
        default: return (0, exports.D)(`? ${level}`);
    }
}
function svlLabel(svl) {
    switch (svl) {
        case "SVL-1": return (0, exports.Y)("SVL-1");
        case "SVL-2": return (0, exports.Y)("SVL-2");
        case "SVL-3": return (0, exports.R)("SVL-3");
        case "SVL-4": return (0, exports.R)("SVL-4");
        default: return svl;
    }
}
function describeSVLLayer(svl) {
    switch (svl) {
        case "SVL-1": return "符号存在性（禁止幻觉API）";
        case "SVL-2": return "类型有效性（参数类型/数量匹配）";
        case "SVL-3": return "数据流正确性（变量定义/循环引用）";
        case "SVL-4": return "协议合法性（状态机）";
        default: return "未知";
    }
}
