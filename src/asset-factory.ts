/**
 * Asset Factory — the operational engine of the Evidence Company.
 *
 * Progmune doesn't sell detections.
 * It accumulates production evidence that turns protocol knowledge
 * into trusted governance assets.
 *
 * This module turns the Promotion Pipeline from a concept into a tool.
 * Like GitHub PRs for verification assets.
 *
 * Three queues:
 *   1. Review Queue    — assets awaiting human review
 *   2. Evidence Queue  — evidence pending validation
 *   3. Promotion Queue — assets ready for promotion
 *
 * Factory Health metrics:
 *   - Research intake/week
 *   - Pilot promotion/week
 *   - Production promotion/month
 *   - Average promotion time
 *   - Queue depth
 *
 * Usage:
 *   npx ts-node --transpile-only src/asset-factory.ts
 */

// ═══════════════════════════════════════════════════════════════
// Queue Types
// ═══════════════════════════════════════════════════════════════

export interface ReviewItem {
  id: string;
  assetName: string;
  domain: string;
  currentTier: string;
  targetTier: string;
  evidence: string[];
  submittedBy: string;
  submittedAt: string;
  status: "pending" | "approved" | "rejected";
  priority: "high" | "medium" | "low";
}

export interface EvidenceItem {
  id: string;
  assetName: string;
  type: "repo_scan" | "deployment" | "rfc_alignment" | "false_escalation" | "human_review";
  source: string;
  value: string;
  submittedAt: string;
  validated: boolean;
}

export interface PromotionItem {
  id: string;
  assetName: string;
  from: string;
  to: string;
  score: number;
  readySince: string;
  blockedBy: string[];
}

export interface FactoryHealth {
  queues: {
    reviewDepth: number;
    evidenceDepth: number;
    promotionDepth: number;
  };
  throughput: {
    researchIntakePerWeek: number;
    pilotPromotionPerWeek: number;
    productionPromotionPerMonth: number;
  };
  cycleTime: {
    avgReviewToPromotion: string;
    avgEvidenceToValidation: string;
  };
  status: "HEALTHY" | "BOTTLENECKED" | "STARVED";
  bottleneck: string | null;
}

// ═══════════════════════════════════════════════════════════════
// Asset Factory
// ═══════════════════════════════════════════════════════════════

export class AssetFactory {
  private reviewQueue: ReviewItem[] = [];
  private evidenceQueue: EvidenceItem[] = [];
  private promotionQueue: PromotionItem[] = [];

  constructor() {
    this.seed();
  }

  /** Seed with current known assets awaiting review. */
  private seed(): void {
    // Pilot assets awaiting evidence for Production
    this.reviewQueue = [
      {
        id: "REV-001",
        assetName: "File Lifecycle",
        domain: "File",
        currentTier: "Pilot Ready",
        targetTier: "Production Ready",
        evidence: ["curl (85 seqs)", "nginx (50 seqs)", "Score: 10/20"],
        submittedBy: "auto",
        submittedAt: "2026-06-15",
        status: "pending",
        priority: "high",
      },
      {
        id: "REV-002",
        assetName: "SSH Key Exchange",
        domain: "SSH",
        currentTier: "Pilot Ready",
        targetTier: "Production Ready",
        evidence: ["curl (85 seqs)", "libssh (47 seqs)", "RFC 4253", "Score: 11/20"],
        submittedBy: "auto",
        submittedAt: "2026-06-20",
        status: "pending",
        priority: "high",
      },
      {
        id: "REV-003",
        assetName: "HTTP Request Lifecycle",
        domain: "HTTP",
        currentTier: "Pilot Ready",
        targetTier: "Production Ready",
        evidence: ["nginx (50 seqs)", "nghttp2 (52 seqs)", "RFC 9110", "Score: 9/20"],
        submittedBy: "auto",
        submittedAt: "2026-06-22",
        status: "pending",
        priority: "medium",
      },
      {
        id: "REV-004",
        assetName: "Memory Alloc/Free",
        domain: "Memory",
        currentTier: "Research",
        targetTier: "Pilot Ready",
        evidence: ["curl (85 seqs)", "Score: 4/20"],
        submittedBy: "auto",
        submittedAt: "2026-07-01",
        status: "pending",
        priority: "low",
      },
    ];

    // Evidence pending validation
    this.evidenceQueue = [
      {
        id: "EVI-001",
        assetName: "TLS Handshake",
        type: "deployment",
        source: "staging-cluster-1",
        value: "30 days, 0 FPs",
        submittedAt: "2026-06-28",
        validated: false,
      },
      {
        id: "EVI-002",
        assetName: "File Lifecycle",
        type: "repo_scan",
        source: "redis",
        value: "50 sequences, 45% FP rate",
        submittedAt: "2026-07-01",
        validated: false,
      },
      {
        id: "EVI-003",
        assetName: "SSH Key Exchange",
        type: "rfc_alignment",
        source: "RFC 4253",
        value: "Key exchange protocol matched",
        submittedAt: "2026-06-15",
        validated: true,
      },
    ];

    // Assets ready for promotion
    this.promotionQueue = [
      {
        id: "PRO-001",
        assetName: "File Lifecycle",
        from: "Pilot Ready",
        to: "Production Ready",
        score: 10,
        readySince: "2026-06-15",
        blockedBy: ["Needs RFC reference", "FP rate 45% — needs VI suppression"],
      },
      {
        id: "PRO-002",
        assetName: "SSH Key Exchange",
        from: "Pilot Ready",
        to: "Production Ready",
        score: 11,
        readySince: "2026-06-20",
        blockedBy: ["Needs deployment validation"],
      },
    ];
  }

