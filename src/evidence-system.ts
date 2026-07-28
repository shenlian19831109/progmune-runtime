/**
 * Progmune V12 — Unified Evidence System
 * =======================================
 * 将 Proof 和 Evidence 彻底分开，建立两个平行验证世界。
 *
 * 架构:
 *   Business World:    Code → State → Protocol → Proof
 *   Compliance World:  Code → Evidence → Requirement → Assessment
 *
 * 关键区分:
 *   Proof:    形式逻辑推导 — "能从前提推导出结论吗？"
 *             用于: Business Claims (Production ⇒ Paid)
 *             回答: 推导是否有效？
 *
 *   Evidence: 代码产物存在性 — "代码库里有这个东西吗？"
 *             用于: Compliance Requirements (密码哈希存在吗？)
 *             回答: 审计证据是否存在？
 *
 * Evidence 两级:
 *   Existence Evidence:  ∃ pattern(code)     — "至少有一处使用了 bcrypt"
 *   Universal Evidence:  ∀ path, pattern holds — "所有密码路径都经过 bcrypt"
 *
 * V12 实现 Existence Evidence（100% 覆盖），并标注 Universal Evidence 缺口。
 */

import * as fs from "fs";
import * as path from "path";

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

type ClaimOrigin = "BUSINESS" | "SOC2" | "ISO27001" | "EU_AI_ACT" | "NIST" | "OWASP" | "PCI_DSS" | "HIPAA";
type EvidenceLevel = "EXISTENCE" | "UNIVERSAL";
type EvidenceStatus = "FOUND" | "PARTIAL" | "NOT_FOUND";

/** A concrete piece of evidence from the codebase */
interface EvidenceArtifact {
  id: string;
  requirementId: string;         // Which requirement this evidence supports
  standard: ClaimOrigin;
  clause: string;
  level: EvidenceLevel;          // EXISTENCE or UNIVERSAL

  // What was found
  pattern: string;               // e.g. "bcrypt_usage"
  files: string[];               // Where it was found
  snippet?: string;              // Representative code snippet
  confidence: number;            // 0-100 for EXISTENCE; lower for UNIVERSAL

  // Gap analysis
  universalityGap?: string;      // For UNIVERSAL: what's still unverified
  coverageNote?: string;         // "Found in 6/6 auth files" or "Found in 3/8 endpoints"
}

/** A compliance requirement evaluated against code evidence */
interface EvidenceAssessment {
  requirementId: string;
  standard: ClaimOrigin;
  clause: string;
  description: string;
  invariant: string;

  // Evidence found
  artifacts: EvidenceArtifact[];
  existenceSatisfied: boolean;    // ∃ — at least one piece of evidence exists
  universalSatisfied: boolean;    // ∀ — evidence covers all relevant paths (estimated)

  // Gap
  universalityGap?: string;       // What's missing for ∀
  status: "SATISFIED" | "PARTIAL" | "UNSATISFIED";
}

/** The complete evidence report */
interface EvidenceReport {
  timestamp: string;
  projectPath: string;
  assessments: EvidenceAssessment[];
  summary: {
    totalRequirements: number;
    existenceSatisfied: number;    // ∃ count
    universalSatisfied: number;    // ∀ count
    partialCount: number;          // Exists but not universal
    standardsCovered: number;
    overallExistencePct: number;
    overallUniversalPct: number;
  };
}

// ══════════════════════════════════════════════
// COMPLIANCE REQUIREMENTS (same as V11)
// ══════════════════════════════════════════════

interface ComplianceRequirement {
  id: string;
  standard: ClaimOrigin;
  clause: string;
  description: string;
  invariant: string;
  severity: "critical" | "high" | "medium";
  category: string;
  evidenceRequired: string;
  // ── UNIVERSAL CHECK ──
  universalCheck?: {
    pattern: string;             // Pattern to search for
    shouldExistIn: string;       // Where it should be found (e.g. "all auth endpoints")
    estimatedTotal: number;      // Estimated total locations
  };
}

