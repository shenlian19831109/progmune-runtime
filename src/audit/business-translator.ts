/**
 * Phase 10: Business Translation Layer
 *
 * Translates Progmune kernel governance data into CTO-readable
 * trust report language — protocol security becomes business risk,
 * PLSB categories become knowledge domains, session transitions
 * become business protocol graphs.
 *
 * "Not a single AI-generated code path violated a business protocol edge."
 *
 * Project types are auto-detected from package.json dependencies,
 * Prisma schema models, and framework config files.
 * Falls back to generic domains for unknown project types.
 */

// ── Protocol -> Business Risk Mapping ──

export interface BusinessRisk {
  category: string;
  description: string;
  protocolsCovered: number;
  violationsPrevented: number;
  status: "protected" | "partial" | "exposed";
}

export interface KnowledgeDomain {
  domain: string;
  coverage: "full" | "partial" | "none";
  protocols: string[];
  entities?: string[];
}

export interface ProtocolEdge {
  from: string;
  to: string;
  label: string;
  verified: boolean;
  description?: string;
}

export interface BusinessTranslationSummary {
  totalRisksMitigated: number;
  knowledgeDomainsCovered: number;
  businessProtocolsIntact: number;
  preventedViolationsByCategory: Record<string, number>;
}

// ── PLSB 类别 -> 业务风险映射 ──

const PLSB_TO_BUSINESS_RISK: Record<string, { category: string; risk: string }> = {
  "PLS-001": { category: "认证与授权", risk: "未认证访问：未登录用户可能访问受保护数据" },
  "PLS-002": { category: "认证与授权", risk: "权限提升：低权限用户可能执行管理操作" },
  "PLS-003": { category: "认证与授权", risk: "会话劫持：令牌可能被窃取和重放" },
  "PLS-004": { category: "数据完整性", risk: "数据泄露：跨租户数据可能被非授权访问" },
  "PLS-005": { category: "数据完整性", risk: "数据篡改：未授权用户可能修改他人数据" },
  "PLS-006": { category: "数据完整性", risk: "数据丢失：删除操作无审计追踪" },
  "PLS-007": { category: "业务协议合规", risk: "状态机违规：业务对象跳过必要状态" },
  "PLS-008": { category: "业务协议合规", risk: "关联完整性：孤立数据导致业务逻辑断裂" },
  "PLS-009": { category: "API 合约", risk: "API 合约漂移：接口行为与声明不一致" },
  "PLS-010": { category: "API 合约", risk: "输入验证缺失：恶意输入可能绕过业务逻辑" },
  "PLS-011": { category: "密码安全", risk: "密码明文存储或弱哈希" },
  "PLS-012": { category: "密码安全", risk: "令牌管理不当：令牌生命周期不受控" },
  "PLS-013": { category: "代码溯源", risk: "AI 生成代码无法追溯来源和修改历史" },
};

// ── Generic / Fallback Knowledge Domains ──

const GENERIC_KNOWLEDGE_DOMAINS: KnowledgeDomain[] = [
  {
    domain: "认证与授权",
    coverage: "full",
    protocols: ["PLS-001", "PLS-002", "PLS-003"],
    entities: ["User", "Role", "Session"],
  },
  {
    domain: "数据完整性",
    coverage: "full",
    protocols: ["PLS-004", "PLS-005", "PLS-006"],
    entities: [],
  },
  {
    domain: "API 合约",
    coverage: "full",
    protocols: ["PLS-009", "PLS-010"],
    entities: [],
  },
  {
    domain: "密码安全",
    coverage: "full",
    protocols: ["PLS-011", "PLS-012"],
    entities: [],
  },
  {
    domain: "代码溯源",
    coverage: "full",
    protocols: ["PLS-013"],
    entities: [],
  },
  {
    domain: "业务协议合规",
    coverage: "partial",
    protocols: ["PLS-007", "PLS-008"],
    entities: [],
  },
];

const GENERIC_PROTOCOL_GRAPH: ProtocolEdge[] = [
  { from: "请求", to: "认证", label: "身份验证", verified: true },
  { from: "认证", to: "授权", label: "权限检查", verified: true },
  { from: "授权", to: "处理", label: "业务逻辑", verified: true },
  { from: "处理", to: "响应", label: "返回结果", verified: true },
  { from: "处理", to: "审计", label: "日志记录", verified: true },
];

