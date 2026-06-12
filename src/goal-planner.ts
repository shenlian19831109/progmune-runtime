/**
 * P3.10: Goal-conditioned Protocol Planner
 *
 * Expands high-level goals into prerequisite subgoal chains,
 * enabling ProtocolStrategy BFS to discover multi-step repair paths.
 *
 * Problem: ProtocolStrategy BFS can find single-hop cleanup (close_file)
 * but can't plan "logout user" → [verify_password, generate_jwt,
 * create_session, logout]. This causes 39% missing_candidate failures.
 *
 * Solution: Goal Templates map goal patterns to prerequisite chains.
 * Lightweight (~20 templates), manually maintained, no GNN required.
 *
 * Target: reduce missing_candidate from 39% to <20%, Top-3 from 29% to >60%.
 */

import type { StateAnnotation } from "./ssg-validator";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface GoalTemplate {
  /** Regex pattern to match natural language goals. */
  pattern: RegExp;
  /** Protocol namespace this template applies to. */
  protocol: string;
  /**
   * Ordered prerequisite chains. Each element is a sequence of
   * function names that must be called to satisfy a subgoal.
   * Templates can have multiple chains for different goal variants.
   */
  prerequisiteChains: string[][];
  /** States that must be reached before the final action. */
  requiredStates: string[];
  /** Target states after full completion. */
  targetStates: string[];
}

