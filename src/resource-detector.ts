/**
 * Resource Lifecycle Detector
 *
 * Focused detection of resource acquire/release violations.
 * Replaces noisy auto-discovered call-ordering rules with
 * explicit acquire→release pair analysis.
 *
 * Strategy:
 *   1. Identify resource-acquiring calls (malloc, open, connect, SSL_new, ...)
 *   2. Identify resource-releasing calls (free, close, disconnect, SSL_free, ...)
 *   3. Flag violations: acquire without corresponding release in same scope
 *   4. Exclude "allocation-return" pattern (function allocates for caller)
 */

// ── Known resource pairs ──

const RESOURCE_PAIRS: Array<{ acquire: RegExp; release: RegExp; category: string }> = [
  // Memory
  { acquire: /\b(malloc|calloc|realloc|curlx_malloc|curlx_calloc|curlx_realloc|zmalloc|zcalloc|zrealloc|ngx_alloc|ngx_calloc|ngx_palloc)\b/i, release: /\b(free|curlx_free|zfree|ngx_free|ngx_pfree)\b/i, category: "memory" },
  // File descriptors
  { acquire: /\b(open|fopen|socket|accept|curlx_open)\b/i, release: /\b(close|fclose|closesocket|curlx_close|shutdown)\b/i, category: "file" },
  // SSL/TLS
  { acquire: /\b(SSL_new|TLS_new|wolfSSL_new|gtls_new|BIO_new|ossl_new|nghttp2_session_new)\b/i, release: /\b(SSL_free|TLS_free|wolfSSL_free|gtls_free|BIO_free|ossl_free|nghttp2_session_del)\b/i, category: "ssl" },
  // Connections
  { acquire: /\b(connect|Curl_connect|ngx_connect|redisConnect)\b/i, release: /\b(disconnect|Curl_disconnect|ngx_disconnect|redisFree)\b/i, category: "connection" },
  // Handles
  { acquire: /\b(init|create|setup|open|start|begin|acquire|lock)\b/i, release: /\b(cleanup|destroy|teardown|close|stop|end|release|unlock|free|done|finish)\b/i, category: "general" },
];

// ── Allocation-return patterns (functions that allocate and return to caller) ──

const ALLOCATOR_PATTERNS = [
  /\b(create|alloc|new|init|open|dup|clone|copy|build|make|setup|construct)\w*\b/i,
];

function isAllocatorFunction(funcName: string): boolean {
  return ALLOCATOR_PATTERNS.some(p => p.test(funcName));
}

// ── Detection ──

export interface ResourceViolation {
  type: "missing_release" | "double_release" | "use_after_release";
  category: string;
  acquireCall?: string;
  releaseCall?: string;
  detail: string;
}

export function detectResourceViolations(calls: string[]): ResourceViolation[] {
  const violations: ResourceViolation[] = [];

  for (const pair of RESOURCE_PAIRS) {
    const acquires: number[] = [];
    const releases: number[] = [];

    for (let i = 0; i < calls.length; i++) {
      const c = calls[i];
      if (pair.acquire.test(c) && !isAllocatorFunction(c)) acquires.push(i);
      if (pair.release.test(c)) releases.push(i);
    }

    // Rule 1: more acquires than releases → potential leak
    if (acquires.length > releases.length && acquires.length > 0) {
      // Check if this function itself is an allocator (returns resource to caller)
      // An allocator function should have at least one acquire and is expected
      // to NOT release — the caller will release
      const isAllocator = isAllocatorFunction(calls[0] || "");

      if (!isAllocator) {
        for (let i = releases.length; i < acquires.length; i++) {
          violations.push({
            type: "missing_release",
            category: pair.category,
            acquireCall: calls[acquires[i]],
            detail: `${calls[acquires[i]]} acquired without matching ${pair.release.source} — possible resource leak`,
          });
        }
      }
    }

    // Rule 2: release before any acquire → possible double-free or UAF
    if (releases.length > 0 && acquires.length === 0) {
      violations.push({
        type: "use_after_release",
        category: pair.category,
        releaseCall: calls[releases[0]],
        detail: `${calls[releases[0]]} called without prior acquire — possible double-free or use-after-release`,
      });
    }

    // Rule 3: release before corresponding acquire (interleaved)
    if (acquires.length > 0 && releases.length > 0) {
      for (const ri of releases) {
        // A release at position ri must have at least one acquire before it
        const hasPriorAcquire = acquires.some(ai => ai < ri);
        if (!hasPriorAcquire) {
          violations.push({
            type: "use_after_release",
            category: pair.category,
            releaseCall: calls[ri],
            detail: `${calls[ri]} called before any ${pair.acquire.source} — possible double-free`,
          });
        }
      }
    }
  }

  return violations;
}

/**
 * Validate a call sequence using resource lifecycle analysis.
 * Returns valid=true if no resource violations found.
 */
export function validateResourceLifecycle(calls: string[]): {
  valid: boolean;
  violations: ResourceViolation[];
  detail: string;
} {
  const violations = detectResourceViolations(calls);

  const missingCount = violations.filter(v => v.type === "missing_release").length;
  const otherCount = violations.length - missingCount;

  let detail = "";
  if (violations.length === 0) {
    detail = "Resource lifecycle clean";
  } else {
    const parts: string[] = [];
    if (missingCount > 0) parts.push(`${missingCount} potential resource leak(s)`);
    if (otherCount > 0) parts.push(`${otherCount} ordering violation(s)`);
    detail = parts.join(", ");
  }

  return {
    valid: violations.length === 0,
    violations,
    detail,
  };
}