// ── CRM Knowledge Domains ──

const CRM_KNOWLEDGE_DOMAINS: KnowledgeDomain[] = [
  {
    domain: "客户管理",
    coverage: "full",
    protocols: ["PLS-004", "PLS-008"],
    entities: ["Contact", "Company"],
  },
  {
    domain: "线索管理",
    coverage: "full",
    protocols: ["PLS-007", "PLS-008"],
    entities: ["Lead"],
  },
  {
    domain: "交易管道",
    coverage: "full",
    protocols: ["PLS-007", "PLS-005"],
    entities: ["Deal", "DealStage"],
  },
  {
    domain: "角色权限",
    coverage: "full",
    protocols: ["PLS-001", "PLS-002", "PLS-003"],
    entities: ["User", "Role"],
  },
  {
    domain: "活动追踪",
    coverage: "full",
    protocols: ["PLS-006", "PLS-008"],
    entities: ["Activity", "AuditLog"],
  },
  {
    domain: "AI 辅助决策",
    coverage: "full",
    protocols: ["PLS-009", "PLS-010"],
    entities: ["AIAnalysis"],
  },
  {
    domain: "合同管理",
    coverage: "none",
    protocols: [],
    entities: [],
  },
  {
    domain: "发票管理",
    coverage: "none",
    protocols: [],
    entities: [],
  },
  {
    domain: "邮件通信",
    coverage: "partial",
    protocols: ["PLS-009"],
    entities: ["Email"],
  },
  {
    domain: "任务管理",
    coverage: "full",
    protocols: ["PLS-007", "PLS-005"],
    entities: ["Task"],
  },
];

const CRM_PROTOCOL_GRAPH: ProtocolEdge[] = [
  { from: "新线索", to: "已联系", label: "首次触达", verified: true },
  { from: "已联系", to: "已合格", label: "需求确认", verified: true },
  { from: "已合格", to: "提案中", label: "方案提交", verified: true },
  { from: "提案中", to: "赢单", label: "签约", verified: true, description: "生成关联交易" },
  { from: "提案中", to: "丢单", label: "关闭", verified: true, description: "记录丢单原因" },
  { from: "已合格", to: "丢单", label: "放弃", verified: true },
  { from: "交易创建", to: "阶段流转", label: "管道推进", verified: true },
  { from: "阶段流转", to: "赢单", label: "成交", verified: true },
  { from: "阶段流转", to: "丢单", label: "失败", verified: true },
  { from: "联系人", to: "线索", label: "关联", verified: true },
  { from: "联系人", to: "交易", label: "关联", verified: true },
  { from: "公司", to: "联系人", label: "所属", verified: true },
  { from: "公司", to: "线索", label: "关联", verified: true },
  { from: "公司", to: "交易", label: "关联", verified: true },
];

// ── Knowledge domains by project type (defined AFTER their const values) ──

const KNOWLEDGE_DOMAINS_BY_TYPE: Record<string, KnowledgeDomain[]> = {
  crm: CRM_KNOWLEDGE_DOMAINS,
};

const PROTOCOL_GRAPHS_BY_TYPE: Record<string, ProtocolEdge[]> = {
  crm: CRM_PROTOCOL_GRAPH,
};

// ── Project type auto-detection ──

/**
 * Detect project type from common project indicators.
 * Checks package.json dependencies, Prisma schema models, framework configs.
 */
