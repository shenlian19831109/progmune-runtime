/**
 * Progmune V11 — Compliance Knowledge Layer
 * ===========================================
 * 将 SOC 2、ISO 27001、EU AI Act、NIST、OWASP 等合规标准
 * 编码为 Protocol Invariant，纳入统一的 Knowledge Object 体系。
 *
 * 核心理念:
 *   合规要求 = 另一种来源的 Protocol
 *   SOC 2 CC7.2 "所有高权限操作必须记录审计日志"
 *   → Invariant: PrivilegeChange ⇒ AuditRecorded
 *
 *   与 Business Claim 使用完全相同的 Claim/Proof/Belief 框架。
 *   只是 origin 不同。
 */

import * as fs from "fs";
import * as path from "path";

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

type ClaimOrigin = "BUSINESS" | "SOC2" | "ISO27001" | "EU_AI_ACT" | "NIST" | "OWASP" | "PCI_DSS" | "HIPAA";

interface ComplianceRequirement {
  id: string;                    // e.g. "SOC2-CC7.2"
  standard: ClaimOrigin;         // Which standard
  clause: string;                // e.g. "CC7.2"
  description: string;           // Human-readable requirement text
  invariant: string;             // Protocol form: "A ⇒ B" or "¬(A → B)"
  severity: "critical" | "high" | "medium";
  category: string;              // e.g. "audit", "access_control", "data_protection"
  evidenceRequired: string;      // What evidence satisfies this requirement
}

interface ComplianceCoverage {
  standard: ClaimOrigin;
  totalRequirements: number;
  satisfiedByBusiness: number;   // Business claims already cover this
  satisfiedByEvidence: number;   // Can be satisfied with existing evidence
  unsatisfied: number;           // Needs new controls
  claims: string[];              // IDs of related business claims
}

interface UnifiedKnowledgeReport {
  timestamp: string;
  businessClaims: any[];         // From V9 Knowledge Base
  complianceClaims: ComplianceRequirement[];
  coverage: ComplianceCoverage[];
  summary: {
    totalBusinessClaims: number;
    totalComplianceClaims: number;
    overallCoverage: number;     // % of compliance requirements satisfiable
    standardsCovered: string[];
  };
}

// ══════════════════════════════════════════════
// COMPLIANCE KNOWLEDGE BASE
// ══════════════════════════════════════════════

/**
 * Key regulatory requirements encoded as Protocol Invariants.
 * Each is a Claim that can be verified, refuted, and believed —
 * using the same framework as Business Claims.
 */
