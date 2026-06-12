/**
 * P4.5+: Discovery Reward Model
 *
 * Predicts P(candidate_exists | goal, protocol, violation) rather than
 * P(accepted | candidate). This is the signal that should drive
 * Guided Frontier — not "how likely is this path to be accepted?"
 * but "how likely is a path through this state to even be found?"
 *
 * Training data: benchmark attributions (foundCandidate = 1 - missingCandidate)
 * Features: protocol, violation type, state context
 *
 * When 57% of failures are missing_candidate, the most valuable signal
 * for search guidance is discoverability, not acceptability.
 */

import { runFailureAttribution, AttributedCase } from "./evaluation-campaign";
import type { PlannerTelemetry } from "./planner-telemetry";

// ═══════════════════════════════════════════════════════════════
// Discovery Features
// ═══════════════════════════════════════════════════════════════

export interface DiscoveryFeatures {
  protocol: string;
  violationType: string;
  isResourceLeak: number;
  isMissingPrereq: number;
  isIllegalState: number;
  currentStateCount: number;
}

export interface DiscoverySample {
  features: DiscoveryFeatures;
  label: number; // 1 = candidate found, 0 = not found
  goal: string;
}

function sigmoid(z: number): number {
  if (z > 20) return 1.0;
  if (z < -20) return 0.0;
  return 1.0 / (1.0 + Math.exp(-z));
}

// ═══════════════════════════════════════════════════════════════
// Discovery Model
// ═══════════════════════════════════════════════════════════════

const KNOWN_PROTOCOLS = ["FileProtocol", "AuthProtocol", "DBProtocol", "IRProtocol", "_global"];
const KNOWN_VIOLATIONS = ["resource_leak", "missing_prerequisite", "illegal_state_transition"];

function featuresToArray(f: DiscoveryFeatures): number[] {
  const protoBits = KNOWN_PROTOCOLS.map(p => f.protocol === p ? 1.0 : 0.0);
  const violBits = KNOWN_VIOLATIONS.map(v => f.violationType === v ? 1.0 : 0.0);
  return [
    f.isResourceLeak,
    f.isMissingPrereq,
    f.isIllegalState,
    f.currentStateCount / 10,
    ...protoBits,
    ...violBits,
  ];
}

const FEATURE_DIM = 4 + KNOWN_PROTOCOLS.length + KNOWN_VIOLATIONS.length; // 4 + 5 + 3 = 12

export class DiscoveryModel {
  private weights: number[];
  private bias: number;
  private trained: boolean;
  private trainedSamples: number;

  constructor(weights?: number[], bias?: number) {
    this.weights = weights || new Array(FEATURE_DIM).fill(0);
    this.bias = bias || 0;
    this.trained = weights !== undefined;
    this.trainedSamples = 0;
  }

  get isTrained(): boolean { return this.trained; }
  get sampleCount(): number { return this.trainedSamples; }

  /** Predict probability that a candidate exists for this context. */
  predict(features: DiscoveryFeatures): number {
    return sigmoid(this.score(featuresToArray(features)));
  }

  private score(x: number[]): number {
    return x.reduce((s, v, i) => s + this.weights[i] * v, 0) + this.bias;
  }

  // ── Training ──

  static samplesFromAttributions(attributed: AttributedCase[]): DiscoverySample[] {
    return attributed.map(a => ({
      features: {
        protocol: a.protocol,
        violationType: a.violationType,
        isResourceLeak: a.violationType === "resource_leak" ? 1 : 0,
        isMissingPrereq: a.violationType === "missing_prerequisite" ? 1 : 0,
        isIllegalState: a.violationType === "illegal_state_transition" ? 1 : 0,
        currentStateCount: 1,
      },
      label: a.failureReason !== "missing_candidate" ? 1 : 0,
      goal: a.goal,
    }));
  }

  static train(samples: DiscoverySample[], learningRate: number = 0.01, epochs: number = 100): DiscoveryModel {
    if (samples.length < 10) return new DiscoveryModel();

    let w = new Array(FEATURE_DIM).fill(0).map(() => (Math.random() - 0.5) * 0.1);
    let b = 0.0;

    for (let epoch = 0; epoch < epochs; epoch++) {
      const shuffled = [...samples].sort(() => Math.random() - 0.5);

      for (const sample of shuffled) {
        const x = featuresToArray(sample.features);
        const z = w.reduce((s, wi, i) => s + wi * x[i], 0) + b;
        const p = sigmoid(z);
        const error = p - sample.label;

        for (let i = 0; i < FEATURE_DIM; i++) {
          w[i] -= learningRate * error * x[i];
        }
        b -= learningRate * error;
      }
    }

    const model = new DiscoveryModel(w, b);
    model.trained = true;
    model.trainedSamples = samples.length;
    return model;
  }

  /** Feature importance for interpretability. */
  featureImportance(): { name: string; weight: number }[] {
    const names = [
      "isResourceLeak", "isMissingPrereq", "isIllegalState", "stateCount",
      ...KNOWN_PROTOCOLS.map(p => `proto:${p}`),
      ...KNOWN_VIOLATIONS.map(v => `viol:${v}`),
    ];
    return names.map((name, i) => ({ name, weight: this.weights[i] }))
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  }
}

// ═══════════════════════════════════════════════════════════════
// Discovery Analytics
// ═══════════════════════════════════════════════════════════════

export interface DiscoveryPrediction {
  protocol: string;
  violationType: string;
  discoverability: number; // P(candidate exists)
  priority: number;        // 1 - discoverability (higher = needs more attention)
}

/**
 * Generate a discoverability report: which protocol/violation combinations
 * are least likely to have candidates found?
 */
export function generateDiscoverabilityReport(
  model: DiscoveryModel
): DiscoveryPrediction[] {
  const predictions: DiscoveryPrediction[] = [];

  for (const proto of KNOWN_PROTOCOLS) {
    for (const viol of KNOWN_VIOLATIONS) {
      const features: DiscoveryFeatures = {
        protocol: proto,
        violationType: viol,
        isResourceLeak: viol === "resource_leak" ? 1 : 0,
        isMissingPrereq: viol === "missing_prerequisite" ? 1 : 0,
        isIllegalState: viol === "illegal_state_transition" ? 1 : 0,
        currentStateCount: 1,
      };
      const discoverability = model.predict(features);
      predictions.push({
        protocol: proto,
        violationType: viol,
        discoverability,
        priority: 1 - discoverability,
      });
    }
  }

  return predictions.sort((a, b) => b.priority - a.priority);
}

export function printDiscoverabilityReport(predictions: DiscoveryPrediction[]): void {
  console.log("\n─── Discoverability Report ───");
  console.log("Protocol          Violation                Discover  Priority");
  console.log("─────────────────────────────────────────────────────────────");

  for (const p of predictions.slice(0, 10)) {
    const disc = (p.discoverability * 100).toFixed(0).padStart(4);
    const pri = (p.priority * 100).toFixed(0).padStart(4);
    const icon = p.priority > 0.5 ? "🔴" : p.priority > 0.3 ? "🟡" : "🟢";
    console.log(`  ${p.protocol.padEnd(16)} ${p.violationType.padEnd(22)} ${disc}%   ${pri}%  ${icon}`);
  }
  console.log();
}