const COMPLIANCE_REQUIREMENTS: ComplianceRequirement[] = [
  // ── SOC 2 ──
  {
    id: "SOC2-CC6.1", standard: "SOC2", clause: "CC6.1",
    description: "逻辑和物理访问控制——只有授权实体可以访问系统资源",
    invariant: "ResourceAccess ⇒ Authenticated",
    severity: "critical", category: "access_control",
    evidenceRequired: "每次资源访问前有认证检查的代码证据",
    universalCheck: { pattern: "auth_middleware", shouldExistIn: "所有 API 路由处理函数", estimatedTotal: 52 },
  },
  {
    id: "SOC2-CC6.3", standard: "SOC2", clause: "CC6.3",
    description: "职责分离——高权限操作需要独立审批",
    invariant: "AdminAction ⇒ IndependentReview",
    severity: "critical", category: "access_control",
    evidenceRequired: "管理操作触发审批流程的代码证据",
    universalCheck: { pattern: "auth_middleware", shouldExistIn: "所有 admin 路由", estimatedTotal: 6 },
  },
  {
    id: "SOC2-CC7.1", standard: "SOC2", clause: "CC7.1",
    description: "审计日志——所有高权限操作必须记录",
    invariant: "PrivilegeChange ⇒ AuditRecorded",
    severity: "critical", category: "audit",
    evidenceRequired: "权限变更操作写入审计日志的代码证据",
    universalCheck: { pattern: "audit_logging", shouldExistIn: "所有数据变更操作", estimatedTotal: 20 },
  },
  {
    id: "SOC2-CC7.2", standard: "SOC2", clause: "CC7.2",
    description: "系统事件监控——异常行为检测和告警",
    invariant: "AnomalyDetected ⇒ AlertTriggered",
    severity: "high", category: "monitoring",
    evidenceRequired: "异常检测到告警触发的完整链路",
    universalCheck: { pattern: "rate_limiting", shouldExistIn: "所有认证端点", estimatedTotal: 8 },
  },
  {
    id: "SOC2-CC8.1", standard: "SOC2", clause: "CC8.1",
    description: "变更管理——所有系统变更需要授权和记录",
    invariant: "SystemChange ⇒ Authorized",
    severity: "high", category: "change_management",
    evidenceRequired: "变更授权和记录的代码/流程证据",
  },

  // ── ISO 27001 ──
  {
    id: "ISO-A.9.2", standard: "ISO27001", clause: "A.9.2",
    description: "用户注册和注销——正式的用户访问配置流程",
    invariant: "UserCreated ⇒ AccessPolicy",
    severity: "critical", category: "access_control",
    evidenceRequired: "用户创建时自动配置访问策略的代码证据",
    universalCheck: { pattern: "auth_middleware", shouldExistIn: "所有用户管理路由", estimatedTotal: 4 },
  },
  {
    id: "ISO-A.9.4", standard: "ISO27001", clause: "A.9.4",
    description: "秘密认证信息——密码和令牌的安全管理",
    invariant: "CredentialStored ⇒ HashedOrEncrypted",
    severity: "critical", category: "secrets",
    evidenceRequired: "密码哈希或令牌加密存储的代码证据",
    universalCheck: { pattern: "bcrypt_usage", shouldExistIn: "所有密码处理路径", estimatedTotal: 3 },
  },
  {
    id: "ISO-A.12.4", standard: "ISO27001", clause: "A.12.4",
    description: "事件日志——管理员和操作员活动需记录",
    invariant: "OperatorAction ⇒ Logged",
    severity: "high", category: "audit",
    evidenceRequired: "操作活动被日志记录的代码证据",
  },
  {
    id: "ISO-A.14.2", standard: "ISO27001", clause: "A.14.2",
    description: "安全开发——输入数据需验证，输出数据需清理",
    invariant: "ExternalInput ⇒ Validated",
    severity: "critical", category: "data_protection",
    evidenceRequired: "外部输入经过验证的代码证据（如 Zod schema）",
    universalCheck: { pattern: "zod_validation", shouldExistIn: "所有 API 输入点", estimatedTotal: 52 },
  },

  // ── EU AI Act ──
  {
    id: "AIACT-Art9", standard: "EU_AI_ACT", clause: "Article 9",
    description: "风险管理——AI 系统需持续进行风险评估",
    invariant: "AIModelUpdate ⇒ RiskAssessment",
    severity: "critical", category: "ai_governance",
    evidenceRequired: "AI 模型更新前触发风险评估的证据",
  },
  {
    id: "AIACT-Art14", standard: "EU_AI_ACT", clause: "Article 14",
    description: "人工监督——高风险 AI 决策需人工复核",
    invariant: "HighRiskDecision ⇒ HumanReview",
    severity: "critical", category: "ai_governance",
    evidenceRequired: "高风险决策触发人工复核流程的证据",
  },
  {
    id: "AIACT-Art12", standard: "EU_AI_ACT", clause: "Article 12",
    description: "记录保存——AI 系统操作需自动记录日志",
    invariant: "AISystemOperation ⇒ Logged",
    severity: "high", category: "ai_governance",
    evidenceRequired: "AI 操作自动记录日志的证据",
    universalCheck: { pattern: "provenance_tracking", shouldExistIn: "AI 代码生成流程", estimatedTotal: 1 },
  },
  {
    id: "AIACT-Art15", standard: "EU_AI_ACT", clause: "Article 15",
    description: "透明度和可追溯性——AI 生成内容需可追溯到来源",
    invariant: "AIGeneratedCode ⇒ TraceableToPrompt",
    severity: "critical", category: "ai_governance",
    evidenceRequired: "AI 生成代码可追溯到 Prompt 的完整链路",
  },

  // ── NIST ──
  {
    id: "NIST-AC-2", standard: "NIST", clause: "AC-2",
    description: "账户管理——所有账户的生命周期需受控",
    invariant: "AccountCreated ⇒ Authorized",
    severity: "critical", category: "access_control",
    evidenceRequired: "账户创建需授权的代码证据",
  },
  {
    id: "NIST-IA-5", standard: "NIST", clause: "IA-5",
    description: "认证器管理——密码强度、重置、多因素认证",
    invariant: "PasswordReset ⇒ MFAVerified",
    severity: "critical", category: "secrets",
    evidenceRequired: "密码重置需多因素认证的代码证据",
  },
  {
    id: "NIST-AU-3", standard: "NIST", clause: "AU-3",
    description: "审计记录内容——日志需包含足够信息以追溯事件",
    invariant: "SecurityEvent ⇒ LoggedWithContext",
    severity: "high", category: "audit",
    evidenceRequired: "安全事件日志包含完整上下文信息的证据",
  },

  // ── OWASP ──
  {
    id: "OWASP-V2.1", standard: "OWASP", clause: "V2.1",
    description: "密码安全——所有密码需使用认可的哈希算法存储",
    invariant: "PasswordStored ⇒ BcryptOrArgon2",
    severity: "critical", category: "secrets",
    evidenceRequired: "密码使用 bcrypt/argon2 哈希存储的代码证据",
    universalCheck: { pattern: "bcrypt_usage", shouldExistIn: "所有密码存储路径", estimatedTotal: 3 },
  },
  {
    id: "OWASP-V4.1", standard: "OWASP", clause: "V4.1",
    description: "访问控制——每次资源访问需验证权限",
    invariant: "ResourceAccess ⇒ AuthorizationChecked",
    severity: "critical", category: "access_control",
    evidenceRequired: "每次资源访问前检查权限的代码证据",
    universalCheck: { pattern: "auth_middleware", shouldExistIn: "所有 API 端点", estimatedTotal: 52 },
  },
  {
    id: "OWASP-V5.2", standard: "OWASP", clause: "V5.2",
    description: "输入验证——所有外部输入需经过服务端验证",
    invariant: "ExternalInput ⇒ ServerSideValidated",
    severity: "critical", category: "data_protection",
    evidenceRequired: "服务端验证外部输入的代码证据（Zod/Yup schema）",
    universalCheck: { pattern: "zod_validation", shouldExistIn: "所有 API 输入点", estimatedTotal: 52 },
  },
];