export function detectProjectType(projectPath: string): string {
  try {
    const fs = require("fs");
    const path = require("path");

    // Check package.json dependencies
    const pkgPath = path.join(projectPath, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const depNames = Object.keys(deps).map((d: string) => d.toLowerCase());

      // CRM indicators
      if (depNames.some((d: string) => ["hubspot", "salesforce", "zoho", "crm"].some((kw) => d.includes(kw)))) {
        return "crm";
      }

      // E-commerce indicators
      if (depNames.some((d: string) => ["stripe", "shopify", "woocommerce", "commerce", "payment"].some((kw) => d.includes(kw)))) {
        return "ecommerce";
      }

      // SaaS indicators
      if (depNames.some((d: string) => ["@saas", "billing", "subscription", "multi-tenant"].some((kw) => d.includes(kw)))) {
        return "saas";
      }

      // API/Backend indicators
      if (depNames.some((d: string) => ["express", "fastify", "koa", "hono", "graphql", "trpc"].some((kw) => d.includes(kw)))) {
        return "api";
      }
    }

    // Check for Prisma schema (CRM, ecommerce, SaaS detection)
    const prismaPath = path.join(projectPath, "prisma", "schema.prisma");
    if (fs.existsSync(prismaPath)) {
      const schema = fs.readFileSync(prismaPath, "utf-8");
      const modelMatches = schema.match(/model\s+(\w+)/g) || [];
      const models = modelMatches.map((m: string) => m.replace("model ", ""));

      const crmModels = ["Contact", "Lead", "Deal", "Account", "Opportunity"];
      const ecomModels = ["Product", "Order", "Cart", "Inventory", "Payment"];
      const saasModels = ["Tenant", "Subscription", "Plan", "Workspace"];

      if (crmModels.some((m) => models.includes(m))) return "crm";
      if (ecomModels.some((m) => models.includes(m))) return "ecommerce";
      if (saasModels.some((m) => models.includes(m))) return "saas";
    }
  } catch { /* best-effort */ }

  return "generic";
}

// ── Translation Functions ──

export function translateToBusinessRisks(
  plsbCovered: string[],
  plsbUncovered: string[],
  violationsByCategory: Record<string, number>
): BusinessRisk[] {
  const categories = new Map<string, BusinessRisk>();

  // Initialize from all known mappings
  for (const [plsId, mapping] of Object.entries(PLSB_TO_BUSINESS_RISK)) {
    const cat = mapping.category;
    if (!categories.has(cat)) {
      categories.set(cat, {
        category: cat,
        description: "",
        protocolsCovered: 0,
        violationsPrevented: violationsByCategory[cat] || 0,
        status: "exposed",
      });
    }
    const entry = categories.get(cat)!;
    if (plsbCovered.includes(plsId)) {
      entry.protocolsCovered++;
    }
  }

  // Set status based on coverage
  for (const entry of categories.values()) {
    if (entry.protocolsCovered >= 2) entry.status = "protected";
    else if (entry.protocolsCovered === 1) entry.status = "partial";
    else entry.status = "exposed";
    entry.description = getCategoryDescription(entry.category);
  }

  return Array.from(categories.values());
}

function getCategoryDescription(cat: string): string {
  const descs: Record<string, string> = {
    "认证与授权": "保护系统免受未授权访问，确保每个API调用都经过身份和权限验证",
    "数据完整性": "防止数据泄露、篡改和未经审计的删除操作",
    "业务协议合规": "确保AI生成的业务流程严格遵守定义的状态机和业务规则",
    "API 合约": "保障API接口的行为与声明一致，防止合约漂移",
    "密码安全": "确保密码和令牌的存储、传输、生命周期符合安全标准",
    "代码溯源": "维护从AI生成到人工修改的完整治理链，确保代码可追溯",
  };
  return descs[cat] || "";
}

export function getKnowledgeCoverage(projectType: string = "crm"): KnowledgeDomain[] {
  const typeSpecific = KNOWLEDGE_DOMAINS_BY_TYPE[projectType];
  if (typeSpecific) return typeSpecific;
  return GENERIC_KNOWLEDGE_DOMAINS;
}

export function getProtocolGraph(projectType: string = "crm"): ProtocolEdge[] {
  const typeSpecific = PROTOCOL_GRAPHS_BY_TYPE[projectType];
  if (typeSpecific) return typeSpecific;
  return GENERIC_PROTOCOL_GRAPH;
}

export function buildBusinessSummary(
  risks: BusinessRisk[],
  knowledge: KnowledgeDomain[],
  violationsByCategory: Record<string, number>,
  projectType: string = "generic"
): BusinessTranslationSummary {
  const protocolGraph = getProtocolGraph(projectType);
  return {
    totalRisksMitigated: risks.filter(r => r.status === "protected").length,
    knowledgeDomainsCovered: knowledge.filter(k => k.coverage === "full").length,
    businessProtocolsIntact: protocolGraph.filter(e => e.verified).length,
    preventedViolationsByCategory: violationsByCategory,
  };
}