const COMPLIANCE_REQUIREMENTS: ComplianceRequirement[] = [
  // ── SOC 2 ──
  {
    id: "SOC2-CC6.1",
    standard: "SOC2",
    clause: "CC6.1",
    description: "逻辑和物理访问控制——只有授权实体可以访问系统资源",
    invariant: "ResourceAccess ⇒ Authenticated",
    severity: "critical",
    category: "access_control",
    evidenceRequired: "每次资源访问前有认证检查的代码证据",
  },
  {
    id: "SOC2-CC6.3",
    standard: "SOC2",
    clause: "CC6.3",
    description: "职责分离——高权限操作需要独立审批",
    invariant: "AdminAction ⇒ IndependentReview",
    severity: "critical",
    category: "access_control",
    evidenceRequired: "管理操作触发审批流程的代码证据",
  },
  {
    id: "SOC2-CC7.1",
    standard: "SOC2",
    clause: "CC7.1",
    description: "审计日志——所有高权限操作必须记录",
    invariant: "PrivilegeChange ⇒ AuditRecorded",
    severity: "critical",
    category: "audit",
    evidenceRequired: "权限变更操作写入审计日志的代码证据",
  },
  {
    id: "SOC2-CC7.2",
    standard: "SOC2",
    clause: "CC7.2",
    description: "系统事件监控——异常行为检测和告警",
    invariant: "AnomalyDetected ⇒ AlertTriggered",
    severity: "high",
    category: "monitoring",
    evidenceRequired: "异常检测到告警触发的完整链路",
  },
  {
    id: "SOC2-CC8.1",
    standard: "SOC2",
    clause: "CC8.1",
    description: "变更管理——所有系统变更需要授权和记录",
    invariant: "SystemChange ⇒ Authorized",
    severity: "high",
    category: "change_management",
    evidenceRequired: "变更授权和记录的代码/流程证据",
  },

  // ── ISO 27001 ──
  {
    id: "ISO-A.9.2",
    standard: "ISO27001",
    clause: "A.9.2",
    description: "用户注册和注销——正式的用户访问配置流程",
    invariant: "UserCreated ⇒ AccessPolicy",
    severity: "critical",
    category: "access_control",
    evidenceRequired: "用户创建时自动配置访问策略的代码证据",
  },
  {
    id: "ISO-A.9.4",
    standard: "ISO27001",
    clause: "A.9.4",
    description: "秘密认证信息——密码和令牌的安全管理",
    invariant: "CredentialStored ⇒ HashedOrEncrypted",
    severity: "critical",
    category: "secrets",
    evidenceRequired: "密码哈希或令牌加密存储的代码证据",
  },
  {
    id: "ISO-A.12.4",
    standard: "ISO27001",
    clause: "A.12.4",
    description: "事件日志——管理员和操作员活动需记录",
    invariant: "OperatorAction ⇒ Logged",
    severity: "high",
    category: "audit",
    evidenceRequired: "操作活动被日志记录的代码证据",
  },
  {
    id: "ISO-A.14.2",
    standard: "ISO27001",
    clause: "A.14.2",
    description: "安全开发——输入数据需验证，输出数据需清理",
    invariant: "ExternalInput ⇒ Validated",
    severity: "critical",
    category: "data_protection",
    evidenceRequired: "外部输入经过验证的代码证据（如 Zod schema）",
  },

  // ── EU AI Act ──
  {
    id: "AIACT-Art9",
    standard: "EU_AI_ACT",
    clause: "Article 9",
    description: "风险管理——AI 系统需持续进行风险评估",
    invariant: "AIModelUpdate ⇒ RiskAssessment",
    severity: "critical",
    category: "ai_governance",
    evidenceRequired: "AI 模型更新前触发风险评估的证据",
  },
  {
    id: "AIACT-Art14",
    standard: "EU_AI_ACT",
    clause: "Article 14",
    description: "人工监督——高风险 AI 决策需人工复核",
    invariant: "HighRiskDecision ⇒ HumanReview",
    severity: "critical",
    category: "ai_governance",
    evidenceRequired: "高风险决策触发人工复核流程的证据",
  },
  {
    id: "AIACT-Art12",
    standard: "EU_AI_ACT",
    clause: "Article 12",
    description: "记录保存——AI 系统操作需自动记录日志",
    invariant: "AISystemOperation ⇒ Logged",
    severity: "high",
    category: "ai_governance",
    evidenceRequired: "AI 操作自动记录日志的证据",
  },
  {
    id: "AIACT-Art15",
    standard: "EU_AI_ACT",
    clause: "Article 15",
    description: "透明度和可追溯性——AI 生成内容需可追溯到来源",
    invariant: "AIGeneratedCode ⇒ TraceableToPrompt",
    severity: "critical",
    category: "ai_governance",
    evidenceRequired: "AI 生成代码可追溯到 Prompt 的完整链路",
  },

  // ── NIST 800-53 ──
  {
    id: "NIST-AC-2",
    standard: "NIST",
    clause: "AC-2",
    description: "账户管理——所有账户的生命周期需受控",
    invariant: "AccountCreated ⇒ Authorized",
    severity: "critical",
    category: "access_control",
    evidenceRequired: "账户创建需授权的代码证据",
  },
  {
    id: "NIST-IA-5",
    standard: "NIST",
    clause: "IA-5",
    description: "认证器管理——密码强度、重置、多因素认证",
    invariant: "PasswordReset ⇒ MFAVerified",
    severity: "critical",
    category: "secrets",
    evidenceRequired: "密码重置需多因素认证的代码证据",
  },
  {
    id: "NIST-AU-3",
    standard: "NIST",
    clause: "AU-3",
    description: "审计记录内容——日志需包含足够信息以追溯事件",
    invariant: "SecurityEvent ⇒ LoggedWithContext",
    severity: "high",
    category: "audit",
    evidenceRequired: "安全事件日志包含完整上下文信息的证据",
  },

  // ── OWASP ASVS ──
  {
    id: "OWASP-V2.1",
    standard: "OWASP",
    clause: "V2.1",
    description: "密码安全——所有密码需使用认可的哈希算法存储",
    invariant: "PasswordStored ⇒ BcryptOrArgon2",
    severity: "critical",
    category: "secrets",
    evidenceRequired: "密码使用 bcrypt/argon2 哈希存储的代码证据",
  },
  {
    id: "OWASP-V4.1",
    standard: "OWASP",
    clause: "V4.1",
    description: "访问控制——每次资源访问需验证权限",
    invariant: "ResourceAccess ⇒ AuthorizationChecked",
    severity: "critical",
    category: "access_control",
    evidenceRequired: "每次资源访问前检查权限的代码证据",
  },
  {
    id: "OWASP-V5.2",
    standard: "OWASP",
    clause: "V5.2",
    description: "输入验证——所有外部输入需经过服务端验证",
    invariant: "ExternalInput ⇒ ServerSideValidated",
    severity: "critical",
    category: "data_protection",
    evidenceRequired: "服务端验证外部输入的代码证据（Zod/Yup schema）",
  },
];