export interface GoalPlan {
  goal: string;
  protocol: string;
  /** Template that matched (if any). */
  template?: string;
  /** Ordered subgoal descriptions. */
  subgoals: string[];
  /** Full action sequence to satisfy all subgoals. */
  actions: string[];
  /** 0-1 confidence in this plan. */
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════
// Goal Templates (~20 patterns covering 4 protocol groups)
// ═══════════════════════════════════════════════════════════════

const GOAL_TEMPLATES: GoalTemplate[] = [
  // ── Auth Protocol ──
  {
    pattern: /\b(logout|log\s*out|sign\s*out|terminate\s*session|end\s*session)\b/i,
    protocol: "AuthProtocol",
    prerequisiteChains: [
      ["verify_password", "generate_jwt", "create_session"],
    ],
    requiredStates: ["SESSION_ACTIVE"],
    targetStates: ["UNAUTHENTICATED"],
  },
  {
    pattern: /\b(authenticate|auth|login|sign\s*in|verify\s*user|validate\s*user)\b/i,
    protocol: "AuthProtocol",
    prerequisiteChains: [
      ["verify_password", "generate_jwt", "create_session"],
    ],
    requiredStates: ["SESSION_ACTIVE"],
    targetStates: ["SESSION_ACTIVE"],
  },
  {
    pattern: /\b(create\s*session|establish\s*session|start\s*session)\b/i,
    protocol: "AuthProtocol",
    prerequisiteChains: [
      ["verify_password", "generate_jwt"],
    ],
    requiredStates: ["TOKEN_ISSUED"],
    targetStates: ["SESSION_ACTIVE"],
  },
  {
    pattern: /\b(generate\s*token|issue\s*token|create\s*token|jwt)\b/i,
    protocol: "AuthProtocol",
    prerequisiteChains: [
      ["verify_password"],
    ],
    requiredStates: ["PASSWORD_VERIFIED"],
    targetStates: ["TOKEN_ISSUED"],
  },
  {
    pattern: /\b(full\s*auth|complete\s*auth|auth\s*lifecycle|auth\s*cycle)\b/i,
    protocol: "AuthProtocol",
    prerequisiteChains: [
      ["verify_password", "generate_jwt", "create_session", "logout"],
    ],
    requiredStates: ["UNAUTHENTICATED"],
    targetStates: ["UNAUTHENTICATED"],
  },
  {
    pattern: /\brevok.*(?:token|auth)|re-?authenticate/i,
    protocol: "AuthProtocol",
    prerequisiteChains: [
      ["verify_password", "generate_jwt"],
    ],
    requiredStates: ["TOKEN_ISSUED"],
    targetStates: ["UNAUTHENTICATED"],
  },

  // ── File Protocol ──
  {
    pattern: /\b(safely\s*write|write.*file|write.*config|save.*file|persist.*file)\b/i,
    protocol: "FileProtocol",
    prerequisiteChains: [
      ["open_file", "write_file"],
    ],
    requiredStates: ["FILE_OPEN"],
    targetStates: [],
  },
  {
    pattern: /\b(read.*file|open.*read|load.*file|parse.*file)\b/i,
    protocol: "FileProtocol",
    prerequisiteChains: [
      ["open_file", "read_file"],
    ],
    requiredStates: ["FILE_OPEN"],
    targetStates: [],
  },
  {
    pattern: /\b(append.*file|add.*to.*file|update.*file)\b/i,
    protocol: "FileProtocol",
    prerequisiteChains: [
      ["open_file", "write_file"],
    ],
    requiredStates: ["FILE_OPEN"],
    targetStates: [],
  },
  {
    pattern: /\b(double\s*open|re-?open.*file)\b/i,
    protocol: "FileProtocol",
    prerequisiteChains: [
      ["open_file"],
    ],
    requiredStates: ["FILE_OPEN"],
    targetStates: [],
  },

  // ── Database Protocol ──
  {
    pattern: /\b(query|select|fetch|read.*db|db.*read|database.*read)\b/i,
    protocol: "DBProtocol",
    prerequisiteChains: [
      ["connect_db", "query_db"],
    ],
    requiredStates: ["DB_CONNECTED"],
    targetStates: [],
  },
  {
    pattern: /\b(insert|create.*record|add.*record|db.*write|write.*db)\b/i,
    protocol: "DBProtocol",
    prerequisiteChains: [
      ["connect_db", "query_db"],
    ],
    requiredStates: ["DB_CONNECTED"],
    targetStates: [],
  },
  {
    pattern: /\b(connect.*db|db.*connect|open.*database|database.*open)\b/i,
    protocol: "DBProtocol",
    prerequisiteChains: [
      ["connect_db"],
    ],
    requiredStates: ["DB_CONNECTED"],
    targetStates: [],
  },
  {
    pattern: /\b(reconnect|re-?connect)\b/i,
    protocol: "DBProtocol",
    prerequisiteChains: [
      ["connect_db", "disconnect_db", "connect_db", "query_db"],
    ],
    requiredStates: ["DB_CONNECTED"],
    targetStates: [],
  },
  {
    pattern: /\b(bulk|batch|multi.*query|multi.*insert)\b/i,
    protocol: "DBProtocol",
    prerequisiteChains: [
      ["connect_db", "query_db"],
    ],
    requiredStates: ["DB_CONNECTED"],
    targetStates: [],
  },

  // ── IR Pipeline Protocol ──
  {
    pattern: /\b(extract.*ir|ir.*extract|scan.*code|code.*scan)\b/i,
    protocol: "IRProtocol",
    prerequisiteChains: [
      ["extractIR", "validateAction", "validateActionSequence", "emitCode"],
    ],
    requiredStates: ["CODE_EMITTED"],
    targetStates: ["CODE_EMITTED"],
  },
  {
    pattern: /\b(validate.*action|action.*valid|check.*action)\b/i,
    protocol: "IRProtocol",
    prerequisiteChains: [
      ["extractIR", "validateAction"],
    ],
    requiredStates: ["ACTION_VALIDATED"],
    targetStates: ["ACTION_VALIDATED"],
  },
  {
    pattern: /\b(emit.*code|generate.*code|code.*gen|output.*code)\b/i,
    protocol: "IRProtocol",
    prerequisiteChains: [
      ["extractIR", "validateAction", "validateActionSequence", "emitCode"],
    ],
    requiredStates: ["CODE_EMITTED"],
    targetStates: ["CODE_EMITTED"],
  },
  {
    pattern: /\b(record.*session|save.*session|session.*record|store.*session)\b/i,
    protocol: "IRProtocol",
    prerequisiteChains: [
      ["extractIR", "validateAction", "validateActionSequence", "emitCode", "recordSession"],
    ],
    requiredStates: ["SESSION_RECORDED"],
    targetStates: ["SESSION_RECORDED"],
  },
  {
    pattern: /\b(full.*pipeline|complete.*pipeline|end.*to.*end|ir.*pipeline|pipeline.*ir)\b/i,
    protocol: "IRProtocol",
    prerequisiteChains: [
      ["extractIR", "validateAction", "validateActionSequence", "emitCode", "recordSession"],
    ],
    requiredStates: ["SESSION_RECORDED"],
    targetStates: ["SESSION_RECORDED"],
  },
  {
    pattern: /\b(re-?extract.*ir|stale.*ir|refresh.*ir)\b/i,
    protocol: "IRProtocol",
    prerequisiteChains: [
      ["extractIR", "validateAction"],
    ],
    requiredStates: ["ACTION_VALIDATED"],
    targetStates: ["ACTION_VALIDATED"],
  },

  // ── Cross-protocol ──
  {
    pattern: /\b(auth.*file|file.*auth|authenticate.*write|login.*save)\b/i,
    protocol: "AuthProtocol",
    prerequisiteChains: [
      ["verify_password", "generate_jwt", "create_session"],
    ],
    requiredStates: ["SESSION_ACTIVE"],
    targetStates: ["SESSION_ACTIVE"],
  },
  {
    pattern: /\b(db.*file|file.*db|database.*file|file.*database)\b/i,
    protocol: "DBProtocol",
    prerequisiteChains: [
      ["connect_db", "query_db", "disconnect_db"],
    ],
    requiredStates: [],
    targetStates: [],
  },
];

// ═══════════════════════════════════════════════════════════════
// Goal Planner
// ═══════════════════════════════════════════════════════════════

export class GoalPlanner {
  private templates: GoalTemplate[];

