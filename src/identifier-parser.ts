/**
 * Identifier Parser — decompose compound identifiers into semantic tokens.
 *
 * The \b boundary in regex fails on compound names:
 *   registerNewUser → \bregister\b doesn't match
 *   doLogin → \blogin\b doesn't match
 *   performAuthentication → \bauthenticate\b doesn't match
 *
 * This parser splits camelCase/snake_case identifiers and
 * extracts verbs, entities, and actions from compound names.
 *
 * Not AST. Just smarter string splitting.
 *
 * Examples:
 *   registerNewUser      → tokens: [register, new, user]       → verb: register
 *   doLogin              → tokens: [do, login]                 → verb: login
 *   performAuthentication → tokens: [perform, authentication]  → verb: authenticate
 *   verifyTokenSignature → tokens: [verify, token, signature]  → verb: verify
 */

// ═══════════════════════════════════════════════════════════════
// Tokenizer
// ═══════════════════════════════════════════════════════════════

/**
 * Split a camelCase or PascalCase identifier into lowercase tokens.
 * Optionally strips C project prefixes before tokenizing.
 */
export function tokenize(identifier: string, options?: { stripCPrefix?: boolean }): string[] {
  let name = identifier;
  if (options?.stripCPrefix) {
    name = stripCPrefix(identifier);
  }

  // Split on camelCase boundaries
  const tokens: string[] = [];
  let current = "";

  for (let i = 0; i < name.length; i++) {
    const ch = name[i];
    if (ch >= "A" && ch <= "Z" && current.length > 0) {
      tokens.push(current.toLowerCase());
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    tokens.push(current.toLowerCase());
  }

  // Also split on underscores
  const flat: string[] = [];
  for (const t of tokens) {
    flat.push(...t.split("_").filter(Boolean));
  }

  return flat.filter(t => t.length >= 2);
}

// ═══════════════════════════════════════════════════════════════
// Verb Database
// ═══════════════════════════════════════════════════════════════

const VERB_SYNONYMS: Record<string, string> = {
  // Registration / Auth
  register: "register", signup: "register", signUp: "register", createAccount: "register",
  login: "login", signin: "login", signIn: "login", logon: "login", authenticate: "login",
  logout: "logout", signout: "logout", signOut: "logout", logoff: "logout",

  // CRUD
  create: "create", add: "create", insert: "create", new: "create", make: "create", build: "create",
  delete: "delete", remove: "delete", destroy: "delete", drop: "delete", clear: "delete", erase: "delete",
  update: "update", edit: "update", modify: "update", change: "update", set: "update", put: "update",
  get: "get", fetch: "get", retrieve: "get", read: "get", load: "get", find: "get", query: "get",
  list: "list", search: "list", all: "list", browse: "list", enumerate: "list",

  // Actions
  assign: "assign", transfer: "transfer", share: "share", schedule: "schedule",
  upload: "upload", download: "download", send: "send", post: "post", publish: "post",
  process: "process", verify: "verify", validate: "validate", check: "verify",
  authorize: "authorize", permit: "authorize", allow: "authorize",
  toggle: "toggle", lock: "lock", unlock: "unlock", enable: "enable", disable: "disable",
  perform: "perform", execute: "execute", run: "execute", do: "do",
  start: "start", begin: "start", stop: "stop", end: "stop", cancel: "cancel", abort: "cancel",

  // ── C Verbs (additive only — no duplicates with entries above) ──
  init: "init", initialize: "init", initialise: "init",
  config: "config", configure: "config", cfg: "config", setup: "config",
  handshake: "connect", negotiate: "connect",
  free: "free", cleanup: "free", dispose: "free",
  alloc: "alloc", allocate: "alloc", malloc: "alloc", calloc: "alloc", realloc: "alloc",
  kex: "kex", ecdh: "ecdh", dh: "dh", curve: "curve", derive: "derive",
  bind: "bind", listen: "listen", accept: "accept",
  recv: "recv", write: "write",
  open: "open", close: "close", shutdown: "close",
  pin: "pin", cert: "cert", certificate: "cert",
  poll: "poll",
  parse: "parse", decode: "decode", encode: "encode",
  copy: "copy", move: "move", rename: "rename",
  hash: "hash", sign: "sign", encrypt: "encrypt", decrypt: "decrypt",
  seed: "seed", random: "random", generate: "generate",
  finish: "finish", complete: "finish", done: "finish",
  reset: "reset", restart: "reset", reload: "reset",
  flush: "flush", sync: "sync", commit: "commit", rollback: "rollback",
};

/**
 * Map a token to its canonical verb form.
 * Handles common suffixes: authentication→authenticate, verification→verify, etc.
 */
function canonicalVerb(token: string): string | null {
  // Direct match
  if (VERB_SYNONYMS[token]) return VERB_SYNONYMS[token];

  // Stemming: authentication → authenticate, registration → register
  const stemMap: Record<string, string> = {
    authentication: "authenticate", registration: "register",
    verification: "verify", validation: "validate",
    authorization: "authorize", creation: "create",
    deletion: "delete", modification: "modify", updation: "update",
    assignment: "assign", transfer: "transfer",
    execution: "execute", cancellation: "cancel",
    notification: "notify", publication: "publish",
    // C-style stems
    initialization: "init", initialisation: "init",
    configuration: "config", allocation: "alloc",
    negotiation: "negotiate", connection: "connect",
    derivation: "derive", generation: "generate",
    encryption: "encrypt", decryption: "decrypt",
    completion: "finish", destruction: "destroy",
  };
  if (stemMap[token]) return stemMap[token];

  // -ize / -ise suffix: finalize→final, synchronize→sync, sanitize→sanitize
  if (token.endsWith("ize") || token.endsWith("ise")) {
    const base = token.slice(0, token.endsWith("ize") ? -3 : -3);
    if (VERB_SYNONYMS[base]) return VERB_SYNONYMS[base];
    return base; // finalize → final, sanitize → sanitize
  }

  // Common suffixes: -ing, -ed, -ion
  if (token.endsWith("ing")) {
    const base = token.slice(0, -3);
    if (VERB_SYNONYMS[base]) return VERB_SYNONYMS[base];
    // running → run, stopping → stop
    if (base.endsWith("nn")) return base.slice(0, -1); // running → run
    if (base.endsWith("pp")) return base.slice(0, -1); // stopping → stop
    return base; // creating → create
  }

  if (token.endsWith("ed")) {
    const base = token.slice(0, -2);
    if (VERB_SYNONYMS[base]) return VERB_SYNONYMS[base];
    if (base.endsWith("i")) return base.slice(0, -1) + "y"; // verified → verify
    return base; // created → create
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// C Prefix Stripping
// ═══════════════════════════════════════════════════════════════

/**
 * Known C project/library prefixes that hide semantic verbs.
 * Curl_conn_connect → after stripping: conn_connect
 * ssh_userauth_agent → after stripping: userauth_agent
 */
const C_PROJECT_PREFIXES = [
  "Curl_", "curl_", "mbedtls_", "mbed_", "ngx_", "ossl_",
  "SSL_", "ssh_", "EC_", "EC_KEY_", "EVP_", "DH_", "BN_",
  "BIO_", "X509_", "SSL_CTX_", "wolfSSL_", "gtls_", "gcry_",
  "OSSL_PARAM_", "OPENSSL_", "CONF_",
];

/**
 * Strip known C project prefixes from a function name.
 * For example: Curl_auth_create_ntlm_type1_message → auth_create_ntlm_type1_message
 */
export function stripCPrefix(name: string): string {
  for (const prefix of C_PROJECT_PREFIXES) {
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  }
  return name;
}

/**
 * Detect if an identifier looks like C naming (has known C prefix or is all snake_case).
 */
export function isCNaming(name: string): boolean {
  // Check known C prefixes
  for (const prefix of C_PROJECT_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }
  // Check if it's pure snake_case with no camelCase boundaries
  if (name.includes("_") && !/[a-z][A-Z]/.test(name)) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════
// Parser API
// ═══════════════════════════════════════════════════════════════

export interface ParsedIdentifier {
  original: string;
  tokens: string[];
  verb: string | null;
  entity: string | null;
  isRead: boolean;
  isMutate: boolean;
}

/**
 * Parse a function name into semantic components.
 *
 * registerNewUser → { verb: "register", entity: "user", isMutate: true }
 * getContact     → { verb: "get", entity: "contact", isRead: true }
 * doLogin        → { verb: "login", entity: null, isMutate: true }
 */
export function parseIdentifier(functionName: string, options?: { stripCPrefix?: boolean }): ParsedIdentifier {
  const tokens = tokenize(functionName, options);
  let verb: string | null = null;
  let entity: string | null = null;

  // Find the first meaningful verb token
  // Skip helper prefixes: do, perform, execute, run
  for (let i = 0; i < tokens.length; i++) {
    // If this is a helper prefix and there's a next token, use the next token as verb
    if (["do", "perform", "execute", "run"].includes(tokens[i]) && i + 1 < tokens.length) {
      const nextCv = canonicalVerb(tokens[i + 1]);
      if (nextCv) {
        verb = nextCv;
        entity = tokens.slice(i + 2).filter(t => t.length >= 2 && !["new", "the", "for", "by", "to", "of", "in", "on", "at"].includes(t)).join("_") || null;
        break;
      }
      // Even without canonical form, use the next token as verb
      verb = tokens[i + 1];
      entity = tokens.slice(i + 2).filter(t => t.length >= 2).join("_") || null;
      break;
    }

    const cv = canonicalVerb(tokens[i]);
    if (cv) {
      verb = cv;
      // Entity = remaining tokens after the verb
      const remaining = tokens.slice(i + 1).filter(t => t.length >= 2 && !["new", "the", "for", "by", "to", "of", "in", "on", "at", "my", "our", "all", "one"].includes(t));
      if (remaining.length > 0) {
        entity = remaining.join("_");
      }
      break;
    }
  }

  // If no canonical verb found, use the first token as-is
  if (!verb && tokens.length > 0) {
    verb = tokens[0];
    if (tokens.length > 1) {
      entity = tokens.slice(1).join("_");
    }
  }

  const readVerbs = new Set(["get", "fetch", "retrieve", "read", "load", "find", "query", "list", "search", "browse", "view"]);
  const mutateVerbs = new Set(["create", "add", "insert", "delete", "remove", "destroy", "update", "edit", "modify", "set", "register", "login", "logout", "assign", "transfer", "share", "upload", "send", "post", "process", "toggle", "lock", "unlock", "execute", "perform", "cancel"]);

  return {
    original: functionName,
    tokens,
    verb,
    entity,
    isRead: verb !== null && readVerbs.has(verb),
    isMutate: verb !== null && mutateVerbs.has(verb),
  };
}

/**
 * Parse all function names in a call list and return enriched call data.
 */
export function enrichCalls(calls: string[]): ParsedIdentifier[] {
  return calls.map(c => parseIdentifier(c));
}