  /** Get the review queue. */
  getReviewQueue(): ReviewItem[] {
    return [...this.reviewQueue].sort((a, b) => {
      const priority = { high: 0, medium: 1, low: 2 };
      return priority[a.priority] - priority[b.priority];
    });
  }

  /** Get the evidence queue. */
  getEvidenceQueue(): EvidenceItem[] {
    return [...this.evidenceQueue].filter(e => !e.validated);
  }

  /** Get the promotion queue. */
  getPromotionQueue(): PromotionItem[] {
    return [...this.promotionQueue];
  }

  /** Compute Factory Health metrics. */
  getHealth(): FactoryHealth {
    const reviewDepth = this.reviewQueue.filter(r => r.status === "pending").length;
    const evidenceDepth = this.evidenceQueue.filter(e => !e.validated).length;
    const promotionDepth = this.promotionQueue.length;

    // Determine status
    let status: FactoryHealth["status"] = "HEALTHY";
    let bottleneck: string | null = null;

    if (reviewDepth >= 3 && promotionDepth >= 2) {
      status = "BOTTLENECKED";
      bottleneck = "Review queue backing up — need more reviewers";
    } else if (evidenceDepth === 0 && reviewDepth === 0) {
      status = "STARVED";
      bottleneck = "No new evidence — need more repo scans";
    }

    return {
      queues: { reviewDepth, evidenceDepth, promotionDepth },
      throughput: {
        researchIntakePerWeek: 1.5,
        pilotPromotionPerWeek: 0.5,
        productionPromotionPerMonth: 1.0,
      },
      cycleTime: {
        avgReviewToPromotion: "2-4 weeks",
        avgEvidenceToValidation: "3-5 days",
      },
      status,
      bottleneck,
    };
  }

  /** Approve a review item → triggers promotion. */
  approve(id: string, reviewer: string): string {
    const item = this.reviewQueue.find(r => r.id === id);
    if (!item) return `Review item ${id} not found`;

    item.status = "approved";
    this.promotionQueue.push({
      id: `PRO-${Date.now().toString(36)}`,
      assetName: item.assetName,
      from: item.currentTier,
      to: item.targetTier,
      score: 0,
      readySince: new Date().toISOString(),
      blockedBy: [],
    });

    return `${item.assetName} approved by ${reviewer} → moved to promotion queue`;
  }

  /** Validate an evidence item. */
  validateEvidence(id: string): string {
    const item = this.evidenceQueue.find(e => e.id === id);
    if (!item) return `Evidence ${id} not found`;
    item.validated = true;
    return `Evidence ${id} validated: ${item.value}`;
  }
}

// ═══════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════

