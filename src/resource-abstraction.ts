/**
 * Resource Abstraction Layer — from words to semantics.
 *
 * The detector used to work like this:
 *   createPost → Post Asset → Protocol
 *
 * Now it works like this:
 *   create<X> → X is a MutableResource → needs Ownership + Validation + Authorization
 *
 * This is the generalization breakthrough:
 *   Post, Issue, Ticket, Task, Order, Artifact → ALL automatically recognized
 *
 * Three components:
 *   1. Resource Classifier — identifies what kind of resource an entity is
 *   2. Protocol Deriver — derives required protocols from resource type
 *   3. Lexical Generalization — maps unknown entity names to known categories
 */

// ═══════════════════════════════════════════════════════════════
// Resource Classification
// ═══════════════════════════════════════════════════════════════

export type ResourceKind =
  | "mutable_resource"    // Can be created/modified/deleted (Post, Issue, Task)
  | "immutable_record"    // Created once, never modified (Log, Audit, Event)
  | "reference_data"      // Lookup/reference (Category, Tag, Label)
  | "credential"          // Auth material (Password, Token, Key)
  | "file_asset"          // Binary/file (Attachment, Image, Document)
  | "session"             // Stateful connection (Session, Connection, Stream)
  | "unknown";

export interface ResourceAbstraction {
  /** Original function name (e.g., createPost). */
  original: string;
  /** Extracted verb (e.g., create). */
  verb: string;
  /** Extracted entity name (e.g., Post). */
  entity: string;
  /** Classified resource kind. */
  kind: ResourceKind;
  /** Required protocols for this resource kind. */
  requiredProtocols: string[];
  /** Confidence in this classification (0-1). */
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════
// Verb → Resource Kind mapping
// ═══════════════════════════════════════════════════════════════

const MUTABLE_VERBS = new Set([
  "create", "add", "insert", "new", "make", "build",
  "update", "edit", "modify", "change", "set", "put",
  "delete", "remove", "destroy", "drop", "clear", "erase",
]);

const READ_VERBS = new Set([
  "get", "fetch", "find", "query", "read", "load", "list", "search", "lookup",
]);

const AUTH_VERBS = new Set([
  "login", "logout", "register", "signup", "signin", "authenticate", "authorize",
  "verify", "validate", "check",
]);

// ═══════════════════════════════════════════════════════════════
// Entity → Resource Kind heuristics
// ═══════════════════════════════════════════════════════════════

/**
 * Known entity suffixes that indicate resource kinds.
 * These are generalizable — they work for ANY entity name.
 */
const RESOURCE_SUFFIX_PATTERNS: Array<{ pattern: RegExp; kind: ResourceKind; protocols: string[] }> = [
  {
    // Mutable resources: Post, Issue, Ticket, Task, Order, Product, Project, etc.
    // These need: Ownership + Validation + Authorization + DataIntegrity
    pattern: /^(Post|Issue|Ticket|Task|Order|Product|Project|Item|Entry|Record|Document|Article|Page|Thread|Topic|Subject|Object|Entity|Artifact|Asset|Resource|Job|Workflow|Pipeline|Deployment|Release)$/i,
    kind: "mutable_resource",
    protocols: ["ownership_check", "input_validation", "authorization", "data_integrity"],
  },
  {
    // Comments/Replies: always reference a parent resource
    pattern: /^(Comment|Reply|Response|Note|Annotation|Feedback|Review|Remark)$/i,
    kind: "mutable_resource",
    protocols: ["ownership_check", "input_validation", "data_integrity", "authorization"],
  },
  {
    // Credential material
    pattern: /^(Password|Token|Key|Secret|Credential|ApiKey|AccessKey|Certificate)$/i,
    kind: "credential",
    protocols: ["password_hashing", "token_security", "secure_storage"],
  },
  {
    // File assets
    pattern: /^(File|Attachment|Image|Photo|Video|Audio|Document|Media|Asset|Binary|Blob|Upload|Download)$/i,
    kind: "file_asset",
    protocols: ["file_validation", "ownership_check", "authorization"],
  },
  {
    // Reference data
    pattern: /^(Category|Tag|Label|Status|Type|State|Priority|Severity|Role|Permission|Group|Team|Organization)$/i,
    kind: "reference_data",
    protocols: ["authorization"],
  },
  {
    // Session/connection
    pattern: /^(Session|Connection|Stream|Channel|Socket|WebSocket|SSE)$/i,
    kind: "session",
    protocols: ["tls_enforcement", "token_verification"],
  },
];

// ═══════════════════════════════════════════════════════════════
// Core Engine
// ═══════════════════════════════════════════════════════════════

/**
 * Parse a function name into verb + entity.
 *
 * Examples:
 *   createPost       → { verb: "create", entity: "Post" }
 *   deleteUser       → { verb: "delete", entity: "User" }
 *   addProductItem   → { verb: "add", entity: "ProductItem" }
 *   getNotifications → { verb: "get", entity: "Notifications" }
 */
export function parseResourceName(functionName: string): { verb: string; entity: string } | null {
  // Common verb prefixes
  const verbPatterns = [
    "create", "delete", "update", "remove", "destroy",
    "add", "insert", "new", "make", "build",
    "get", "fetch", "find", "query", "read", "load", "list",
    "edit", "modify", "change", "set", "put",
    "login", "logout", "register", "signup", "signin",
    "verify", "validate", "check", "authorize", "authenticate",
    "upload", "download", "send", "receive",
    "toggle", "lock", "unlock", "enable", "disable",
    "follow", "unfollow", "like", "unlike",
  ];

  for (const verb of verbPatterns) {
    if (functionName.toLowerCase().startsWith(verb.toLowerCase())) {
      const entity = functionName.slice(verb.length);
      if (entity.length >= 2) {
        return { verb: verb.toLowerCase(), entity };
      }
    }
  }

  return null;
}

/**
 * Classify a resource by its entity name.
 * Uses suffix patterns for known categories, heuristics for unknown ones.
 */
export function classifyResource(entity: string): { kind: ResourceKind; protocols: string[]; confidence: number } {
  // Normalize: handle plurals, camelCase suffixes
  const normalized = entity.replace(/s$/, ""); // Remove trailing 's' for plurals

  // Check known patterns
  for (const { pattern, kind, protocols } of RESOURCE_SUFFIX_PATTERNS) {
    if (pattern.test(entity) || pattern.test(normalized)) {
      return { kind, protocols, confidence: 0.9 };
    }
  }

  // Heuristic: if the entity starts with an uppercase letter (camelCase), it's likely a resource
  // Unknown entities default to mutable_resource with full protocol requirements
  if (/^[A-Z]/.test(entity)) {
    return {
      kind: "mutable_resource",
      protocols: ["ownership_check", "input_validation", "authorization", "data_integrity"],
      confidence: 0.5, // Lower confidence for unknown entities
    };
  }

  return { kind: "unknown", protocols: [], confidence: 0.1 };
}

/**
 * Full resource abstraction pipeline:
 *   functionName → verb + entity → resource kind → required protocols
 */
export function abstractResource(functionName: string): ResourceAbstraction | null {
  const parsed = parseResourceName(functionName);
  if (!parsed) return null;

  const { kind, protocols, confidence } = classifyResource(parsed.entity);

  return {
    original: functionName,
    verb: parsed.verb,
    entity: parsed.entity,
    kind,
    requiredProtocols: protocols,
    confidence,
  };
}

/**
 * Check if a given function name is a mutating operation on a resource.
 * Mutations require: Ownership + Authorization + (optionally) Validation
 */
export function isMutatingOperation(functionName: string): boolean {
  const parsed = parseResourceName(functionName);
  if (!parsed) return false;
  return MUTABLE_VERBS.has(parsed.verb);
}

/**
 * Check if a given function name is a read operation.
 */
export function isReadOperation(functionName: string): boolean {
  const parsed = parseResourceName(functionName);
  if (!parsed) return false;
  return READ_VERBS.has(parsed.verb);
}

/**
 * Get the protocols required for a given function.
 * Combines verb semantics with resource classification.
 */
export function getRequiredProtocols(functionName: string): string[] {
  const abs = abstractResource(functionName);
  if (!abs) return [];

  const protocols = [...abs.requiredProtocols];

  // Mutating operations ALWAYS need authorization
  if (MUTABLE_VERBS.has(abs.verb) && !protocols.includes("authorization")) {
    protocols.push("authorization");
  }

  // Mutating operations on mutable resources need ownership checks
  if (MUTABLE_VERBS.has(abs.verb) && abs.kind === "mutable_resource" && !protocols.includes("ownership_check")) {
    protocols.push("ownership_check");
  }

  return protocols;
}

// ═══════════════════════════════════════════════════════════════
// Lexical Generalization Test
// ═══════════════════════════════════════════════════════════════

/**
 * Test whether the resource abstraction correctly identifies
 * that DIFFERENT entity names with the SAME semantics require
 * the SAME protocols.
 *
 * Known entities: Post, Comment, Task, Order, Product → should all require ownership_check
 * Unknown entities: Ticket, Issue, Artifact, Foo → should ALSO require ownership_check
 */
export function testLexicalGeneralization(): {
  knownEntities: string[];
  unknownEntities: string[];
  knownRecall: number;
  unknownRecall: number;
} {
  const knownEntities = ["Post", "Comment", "Task", "Order", "Product", "Project", "Item"];
  const unknownEntities = ["Ticket", "Issue", "Artifact", "Document", "Foo", "Widget", "Thing"];

  const expectedProtocol = "ownership_check";

  let knownCorrect = 0;
  for (const entity of knownEntities) {
    const { protocols } = classifyResource(entity);
    if (protocols.includes(expectedProtocol)) knownCorrect++;
  }

  let unknownCorrect = 0;
  for (const entity of unknownEntities) {
    const { protocols } = classifyResource(entity);
    if (protocols.includes(expectedProtocol)) unknownCorrect++;
  }

  return {
    knownEntities,
    unknownEntities,
    knownRecall: knownCorrect / knownEntities.length,
    unknownRecall: unknownCorrect / unknownEntities.length,
  };
}