// ══════════════════════════════════════════════
// EVIDENCE COLLECTION (same as V11)
// ══════════════════════════════════════════════

interface CodeEvidence {
  files: Set<string>;
  patterns: Map<string, string[]>;  // pattern → matching files
  snippets: Map<string, string>;    // pattern → representative code snippet
  totalEndpoints: number;           // Estimated total API endpoints
  totalAuthFiles: number;           // Estimated total auth-related files
}

function collectCodeEvidence(projectPath: string): CodeEvidence {
  const ev: CodeEvidence = {
    files: new Set(),
    patterns: new Map(),
    snippets: new Map(),
    totalEndpoints: 0,
    totalAuthFiles: 0,
  };

  const serverDir = path.join(projectPath, "server");
  if (!fs.existsSync(serverDir)) return ev;

  function scanDir(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      if (entry.isDirectory()) { scanDir(full); continue; }
      if (!entry.name.endsWith(".ts")) continue;

      const relPath = path.relative(projectPath, full);
      ev.files.add(relPath);
      const content = fs.readFileSync(full, "utf-8");

      // Count endpoints
      const routeMatches = content.match(/\.(post|get|put|delete|patch)\s*\(/g) || [];
      ev.totalEndpoints += routeMatches.length;

      // Count auth files
      if (/auth|login|register|verify|password/i.test(entry.name)) {
        ev.totalAuthFiles++;
      }

      // Pattern detection
      const patternChecks: [string, RegExp][] = [
        ["auth_middleware", /authenticate|authRequired|requireAuth|verifyToken|auth\.utils|Auth Middleware/i],
        ["bcrypt_usage", /bcrypt|passwordHash|hashPassword|argon2|compareSync|hash_password/i],
        ["zod_validation", /z\.(string|number|object|enum|array)\(|\.parse\(|\.safeParse\(/i],
        ["audit_logging", /audit|log.*activity|recordSession|pointsLog|notification.*log|audit_mutation/i],
        ["rate_limiting", /rate.?limit|throttle|express-rate-limit|verificationAttempts/i],
        ["verification_code", /verifyCode|verificationCode|verifyPhone|sendVerificationCode/i],
        ["db_transaction", /db\.transaction|\.transaction\(/i],
        ["session_management", /session|createSession|refreshSession|revokeSession/i],
        ["provenance_tracking", /provenance|fingerprint|ledger|@progmune/i],
      ];

      for (const [pattern, regex] of patternChecks) {
        if (regex.test(content)) {
          if (!ev.patterns.has(pattern)) ev.patterns.set(pattern, []);
          ev.patterns.get(pattern)!.push(relPath);

          // Save first matching snippet
          if (!ev.snippets.has(pattern)) {
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                ev.snippets.set(pattern, lines[i].trim().slice(0, 120));
                break;
              }
            }
          }
        }
      }
    }
  }

  scanDir(serverDir);
  return ev;
}

// ══════════════════════════════════════════════
// EVIDENCE ASSESSMENT (V12 — two-level)
// ══════════════════════════════════════════════

const CATEGORY_PATTERNS: Record<string, string[]> = {
  "access_control": ["auth_middleware", "session_management"],
  "secrets": ["bcrypt_usage"],
  "audit": ["audit_logging", "provenance_tracking"],
  "data_protection": ["zod_validation"],
  "monitoring": ["rate_limiting"],
  "ai_governance": ["provenance_tracking", "session_management"],
  "change_management": ["db_transaction", "audit_logging"],
};

function assessEvidence(
  req: ComplianceRequirement,
  evidence: CodeEvidence
): EvidenceAssessment {
  const artifacts: EvidenceArtifact[] = [];
  const required = CATEGORY_PATTERNS[req.category] || [];
  let artIdCounter = 1;

  for (const pattern of required) {
    const files = evidence.patterns.get(pattern) || [];
    if (files.length > 0) {
      // ── EXISTENCE evidence ──
      artifacts.push({
        id: `EVID-${artIdCounter++}`,
        requirementId: req.id,
        standard: req.standard,
        clause: req.clause,
        level: "EXISTENCE",
        pattern,
        files,
        snippet: evidence.snippets.get(pattern),
        confidence: 95, // High confidence for existence
      });

      // ── UNIVERSAL evidence check ──
      const uc = req.universalCheck;
      if (uc && uc.pattern === pattern) {
        const foundCount = files.length;
        const estimatedTotal = uc.estimatedTotal;
        const coverage = Math.round((foundCount / estimatedTotal) * 100);
        const isUniversal = coverage >= 80;

        artifacts.push({
          id: `EVID-${artIdCounter++}`,
          requirementId: req.id,
          standard: req.standard,
          clause: req.clause,
          level: "UNIVERSAL",
          pattern,
          files: files.slice(0, 10),
          snippet: evidence.snippets.get(pattern),
          confidence: Math.min(95, coverage),
          universalityGap: isUniversal ? undefined :
            `Found in ${foundCount}/${estimatedTotal} estimated locations (${uc.shouldExistIn}). Coverage: ${coverage}%.`,
          coverageNote: `Found in ${foundCount} files. Estimated total: ${estimatedTotal} (${uc.shouldExistIn}).`,
        });
      }
    }
  }

  // Determine status
  const hasExistence = artifacts.some(a => a.level === "EXISTENCE");
  const universalArtifacts = artifacts.filter(a => a.level === "UNIVERSAL");
  const allUniversalSatisfied = universalArtifacts.length > 0 &&
    universalArtifacts.every(a => a.confidence >= 80);

  let status: EvidenceAssessment["status"];
  if (!hasExistence) {
    status = "UNSATISFIED";
  } else if (allUniversalSatisfied || universalArtifacts.length === 0) {
    status = universalArtifacts.length === 0 ? "SATISFIED" : "SATISFIED";
  } else {
    status = "PARTIAL";
  }

  return {
    requirementId: req.id,
    standard: req.standard,
    clause: req.clause,
    description: req.description,
    invariant: req.invariant,
    artifacts,
    existenceSatisfied: hasExistence,
    universalSatisfied: allUniversalSatisfied,
    universalityGap: universalArtifacts.find(a => a.universalityGap)?.universalityGap,
    status,
  };
}

// ══════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════

export function buildEvidenceSystem(projectPath: string): EvidenceReport {
  console.log("🔬 Progmune Unified Evidence System — V12");
  console.log("   Project:", projectPath);

  const evidence = collectCodeEvidence(projectPath);
  console.log(`   Evidence patterns found: ${evidence.patterns.size} types across ${evidence.files.size} files`);
  console.log(`   Estimated endpoints: ${evidence.totalEndpoints} | Auth files: ${evidence.totalAuthFiles}`);

  const assessments: EvidenceAssessment[] = [];
  for (const req of COMPLIANCE_REQUIREMENTS) {
    assessments.push(assessEvidence(req, evidence));
  }

  // ── Print ──
  console.log("\n── Evidence Assessment (∃ = Existence, ∀ = Universal) ──\n");

  for (const std of [...new Set(assessments.map(a => a.standard))]) {
    const stdAssessments = assessments.filter(a => a.standard === std);
    const existenceOk = stdAssessments.filter(a => a.existenceSatisfied).length;
    const universalOk = stdAssessments.filter(a => a.universalSatisfied).length;
    const total = stdAssessments.length;

    const existBar = "█".repeat(existenceOk) + "░".repeat(total - existenceOk);
    const univBar = "█".repeat(universalOk) + "░".repeat(total - universalOk);

    console.log(`   ${std}`);
    console.log(`     ∃ Existence: ${existBar} ${existenceOk}/${total}`);
    console.log(`     ∀ Universal: ${univBar} ${universalOk}/${total}`);

    for (const a of stdAssessments) {
      const icon = a.status === "SATISFIED" ? "✅" : a.status === "PARTIAL" ? "⚠️" : "❌";
      console.log(`     ${icon} ${a.clause}: ${a.description.slice(0, 50)}...`);

      for (const art of a.artifacts) {
        const levelIcon = art.level === "EXISTENCE" ? "∃" : "∀";
        console.log(`        ${levelIcon} ${art.pattern}: ${art.files.length} files [${art.confidence}%]`);
        if (art.snippet) console.log(`           → ${art.snippet}`);
        if (art.universalityGap) console.log(`           ⚠️  ${art.universalityGap}`);
      }
    }
    console.log();
  }

  // Summary
  const existenceCount = assessments.filter(a => a.existenceSatisfied).length;
  const universalCount = assessments.filter(a => a.universalSatisfied).length;
  const partialCount = assessments.filter(a => a.status === "PARTIAL").length;
  const total = assessments.length;

  const report: EvidenceReport = {
    timestamp: new Date().toISOString(),
    projectPath,
    assessments,
    summary: {
      totalRequirements: total,
      existenceSatisfied: existenceCount,
      universalSatisfied: universalCount,
      partialCount,
      standardsCovered: [...new Set(assessments.map(a => a.standard))].length,
      overallExistencePct: Math.round((existenceCount / total) * 100),
      overallUniversalPct: Math.round((universalCount / total) * 100),
    },
  };

  console.log("═══ Evidence System Summary ═══");
  console.log(`  ∃ Existence:  ${existenceCount}/${total} (${report.summary.overallExistencePct}%)`);
  console.log(`  ∀ Universal:  ${universalCount}/${total} (${report.summary.overallUniversalPct}%)`);
  console.log(`  ⚠️  Partial:   ${partialCount} (existence ok, universal not verified)`);
  console.log();

  return report;
}

// ══════════════════════════════════════════════
// CLI
// ══════════════════════════════════════════════

if (require.main === module) {
  const targetProject = process.argv[2];
  if (!targetProject) {
    console.error("Usage: npx ts-node src/evidence-system.ts <project-path>");
    process.exit(1);
  }

  const report = buildEvidenceSystem(targetProject);

  const outputPath = path.join(targetProject, ".progmune_evidence.json");
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`✅ Evidence report saved to: ${outputPath}`);
}