let _factory: AssetFactory | null = null;

export function getAssetFactory(): AssetFactory {
  if (!_factory) _factory = new AssetFactory();
  return _factory;
}

// ═══════════════════════════════════════════════════════════════
// Formatter
// ═══════════════════════════════════════════════════════════════

export function formatAssetFactory(): string {
  const factory = getAssetFactory();
  const health = factory.getHealth();
  const lines: string[] = [];

  lines.push("");
  lines.push("╔══════════════════════════════════════════════════════════════╗");
  lines.push("║     Asset Factory — Evidence Company Operations               ║");
  lines.push("╠══════════════════════════════════════════════════════════════╣");
  const statusIcon = health.status === "HEALTHY" ? "🟢" : health.status === "BOTTLENECKED" ? "🟡" : "🔴";
  lines.push(`║  Status: ${statusIcon} ${health.status}`.padEnd(63) + "║");
  if (health.bottleneck) {
    lines.push(`║  Bottleneck: ${health.bottleneck.slice(0, 48)}`.padEnd(63) + "║");
  }
  lines.push("╚══════════════════════════════════════════════════════════════╝");
  lines.push("");

  // Factory Health
  lines.push("── Factory Health ──");
  lines.push(`  Throughput:`);
  lines.push(`    Research intake:       ${health.throughput.researchIntakePerWeek}/week`);
  lines.push(`    Pilot promotion:       ${health.throughput.pilotPromotionPerWeek}/week`);
  lines.push(`    Production promotion:  ${health.throughput.productionPromotionPerMonth}/month`);
  lines.push(`  Cycle Time:`);
  lines.push(`    Review → Promotion:    ${health.cycleTime.avgReviewToPromotion}`);
  lines.push(`    Evidence → Validation: ${health.cycleTime.avgEvidenceToValidation}`);
  lines.push("");

  // Review Queue
  const reviews = factory.getReviewQueue();
  lines.push(`── Review Queue (${reviews.filter(r => r.status === "pending").length} pending) ──`);
  if (reviews.length === 0) {
    lines.push("  No assets awaiting review.");
  } else {
    for (const r of reviews) {
      const icon = r.status === "approved" ? "✅" : r.status === "rejected" ? "❌" : "📝";
      const prioIcon = r.priority === "high" ? "🔴" : r.priority === "medium" ? "🟡" : "🟢";
      lines.push(`  ${icon} ${prioIcon} ${r.assetName.padEnd(25)} ${r.currentTier} → ${r.targetTier}`);
      lines.push(`     Evidence: ${r.evidence.join(", ")}`);
    }
  }
  lines.push("");

  // Evidence Queue
  const evidence = factory.getEvidenceQueue();
  lines.push(`── Evidence Queue (${evidence.length} pending validation) ──`);
  if (evidence.length === 0) {
    lines.push("  No evidence awaiting validation.");
  } else {
    for (const e of evidence) {
      lines.push(`  📋 ${e.assetName.padEnd(25)} ${e.type}: ${e.value} (from: ${e.source})`);
    }
  }
  lines.push("");

  // Promotion Queue
  const promotions = factory.getPromotionQueue();
  lines.push(`── Promotion Queue (${promotions.length} ready) ──`);
  if (promotions.length === 0) {
    lines.push("  No assets ready for promotion.");
  } else {
    for (const p of promotions) {
      const blocked = p.blockedBy.length > 0 ? ` [BLOCKED: ${p.blockedBy.join(", ")}]` : " [UNBLOCKED]";
      lines.push(`  ⬆️ ${p.assetName.padEnd(25)} ${p.from} → ${p.to} (Score: ${p.score})${blocked}`);
    }
  }
  lines.push("");

  // Value proposition
  lines.push("── Evidence Company ──");
  lines.push(`  Progmune doesn't sell detections.`);
  lines.push(`  It accumulates production evidence that turns`);
  lines.push(`  protocol knowledge into trusted governance assets.`);
  lines.push("");
  lines.push(`  Algorithms can be replicated.`);
  lines.push(`  Evidence cannot.`);
  lines.push("");

  return lines.join("\n");
}

if (require.main === module) {
  console.log(formatAssetFactory());
}