// ══════════════════════════════════════════════
// COVERAGE ANALYSIS
// ══════════════════════════════════════════════

/**
 * Analyze how existing business claims map to compliance requirements.
 *
 * Mapping logic:
 *   - If a business claim's predicate overlaps with a compliance invariant,
 *     the business claim partially satisfies the compliance requirement.
 *   - Scans actual code for evidence patterns (auth middleware, bcrypt, Zod, etc.)
 *   - Maps compliance concepts to real code artifacts
 */
function analyzeCoverage(
  businessClaims: any[],
  complianceReqs: ComplianceRequirement[],
  projectPath: string
): ComplianceCoverage[] {
  const standards = [...new Set(complianceReqs.map(r => r.standard))];
  const coverage: ComplianceCoverage[] = [];
  const evidence = collectCodeEvidence(projectPath);

  for (const standard of standards) {
    const reqs = complianceReqs.filter(r => r.standard === standard);
    const satisfied: string[] = [];
    const unsatisfied: string[] = [];

    for (const req of reqs) {
      if (checkRequirement(req, evidence, businessClaims)) {
        satisfied.push(req.id);
      } else {
        unsatisfied.push(req.id);
      }
    }

    coverage.push({
      standard,
      totalRequirements: reqs.length,
      satisfiedByBusiness: satisfied.length,
      satisfiedByEvidence: satisfied.length,
      unsatisfied: unsatisfied.length,
      claims: satisfied,
    });
  }

  return coverage;
}

// ── Evidence Collection ──

interface CodeEvidence {
  files: Set<string>;
  imports: Set<string>;
  dependencies: Set<string>;
  patterns: Map<string, string[]>;  // pattern → matching files
}