  constructor(templates?: GoalTemplate[]) {
    this.templates = templates || GOAL_TEMPLATES;
  }

  /**
   * Expand a natural language goal into an action sequence.
   *
   * Returns null if no template matches — caller falls back to
   * existing ProtocolStrategy BFS.
   */
  expandGoal(goal: string): GoalPlan | null {
    // Find matching templates (sorted by specificity: longer pattern match = better)
    const matches = this.templates
      .filter(t => t.pattern.test(goal))
      .sort((a, b) => {
        const aLen = (goal.match(a.pattern)?.[0]?.length ?? 0);
        const bLen = (goal.match(b.pattern)?.[0]?.length ?? 0);
        return bLen - aLen;
      });

    if (matches.length === 0) return null;

    const template = matches[0];
    // Use the best chain (first = most specific for this template)
    const chain = template.prerequisiteChains[0];

    // Build subgoal descriptions from the chain
    const subgoals = chain.map((fn, i) => {
      const stepNames: Record<string, string> = {
        verify_password: "verify user credentials",
        generate_jwt: "issue authentication token",
        create_session: "establish active session",
        logout: "terminate session",
        open_file: "open file handle",
        read_file: "read file contents",
        write_file: "write file contents",
        close_file: "close file handle",
        connect_db: "connect to database",
        query_db: "query database",
        disconnect_db: "disconnect from database",
        extractIR: "extract intermediate representation",
        validateAction: "validate action semantics",
        validateActionSequence: "validate action sequence",
        emitCode: "emit target code",
        recordSession: "record execution session",
      };
      return stepNames[fn] || `step ${i + 1}: ${fn}`;
    });

    return {
      goal,
      protocol: template.protocol,
      template: goal.match(template.pattern)?.[0],
      subgoals,
      actions: chain,
      confidence: 0.85,
    };
  }

  /**
   * Get all action sequences that could satisfy a goal.
   * Used by ProtocolStrategy to generate candidates beyond single-hop BFS.
   */
  getCandidateActions(goal: string): string[][] {
    const matches = this.templates
      .filter(t => t.pattern.test(goal))
      .sort((a, b) => {
        const aLen = (goal.match(a.pattern)?.[0]?.length ?? 0);
        const bLen = (goal.match(b.pattern)?.[0]?.length ?? 0);
        return bLen - aLen;
      });

    return matches.flatMap(t => t.prerequisiteChains);
  }

  /** Check if a template exists for this goal. */
  hasTemplate(goal: string): boolean {
    return this.templates.some(t => t.pattern.test(goal));
  }
}

// ═══════════════════════════════════════════════════════════════
// Goal-aware Candidate Expansion
// ═══════════════════════════════════════════════════════════════

/**
 * Expand a goal into additional repair actions.
 *
 * Given a goal like "safely write config file", this returns
 * ["open_file", "write_file"] — the prerequisite chain that
 * ProtocolStrategy BFS can then validate and extend.
 *
 * Used by ProtocolStrategy to discover multi-step candidates
 * that single-hop BFS from currentState alone would miss.
 */
export function expandGoalActions(
  goal: string,
  planner?: GoalPlanner
): string[] {
  const gp = planner || new GoalPlanner();
  const plan = gp.expandGoal(goal);
  return plan?.actions ?? [];
}

/** Singleton for use across the codebase. */
let _defaultPlanner: GoalPlanner | null = null;
export function getGoalPlanner(): GoalPlanner {
  if (!_defaultPlanner) _defaultPlanner = new GoalPlanner();
  return _defaultPlanner;
}
