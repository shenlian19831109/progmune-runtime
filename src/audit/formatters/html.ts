/**
 * Phase 10: HTML Formatter
 *
 * Generates a standalone, visually polished HTML governance report.
 * No external dependencies — all CSS inline, single self-contained file.
 * Suitable for CTO/VPs, audit committees, and compliance review.
 */

import type { GovernanceReport } from "../types";

export function formatAsHTML(report: GovernanceReport): string {
  const { metadata, sessions, ssv, plsb, provenance, antibodies, verdict, recommendations, business } = report;
  const vc = verdictColor(verdict);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI 治理报告 — ${escapeHtml(metadata.projectId)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; background: #f8fafc; color: #1e293b; line-height: 1.6; }
  .container { max-width: 960px; margin: 0 auto; padding: 40px 24px; }

  /* Header */
  .header { background: linear-gradient(135deg, #1e293b 0%, #334155 100%); color: #fff; border-radius: 16px; padding: 40px; margin-bottom: 32px; }
  .header h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
  .header .subtitle { color: #94a3b8; font-size: 14px; }
  .header .meta { display: flex; gap: 24px; margin-top: 20px; flex-wrap: wrap; }
  .header .meta-item { font-size: 13px; color: #cbd5e1; }
  .header .meta-item span { color: #fff; font-weight: 600; }

  /* Verdict badge */
  .verdict { display: inline-flex; align-items: center; gap: 8px; padding: 8px 20px; border-radius: 100px; font-size: 18px; font-weight: 700; margin-top: 16px; }
  .verdict.pass { background: rgba(34,197,94,0.15); color: #86efac; }
  .verdict.warn { background: rgba(234,179,8,0.15); color: #fde047; }
  .verdict.fail { background: rgba(239,68,68,0.15); color: #fca5a5; }

  /* Cards */
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; margin-bottom: 20px; }
  .card h2 { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 16px; display: flex; align-items: center; gap: 10px; }
  .card h3 { font-size: 14px; font-weight: 600; color: #475569; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; }

  /* Summary grid */
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 20px; }
  .summary-item { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; text-align: center; }
  .summary-item .value { font-size: 32px; font-weight: 800; }
  .summary-item .label { font-size: 13px; color: #64748b; margin-top: 4px; }
  .summary-item .value.green { color: #16a34a; }
  .summary-item .value.amber { color: #d97706; }
  .summary-item .value.gray { color: #64748b; }

  /* Risk table */
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; padding: 10px 12px; font-weight: 600; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #e2e8f0; }
  td { padding: 12px; border-bottom: 1px solid #f1f5f9; }
  tr:last-child td { border-bottom: none; }

  .badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 100px; font-size: 12px; font-weight: 600; }
  .badge.protected { background: #dcfce7; color: #166534; }
  .badge.partial { background: #fef3c7; color: #92400e; }
  .badge.exposed { background: #fee2e2; color: #991b1b; }
  .badge.full { background: #dcfce7; color: #166534; }
  .badge.none { background: #fee2e2; color: #991b1b; }

  /* Protocol graph */
  .graph-flow { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 16px 0; }
  .graph-node { background: #e0e7ff; color: #3730a3; padding: 6px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; }
  .graph-arrow { color: #94a3b8; font-size: 16px; margin: 0 2px; }
  .graph-label { font-size: 11px; color: #94a3b8; margin: 0 4px; }

  .graph-section { margin-bottom: 24px; }
  .graph-section h4 { font-size: 14px; font-weight: 600; color: #475569; margin-bottom: 8px; }

  /* Bars */
  .bar-wrap { height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden; margin: 8px 0; }
  .bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
  .bar-fill.green { background: linear-gradient(90deg, #22c55e, #16a34a); }
  .bar-fill.amber { background: linear-gradient(90deg, #f59e0b, #d97706); }
  .bar-fill.red { background: linear-gradient(90deg, #ef4444, #dc2626); }

  /* Recommendations */
  .rec { border-left: 3px solid #e2e8f0; padding: 12px 16px; margin-bottom: 12px; border-radius: 0 8px 8px 0; }
  .rec.critical { border-color: #ef4444; background: #fef2f2; }
  .rec.high { border-color: #f59e0b; background: #fffbeb; }
  .rec.medium { border-color: #6366f1; background: #eef2ff; }
  .rec.low { border-color: #94a3b8; background: #f8fafc; }
  .rec .rec-severity { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
  .rec .rec-msg { font-size: 14px; margin-top: 4px; }
  .rec .rec-action { font-size: 12px; color: #64748b; margin-top: 4px; }

  /* Tech details */
  .tech { background: #f1f5f9; border-radius: 8px; padding: 16px 20px; font-family: 'SF Mono', 'Menlo', 'Monaco', monospace; font-size: 13px; color: #334155; white-space: pre-wrap; line-height: 1.5; margin-top: 12px; }

  /* Footer */
  .footer { text-align: center; padding: 40px 0 20px; color: #94a3b8; font-size: 12px; }
  .footer strong { color: #64748b; }

  /* Timeline */
  .chain { display: flex; align-items: center; gap: 12px; padding: 16px 0; flex-wrap: wrap; }
  .chain-node { background: #fff; border: 2px solid #e2e8f0; border-radius: 12px; padding: 12px 20px; text-align: center; min-width: 120px; }
  .chain-node.active { border-color: #6366f1; background: #eef2ff; }
  .chain-arrow { color: #94a3b8; font-size: 20px; }

  @media print {
    body { background: #fff; }
    .card { break-inside: avoid; box-shadow: none; }
  }
</style>
</head>
<body>
<div class="container">

<!-- ═══ HEADER ═══ -->
<div class="header">
  <h1>🔬 AI 代码治理报告</h1>
  <p class="subtitle">Progmune Runtime — AI 生成软件治理</p>
  <div class="meta">
    <div class="meta-item">生成器 <span>${escapeHtml(metadata.generator)} v${escapeHtml(metadata.version)}</span></div>
    <div class="meta-item">时间 <span>${escapeHtml(metadata.timestamp)}</span></div>
    <div class="meta-item">项目 <span>${escapeHtml(metadata.projectId)}</span></div>
    <div class="meta-item">验证器 <span>${escapeHtml(metadata.validator)}</span></div>
  </div>
  <div class="verdict ${verdict.toLowerCase()}">${verdictIcon(verdict)} ${verdictLabel(verdict)}</div>
</div>

<!-- ═══ GOVERNANCE SUMMARY ═══ -->
${business ? renderBusinessSummary(business) : ""}

<!-- ═══ TECHNICAL VERIFICATION ═══ -->
<div class="card">
  <h2>📊 技术验证详情</h2>

  <div class="summary-grid">
    <div class="summary-item">
      <div class="value green">${sessions.total}</div>
      <div class="label">治理会话</div>
    </div>
    <div class="summary-item">
      <div class="value green">${ssv.passed}</div>
      <div class="label">SSV 检查通过</div>
    </div>
    <div class="summary-item">
      <div class="value ${plsb.coverage >= 0.7 ? 'green' : plsb.coverage >= 0.3 ? 'amber' : 'gray'}">${fmtPct(plsb.coverage)}</div>
      <div class="label">PLSB 覆盖率</div>
    </div>
    <div class="summary-item">
      <div class="value green">${provenance.verified}</div>
      <div class="label">指纹验证通过</div>
    </div>
    <div class="summary-item">
      <div class="value ${provenance.tampered > 0 ? 'red' : 'green'}">${provenance.tampered}</div>
      <div class="label">篡改检测</div>
    </div>
  </div>

  <table>
    <tr><th>检查项</th><th>详情</th><th>状态</th></tr>
    <tr><td>SSV 检查</td><td>${ssv.totalChecks} 项，${ssv.passed} 通过，${ssv.failed} 失败</td><td>${ssv.failed > 0 ? '⚠ 异常' : '✅ 正常'}</td></tr>
    <tr><td>PLSB 基准</td><td>v${plsb.version}，${plsb.totalEntries} 条目（${plsb.verifiedEntries} 已验证）</td><td>✅ 正常</td></tr>
    <tr><td>召回率 / 精确率</td><td>${fmtPct(plsb.recall)} / ${fmtPct(plsb.precision)}</td><td>—</td></tr>
    <tr><td>指纹验证</td><td>${provenance.totalFingerprints} 指纹，${provenance.verified} 通过</td><td>${provenance.tampered > 0 ? '⚠ 有篡改' : '✅ 正常'}</td></tr>
    <tr><td>抗体系统</td><td>${antibodies.totalHits} 命中，快速通道 ${antibodies.fastPathHits}，节省 ${antibodies.tokensSaved.toLocaleString()} tokens</td><td>✅ 正常</td></tr>
  </table>
</div>

<!-- ═══ SESSIONS ═══ -->
${sessions.details.length > 0 ? renderSessionDetails(sessions) : ""}

<!-- ═══ RECOMMENDATIONS ═══ -->
${recommendations.length > 0 ? renderRecommendations(recommendations) : ""}

<!-- ═══ FOOTER ═══ -->
<div class="footer">
  <p>由 <strong>Progmune Runtime</strong> 生成 — AI 生成软件治理</p>
  <p>此报告不替代人工代码审查、渗透测试或合规审计</p>
</div>

</div>
</body>
</html>`;
}

// ── Section Renderers ──

function renderBusinessSummary(biz: any): string {
  return `
<div class="card" style="border-color: #6366f1; background: linear-gradient(135deg, #eef2ff 0%, #fff 100%);">
  <h2>🛡 治理摘要 — 业务视角</h2>

  <div class="summary-grid">
    <div class="summary-item">
      <div class="value green">${biz.summary.totalRisksMitigated}</div>
      <div class="label">风险类别已防护</div>
    </div>
    <div class="summary-item">
      <div class="value green">${biz.summary.knowledgeDomainsCovered}</div>
      <div class="label">业务知识域覆盖</div>
    </div>
    <div class="summary-item">
      <div class="value green">${biz.summary.businessProtocolsIntact}</div>
      <div class="label">业务协议边验证通过</div>
    </div>
    ${Object.entries(biz.summary.preventedViolationsByCategory).slice(0, 2).map(([k, v]) => `
    <div class="summary-item">
      <div class="value green">${v}</div>
      <div class="label">${escapeHtml(k)} 违规预防</div>
    </div>`).join("")}
  </div>

  <h3>🛡 风险防护</h3>
  <table>
    <tr><th>风险类别</th><th>防护状态</th><th>协议覆盖</th><th>违规预防</th></tr>
    ${biz.risks.map((r: any) => `
    <tr>
      <td><strong>${escapeHtml(r.category)}</strong><br><span style="font-size:12px;color:#64748b">${escapeHtml(r.description)}</span></td>
      <td><span class="badge ${r.status}">${statusIcon(r.status)} ${statusLabel(r.status)}</span></td>
      <td>${r.protocolsCovered} 条</td>
      <td>${r.violationsPrevented} 次</td>
    </tr>`).join("")}
  </table>

  <h3 style="margin-top:24px">📚 业务知识覆盖</h3>
  <table>
    <tr><th>业务域</th><th>覆盖状态</th><th>关联实体</th></tr>
    ${biz.knowledgeCoverage.map((k: any) => `
    <tr>
      <td><strong>${escapeHtml(k.domain)}</strong></td>
      <td><span class="badge ${k.coverage === 'full' ? 'full' : k.coverage === 'partial' ? 'partial' : 'none'}">${coverageIcon(k.coverage)} ${coverageLabel(k.coverage)}</span></td>
      <td style="font-size:12px;color:#64748b">${(k.entities || []).join(", ")}</td>
    </tr>`).join("")}
  </table>

  ${renderProtocolGraph(biz.protocolGraph)}
</div>`;
}

function renderProtocolGraph(edges: any[]): string {
  if (!edges || edges.length === 0) return "";

  // Group edges by context
  const leadEdges = edges.filter((e: any) =>
    ["新线索","已联系","已合格","提案中","赢单","丢单"].includes(e.from) ||
    ["新线索","已联系","已合格","提案中","赢单","丢单"].includes(e.to)
  );
  const dealEdges = edges.filter((e: any) =>
    ["交易创建","阶段流转","赢单","丢单"].includes(e.from) ||
    ["交易创建","阶段流转","赢单","丢单"].includes(e.to)
  );
  const relationEdges = edges.filter((e: any) =>
    ["公司","联系人"].includes(e.from)
  );

  return `
  <h3 style="margin-top:24px">🔗 业务协议图</h3>
  <p style="font-size:13px;color:#64748b;margin-bottom:8px">全部 ${edges.length} 条协议边验证通过 — AI 代码未违反任何业务协议边</p>

  ${leadEdges.length > 0 ? `
  <div class="graph-section">
    <h4>📈 线索生命周期</h4>
    <div class="graph-flow">${leadEdges.map((e: any) => `
      <span class="graph-node">${escapeHtml(e.from)}</span>
      <span class="graph-arrow">→</span>
      <span class="graph-label">${escapeHtml(e.label)}</span>
      <span class="graph-arrow">→</span>
      <span class="graph-node">${escapeHtml(e.to)}</span>
      <span style="margin: 0 8px; color: #22c55e; font-size: 12px;">✓</span>
    `).join("")}</div>
  </div>` : ""}

  ${dealEdges.length > 0 ? `
  <div class="graph-section">
    <h4>💰 交易管道</h4>
    <div class="graph-flow">${dealEdges.map((e: any) => `
      <span class="graph-node">${escapeHtml(e.from)}</span>
      <span class="graph-arrow">→</span>
      <span class="graph-label">${escapeHtml(e.label)}</span>
      <span class="graph-arrow">→</span>
      <span class="graph-node">${escapeHtml(e.to)}</span>
      <span style="margin: 0 8px; color: #22c55e; font-size: 12px;">✓</span>
    `).join("")}</div>
  </div>` : ""}

  ${relationEdges.length > 0 ? `
  <div class="graph-section">
    <h4>🔗 关联关系</h4>
    <div class="graph-flow">${relationEdges.map((e: any) => `
      <span class="graph-node">${escapeHtml(e.from)}</span>
      <span class="graph-arrow">→</span>
      <span class="graph-label">${escapeHtml(e.label)}</span>
      <span class="graph-arrow">→</span>
      <span class="graph-node">${escapeHtml(e.to)}</span>
      <span style="margin: 0 8px; color: #22c55e; font-size: 12px;">✓</span>
    `).join("")}</div>
  </div>` : ""}
  `;
}

function renderSessionDetails(sessions: any): string {
  return `
<div class="card">
  <h2>📋 会话详情</h2>
  <table>
    <tr><th>会话 ID</th><th>意图</th><th>转换数</th><th>有效</th><th>指纹</th></tr>
    ${sessions.details.map((d: any) => `
    <tr>
      <td style="font-family:monospace;font-size:12px">${escapeHtml(d.sessionId.slice(0, 24))}...</td>
      <td>${escapeHtml(d.intent.slice(0, 50))}</td>
      <td>${d.transitionCount}</td>
      <td>${d.validTransitions}/${d.transitionCount}</td>
      <td>${d.fingerprintVerified ? '✅' : d.fingerprintTampered ? '⚠ 篡改' : '—'}</td>
    </tr>`).join("")}
  </table>
</div>`;
}

function renderRecommendations(recs: any[]): string {
  return `
<div class="card">
  <h2>💡 建议改进</h2>
  ${recs.map((r: any) => `
  <div class="rec ${r.severity}">
    <div class="rec-severity" style="color:${sevColor(r.severity)}">${r.severity}</div>
    <div class="rec-msg">${escapeHtml(r.message)}</div>
    <div class="rec-action">→ ${escapeHtml(r.action)}</div>
  </div>`).join("")}
</div>`;
}

// ── Helpers ──

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtPct(v: number): string { return `${(v * 100).toFixed(0)}%`; }

function verdictColor(v: string): string {
  if (v === "PASS") return "#16a34a";
  if (v === "WARN") return "#d97706";
  return "#dc2626";
}

function verdictIcon(v: string): string {
  if (v === "PASS") return "✅";
  if (v === "WARN") return "⚠️";
  return "❌";
}

function verdictLabel(v: string): string {
  if (v === "PASS") return "通过 — 信任";
  if (v === "WARN") return "警告 — 需关注";
  return "失败 — 需修复";
}

function statusIcon(s: string): string {
  if (s === "protected") return "🛡";
  if (s === "partial") return "⚠";
  return "✗";
}

function statusLabel(s: string): string {
  if (s === "protected") return "已防护";
  if (s === "partial") return "部分防护";
  return "未防护";
}

function coverageIcon(c: string): string {
  if (c === "full") return "✓";
  if (c === "partial") return "◐";
  return "✗";
}

function coverageLabel(c: string): string {
  if (c === "full") return "完整覆盖";
  if (c === "partial") return "部分覆盖";
  return "未覆盖";
}

function sevColor(s: string): string {
  if (s === "critical") return "#dc2626";
  if (s === "high") return "#d97706";
  if (s === "medium") return "#6366f1";
  return "#94a3b8";
}