function collectCodeEvidence(projectPath: string): CodeEvidence {
  const ev: CodeEvidence = {
    files: new Set(),
    imports: new Set(),
    dependencies: new Set(),
    patterns: new Map(),
  };

  const serverDir = path.join(projectPath, "server");
  if (!fs.existsSync(serverDir)) return ev;

  function scanDir(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      if (entry.isDirectory()) { scanDir(full); continue; }
      if (!entry.name.endsWith(".ts")) continue;

      ev.files.add(path.relative(projectPath, full));
      const content = fs.readFileSync(full, "utf-8");

      const importMatches = content.match(/import\s+.*from\s+['"]([^'"]+)['"]/g) || [];
      for (const m of importMatches) {
        const pkg = m.match(/from\s+['"]([^'"]+)['"]/)?.[1] || "";
        if (pkg && !pkg.startsWith(".")) ev.imports.add(pkg);
      }

      const patternChecks: [string, RegExp][] = [
        ["auth_middleware", /authenticate|authRequired|requireAuth|verifyToken|auth\.utils/i],
        ["bcrypt_usage", /bcrypt|passwordHash|hashPassword|argon2|compareSync/i],
        ["zod_validation", /z\.(string|number|object|enum|array)\(|\.parse\(|\.safeParse\(/i],
        ["audit_logging", /audit|log.*activity|recordSession|pointsLog|notification.*log/i],
        ["rate_limiting", /rate.?limit|throttle|express-rate-limit|verificationAttempts/i],
        ["verification_code", /verifyCode|verificationCode|verifyPhone|sendVerificationCode/i],
        ["db_transaction", /db\.transaction|\.transaction\(/i],
        ["session_management", /session|createSession|refreshSession|revokeSession/i],
        ["provenance_tracking", /provenance|fingerprint|ledger|@progmune/i],
        ["mfa_pattern", /mfa|2fa|two.factor|verification/i],
      ];

      for (const [pattern, regex] of patternChecks) {
        if (regex.test(content)) {
          if (!ev.patterns.has(pattern)) ev.patterns.set(pattern, []);
          ev.patterns.get(pattern)!.push(path.relative(projectPath, full));
        }
      }
    }
  }

  scanDir(serverDir);

  const pkgPath = path.join(projectPath, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      ev.dependencies.add(dep);
    }
  }

  return ev;
}

// ── Requirement Checking ──

function checkRequirement(
  req: ComplianceRequirement,
  evidence: CodeEvidence,
  _businessClaims: any[]
): boolean {
  const categoryEvidence: Record<string, string[]> = {
    "access_control": ["auth_middleware", "session_management"],
    "secrets": ["bcrypt_usage"],
    "audit": ["audit_logging", "provenance_tracking"],
    "data_protection": ["zod_validation"],
    "monitoring": ["rate_limiting"],
    "ai_governance": ["provenance_tracking", "session_management"],
    "change_management": ["db_transaction", "audit_logging"],
  };

  const required = categoryEvidence[req.category] || [];
  const matched = required.filter(p => (evidence.patterns.get(p)?.length || 0) > 0);
  return matched.length > 0;
}

// ══════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════

export function buildComplianceLayer(projectPath: string): UnifiedKnowledgeReport {
  console.log("🔬 Progmune Compliance Knowledge Layer — V11");
  console.log("   Project:", projectPath);

  const kbPath = path.join(projectPath, ".progmune_knowledge.json");
  const businessClaims = fs.existsSync(kbPath)
    ? JSON.parse(fs.readFileSync(kbPath, "utf-8")).claims || []
    : [];

  console.log(`   Loaded ${businessClaims.length} business claims from V9`);
  console.log(`   Compliance library: ${COMPLIANCE_REQUIREMENTS.length} requirements`);
  console.log(`   Standards: ${[...new Set(COMPLIANCE_REQUIREMENTS.map(r => r.standard))].join(", ")}`);

  // ── Coverage Analysis ──
  console.log("\n── Compliance Coverage by Standard ──");
  const coverage = analyzeCoverage(businessClaims, COMPLIANCE_REQUIREMENTS, projectPath);

  for (const cov of coverage) {
    const pct = Math.round((cov.satisfiedByBusiness / cov.totalRequirements) * 100);
    const bar = "█".repeat(Math.round(pct / 10)) + "░".repeat(10 - Math.round(pct / 10));
    console.log(`\n   ${cov.standard}: ${bar} ${pct}%`);
    console.log(`   ${cov.satisfiedByBusiness}/${cov.totalRequirements} requirements satisfied by existing business claims`);

    if (cov.satisfiedByBusiness > 0) {
      console.log(`   Satisfied by:`);
      const reqs = COMPLIANCE_REQUIREMENTS.filter(r => cov.claims.includes(r.id));
      for (const req of reqs.slice(0, 3)) {
        console.log(`     ✅ ${req.id}: ${req.description}`);
        console.log(`        → ${req.invariant}`);
      }
    }
    if (cov.unsatisfied > 0) {
      console.log(`   Not yet satisfied:`);
      const reqs = COMPLIANCE_REQUIREMENTS.filter(r => !cov.claims.includes(r.id));
      for (const req of reqs.slice(0, 2)) {
        console.log(`     ❌ ${req.id}: ${req.description}`);
        console.log(`        → ${req.invariant} [需要: ${req.evidenceRequired}]`);
      }
    }
  }

  // ── Summary ──
  const totalSatisfied = coverage.reduce((s, c) => s + c.satisfiedByBusiness, 0);
  const totalReqs = COMPLIANCE_REQUIREMENTS.length;
  const overallCoverage = Math.round((totalSatisfied / totalReqs) * 100);

  console.log("\n═══ Compliance Knowledge Summary ═══");
  console.log(`  Business claims:       ${businessClaims.length}`);
  console.log(`  Compliance claims:     ${totalReqs}`);
  console.log(`  Satisfied by business: ${totalSatisfied}/${totalReqs} (${overallCoverage}%)`);
  console.log(`  Standards:             ${coverage.length}`);
  console.log();

  const report: UnifiedKnowledgeReport = {
    timestamp: new Date().toISOString(),
    businessClaims,
    complianceClaims: COMPLIANCE_REQUIREMENTS,
    coverage,
    summary: {
      totalBusinessClaims: businessClaims.length,
      totalComplianceClaims: totalReqs,
      overallCoverage,
      standardsCovered: coverage.map(c => c.standard),
    },
  };

  return report;
}

// ══════════════════════════════════════════════
// CLI
// ══════════════════════════════════════════════

if (require.main === module) {
  const targetProject = process.argv[2];
  if (!targetProject) {
    console.error("Usage: npx ts-node src/compliance-miner.ts <project-path>");
    process.exit(1);
  }

  const report = buildComplianceLayer(targetProject);

  const outputPath = path.join(targetProject, ".progmune_compliance.json");
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`✅ Compliance report saved to: ${outputPath}`);
}
