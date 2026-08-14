/**
 * Phase 1: Protocol Domain Validator
 *
 * Validates semantic sequences against known protocol domains.
 * REPLACES the old anomaly-detection approach ("deviation from norm = violation")
 * with domain-aware validation ("does this sequence follow valid protocol patterns?").
 *
 * Core principle: if a call sequence can be semantically mapped to a known
 * protocol domain, and the sequence follows sensible patterns for that domain,
 * it is CLEAN — regardless of whether the SSG has seen this exact pattern before.
 *
 * Architecture:
 *   SemanticSequence → Domain Grouping → Pattern Matching → Violation[]
 *   (empty violations = CLEAN)
 */

import type {
  SemanticSequence,
  SemanticStep,
  ProtocolDomain,
} from "./api-semantic-mapper";

// ═══════════════════════════════════════════════════════════════
// Domain Groups — Related domains that appear together in valid
// protocol implementations
// ═══════════════════════════════════════════════════════════════

/**
 * A domain group represents a coherent protocol subsystem.
 * Calls within the same group are expected to appear together.
 */
interface DomainGroup {
  name: string;
  description: string;
  domains: ProtocolDomain[];
  /** Whether this group represents a well-known protocol */
  isWellKnown: boolean;
}

const DOMAIN_GROUPS: DomainGroup[] = [
  {
    name: "TLS/SSL",
    description: "TLS 连接建立、证书验证、会话管理",
    domains: ["tls_config", "tls_handshake", "tls_cert", "tls_session", "tls_alpn"],
    isWellKnown: true,
  },
  {
    name: "Authentication",
    description: "用户认证、凭证管理、SASL/SSPI/GSSAPI 协商",
    domains: ["auth_cred", "auth_mech", "auth_hash", "auth_spn", "auth_gssapi"],
    isWellKnown: true,
  },
  {
    name: "LDAP",
    description: "LDAP 目录服务协议",
    domains: ["ldap_ops"],
    isWellKnown: true,
  },
  {
    name: "FTP",
    description: "FTP 文件传输协议",
    domains: ["ftp_ops"],
    isWellKnown: true,
  },
  {
    name: "SMTP",
    description: "SMTP 邮件传输协议",
    domains: ["smtp_ops"],
    isWellKnown: true,
  },
  {
    name: "IMAP",
    description: "IMAP 邮件访问协议",
    domains: ["imap_ops"],
    isWellKnown: true,
  },
  {
    name: "MQTT",
    description: "MQTT 物联网消息协议",
    domains: ["mqtt_ops"],
    isWellKnown: true,
  },
  {
    name: "SMB",
    description: "SMB 文件共享协议",
    domains: ["smb_ops"],
    isWellKnown: true,
  },
  {
    name: "SSH/SFTP",
    description: "SSH 安全外壳 + SFTP 文件传输",
    domains: ["ssh_ops"],
    isWellKnown: true,
  },
  {
    name: "Telnet",
    description: "Telnet 远程终端协议",
    domains: ["telnet_ops"],
    isWellKnown: true,
  },
  {
    name: "DNS/DoH",
    description: "DNS 解析 + DNS-over-HTTPS",
    domains: ["dns_ops"],
    isWellKnown: true,
  },
  {
    name: "HTTP",
    description: "HTTP/1.x 请求/响应处理",
    domains: ["http_ops"],
    isWellKnown: true,
  },
  {
    name: "HTTP/2",
    description: "HTTP/2 会话管理",
    domains: ["http2_ops"],
    isWellKnown: true,
  },
  {
    name: "Connection Management",
    description: "连接生命周期、轮询、事件循环",
    domains: ["conn_mgmt", "conn_poll"],
    isWellKnown: true,
  },
];

// Noise domains that appear in all protocol implementations
const NOISE_DOMAINS: ProtocolDomain[] = [
  "util", "mem_alloc", "mem_free", "mem_util",
  "str_util", "str_format", "buf_util", "net_util",
  "platform_util", "debug_trace", "error_handle",
];

// ═══════════════════════════════════════════════════════════════
// Compatibility Matrix — which groups can coexist in a valid seq
// ═══════════════════════════════════════════════════════════════

/**
 * Groups that commonly appear together in valid protocol implementations.
 * e.g., TLS + Auth together is normal (mutual TLS auth),
 * LDAP + Auth is normal (LDAP bind with SASL),
 * HTTP + TLS is normal (HTTPS).
 */
const COMPATIBLE_GROUPS: Record<string, string[]> = {
  "TLS/SSL": ["Authentication", "HTTP", "HTTP/2", "FTP", "SMTP", "IMAP", "LDAP", "SSH/SFTP", "Connection Management", "DNS/DoH"],
  "Authentication": ["TLS/SSL", "LDAP", "SSH/SFTP", "SMTP", "IMAP", "HTTP", "Connection Management"],
  "LDAP": ["TLS/SSL", "Authentication", "Connection Management"],
  "FTP": ["TLS/SSL", "Connection Management"],
  "SMTP": ["TLS/SSL", "Authentication", "Connection Management"],
  "IMAP": ["TLS/SSL", "Authentication", "HTTP", "Connection Management"],
  "MQTT": ["TLS/SSL", "Connection Management"],
  "SMB": ["Connection Management"],
  "SSH/SFTP": ["TLS/SSL", "Authentication", "Connection Management"],
  "Telnet": ["Connection Management"],
  "DNS/DoH": ["TLS/SSL", "HTTP", "Connection Management"],
  "HTTP": ["TLS/SSL", "Authentication", "HTTP/2", "IMAP", "SMTP", "Connection Management"],
  "HTTP/2": ["TLS/SSL", "HTTP", "Connection Management"],
  "Connection Management": ["TLS/SSL", "Authentication", "LDAP", "FTP", "SMTP", "IMAP", "MQTT", "SMB", "SSH/SFTP", "Telnet", "DNS/DoH", "HTTP", "HTTP/2"],
};

// ═══════════════════════════════════════════════════════════════
// Core Validation Logic
// ═══════════════════════════════════════════════════════════════

export interface DomainValidationResult {
  /** Is this sequence a valid protocol operation? */
  valid: boolean;
  /** The domain groups present in this sequence */
  groups: string[];
  /** If invalid, why */
  reason?: string;
  /** The primary protocol domain */
  primaryGroup: string | null;
}

/**
 * Classify a ProtocolDomain into its DomainGroup name.
 */
function classifyDomain(domain: ProtocolDomain): string | null {
  for (const group of DOMAIN_GROUPS) {
    if (group.domains.includes(domain)) {
      return group.name;
    }
  }
  return null;
}

/**
 * Check if two domain groups are compatible (can appear together in a valid sequence).
 */
function areGroupsCompatible(group1: string, group2: string): boolean {
  if (group1 === group2) return true;
  const compat = COMPATIBLE_GROUPS[group1];
  return compat ? compat.includes(group2) : false;
}

/**
 * Validate a semantic sequence against known protocol domains.
 *
 * Algorithm:
 *   1. Extract non-noise domains from the sequence
 *   2. Group consecutive domains into domain groups
 *   3. Check if all groups are mutually compatible
 *   4. If yes → CLEAN (valid protocol operation)
 *   5. If no → flag as potential cross-domain violation
 *
 * This is intentionally lenient — it only flags sequences that clearly
 * mix incompatible protocol domains without proper transitions.
 */
export function validateSemanticSequence(seq: SemanticSequence): DomainValidationResult {
  // Extract non-noise, non-util domains
  const significantDomains = seq.domains.filter(
    d => !NOISE_DOMAINS.includes(d) && d !== "util"
  );

  // If no significant domains → can't validate, assume clean
  if (significantDomains.length === 0) {
    return {
      valid: true,
      groups: [],
      primaryGroup: null,
    };
  }

  // Map to groups, deduplicate
  const groupSet = new Set<string>();
  for (const domain of significantDomains) {
    const group = classifyDomain(domain);
    if (group) groupSet.add(group);
  }

  const groups = [...groupSet];

  // Single group → always valid
  if (groups.length <= 1) {
    return {
      valid: true,
      groups,
      primaryGroup: groups[0] || null,
    };
  }

  // Multiple groups → check compatibility
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (!areGroupsCompatible(groups[i], groups[j])) {
        return {
          valid: false,
          groups,
          primaryGroup: groups[0],
          reason: `Incompatible protocol domains: ${groups[i]} and ${groups[j]} cannot appear together without proper transitions`,
        };
      }
    }
  }

  // All groups compatible → valid protocol operation
  return {
    valid: true,
    groups,
    primaryGroup: groups[0],
  };
}

/**
 * Check if a single specific violation pattern exists in a semantic sequence.
 *
 * These are concrete, specific checks — NOT anomaly detection.
 * Each check verifies a known protocol requirement.
 */
export interface SpecificViolationCheck {
  ruleId: string;
  description: string;
  check: (steps: SemanticStep[], filePath?: string) => boolean;
}

/**
 * Specific violation checks — these replace the old anomaly-based detection.
 * Each check verifies a concrete, well-defined protocol security requirement.
 *
 * Design principle: checks operate on semantic DOMAINS (not API names),
 * making them portable across all TLS/SSH/SASL implementations.
 *
 * Phase 3: TLS handshake actions are classified by type to distinguish
 * CTX management from actual handshake from status queries.
 */

// ── Phase 3: TLS Handshake Action Classification ──

/** Classify a TLS handshake step as actual execution vs CTX management vs query */
type TlsAction = "handshake_exec" | "ctx_init" | "status_query" | "other";

function classifyTlsAction(step: SemanticStep): TlsAction {
  const api = step.api.toLowerCase();

  // Actual handshake execution
  // Only unambiguously handshake-only operations.
  // "_connect(" as a function call (not "connection"), or explicit handshake calls.
  // cr_send/send excluded: can be post-handshake data transfer.
  if (
    (api.includes("_connect") && !api.includes("connection")) ||
    api.includes("_do_handshake") ||
    (api.includes("_handshake") && !api.includes("_is_handshaking"))
  ) {
    return "handshake_exec";
  }

  // CTX management (setup, not handshake)
  if (
    api.includes("_ctx_new") ||
    api.includes("_ctx_free") ||
    api.includes("_client_method") ||
    api.includes("_server_method") ||
    api.includes("_init_backend") ||
    api.includes("acquire_credential_handle") // Schannel cred acquisition
  ) {
    return "ctx_init";
  }

  // Status/info queries
  if (
    api.includes("_is_handshaking") ||
    api.includes("_get_version") ||
    api.includes("_get_peer_cert") ||
    api.includes("_get_ciphersuite") ||
    api.includes("_get_negotiated_") ||
    api.includes("_get_protocol_version")
  ) {
    return "status_query";
  }

  return "other";
}

export const SPECIFIC_VIOLATION_CHECKS: SpecificViolationCheck[] = [
  // ═══════════════════════════════════════════════════════
  // TLS-001: TLS handshake without certificate verification
  //
  // Phase 3: Only counts actual handshake execution steps
  // (connect, handshake), NOT CTX creation or status queries.
  // Excludes session reuse (cert was verified in original session).
  // ═══════════════════════════════════════════════════════
  {
    ruleId: "TLS_NO_CERT_VERIFY",
    description:
      "TLS handshake performed without certificate verification. " +
      "Server identity must be cryptographically verified to prevent MITM attacks.",
    check: (steps) => {
      // Phase 3: only count actual handshake execution
      const handshakeExecSteps = steps.filter(
        (s) =>
          s.domain === "tls_handshake" &&
          classifyTlsAction(s) === "handshake_exec"
      );
      const hasActualHandshake = handshakeExecSteps.length >= 1;
      const hasCertVerify = steps.some((s) => s.domain === "tls_cert");
      const hasSessionReuse = steps.some(
        (s) =>
          s.domain === "tls_session" ||
          s.api.toLowerCase().includes("scache") ||
          s.api.toLowerCase().includes("session_reuse") ||
          s.api.toLowerCase().includes("session_set_data") ||
          s.api.toLowerCase().includes("session_resume")
      );

      return hasActualHandshake && !hasCertVerify && !hasSessionReuse;
    },
  },

  // ═══════════════════════════════════════════════════════
  // AUTH-001: Plaintext auth credentials in network context
  //
  // Only triggers when auth data is being actively prepared AND
  // network transmission is occurring without TLS protection.
  // ═══════════════════════════════════════════════════════
  {
    ruleId: "PLAINTEXT_AUTH_WITHOUT_TLS",
    description:
      "Authentication credentials transmitted without TLS protection. " +
      "SASL PLAIN, LOGIN, or credential data must be sent over an encrypted channel.",
    check: (steps) => {
      // Auth data being prepared (credentials + mechanism)
      const hasAuthCred = steps.some((s) => s.domain === "auth_cred");
      const hasAuthCreate = steps.some(
        (s) =>
          s.domain === "auth_mech" &&
          (s.api.toLowerCase().includes("create") ||
            s.api.toLowerCase().includes("build") ||
            s.api.toLowerCase().includes("encode"))
      );
      // Network activity — data being sent or connection being used
      const hasNetworkTx = steps.some(
        (s) =>
          s.domain === "conn_mgmt" &&
          (s.api.toLowerCase().includes("send") ||
            s.api.toLowerCase().includes("flush") ||
            s.api.toLowerCase().includes("connect") ||
            s.api.toLowerCase().includes("write") ||
            s.api.toLowerCase().includes("perform") ||
            s.api.toLowerCase().includes("get_current_host"))
      );
      // TLS protection present
      const hasTls = steps.some(
        (s) =>
          s.domain === "tls_handshake" ||
          s.domain === "tls_cert" ||
          s.domain === "tls_session" ||
          (s.domain === "tls_config" &&
            (s.api.toLowerCase().includes("is_ssl") ||
              s.api.toLowerCase().includes("ssl_cf")))
      );
      // Only flag if auth is being actively created for network transmission
      return (hasAuthCred || hasAuthCreate) && hasNetworkTx && !hasTls;
    },
  },

  // ═══════════════════════════════════════════════════════
  // SSH-001: SSH auth without host key verification
  //
  // Looks for SSH auth operations that lack host key checking.
  // The SSH domain itself contains auth state machines; we check
  // that hostkey-related steps appear before auth steps.
  // ═══════════════════════════════════════════════════════
  {
    ruleId: "SSH_NO_HOST_KEY_CHECK",
    description:
      "SSH authentication proceeds without host key verification. " +
      "The server's host key must be verified before sending credentials.",
    check: (steps) => {
      const sshSteps = steps.filter((s) => s.domain === "ssh_ops");
      // Require substantial SSH activity (not just internal helpers)
      if (sshSteps.length < 4) return false;

      const hasHostKey = sshSteps.some(
        (s) =>
          s.api.toLowerCase().includes("hostkey") ||
          s.api.toLowerCase().includes("host_key") ||
          s.api.toLowerCase().includes("known_host")
      );
      // Only flag if explicit auth operations AND user credential usage
      const hasAuth = sshSteps.some(
        (s) =>
          (s.api.toLowerCase().includes("userauth") ||
            s.api.toLowerCase().includes("auth_pass") ||
            s.api.toLowerCase().includes("auth_pkey") ||
            s.api.toLowerCase().includes("auth_key")) &&
          !s.api.toLowerCase().includes("authlist")
      );
      // Also require credential operations (not just internal SSH protocol)
      const hasCreds = steps.some(
        (s) =>
          s.domain === "auth_cred" ||
          s.api.toLowerCase().includes("password") ||
          s.api.toLowerCase().includes("credential")
      );

      return hasAuth && hasCreds && !hasHostKey;
    },
  },

  // ═══════════════════════════════════════════════════════
  // TLS-002: OCSP response parsed without verification
  // ═══════════════════════════════════════════════════════
  {
    ruleId: "OCSP_UNVERIFIED_RESPONSE",
    description:
      "OCSP stapling response is parsed but the verification result is not checked. " +
      "An unverified OCSP response provides no certificate revocation protection.",
    check: (steps) => {
      const hasOcspParse = steps.some(
        (s) =>
          s.api.toLowerCase().includes("ocsp_response_status") ||
          s.api.toLowerCase().includes("ocsp_response_get")
      );
      const hasOcspVerify = steps.some(
        (s) =>
          s.api.toLowerCase().includes("ocsp_basic_verify") ||
          s.api.toLowerCase().includes("ocsp_check")
      );
      return hasOcspParse && !hasOcspVerify;
    },
  },

  // ═══════════════════════════════════════════════════════
  // AUTH-002: SRP authentication (legacy PAKE)
  // ═══════════════════════════════════════════════════════
  {
    ruleId: "AUTH_SRP_USAGE",
    description:
      "SRP (Secure Remote Password) authentication detected. " +
      "SRP is a legacy PAKE with known limitations. Prefer modern alternatives.",
    check: (steps) => {
      return steps.some(
        (s) =>
          s.api.toLowerCase().includes("srp_") &&
          (s.domain === "auth_cred" || s.domain === "auth_mech")
      );
    },
  },

  // ═══════════════════════════════════════════════════════
  // TLS-003: Security verification result not consumed
  //
  // Detects when a security verification function is called
  // (OCSP_basic_verify, SSL_get_verify_result, X509_verify_cert)
  // but the result is not checked before proceeding.
  // ═══════════════════════════════════════════════════════
  {
    ruleId: "SECURITY_RESULT_NOT_CHECKED",
    description:
      "Security verification result may not be checked. " +
      "A verification function was called but no subsequent " +
      "status check or conditional guard was detected.",
    check: (steps) => {
      const verifyApis = [
        "ocsp_basic_verify",
        "ssl_get_verify_result",
        "x509_verify_cert",
        "cert_verify",
      ];

      // Find verification calls
      const verifyIndices: number[] = [];
      steps.forEach((s, i) => {
        if (
          s.domain === "tls_cert" &&
          verifyApis.some((v) => s.api.toLowerCase().includes(v))
        ) {
          verifyIndices.push(i);
        }
      });

      if (verifyIndices.length === 0) return false;

      // For the last verify call, check if subsequent steps
      // include error handling or status checks
      const lastVerifyIdx = verifyIndices[verifyIndices.length - 1];
      const subsequentSteps = steps.slice(lastVerifyIdx + 1);

      // Look for: error string functions, status checks, conditional guards
      const hasResultCheck = subsequentSteps.some(
        (s) =>
          s.domain === "error_handle" ||
          s.api.toLowerCase().includes("status") ||
          s.api.toLowerCase().includes("strerror") ||
          s.api.toLowerCase().includes("get_error") ||
          s.api.toLowerCase().includes("_ok") ||
          s.api.toLowerCase().includes("_err")
      );

      // If verify is called and the NEXT step immediately uses the
      // result of what was verified (e.g., gets peer cert after OCSP verify
      // without checking verify result), it's suspicious
      const immediateUse = subsequentSteps.length > 0 &&
        subsequentSteps[0].domain === "tls_cert" &&
        !hasResultCheck;

      return immediateUse;
    },
  },

  // ═══════════════════════════════════════════════════════
  // SSH-002: SSH host key retrieved but not verified
  //
  // Detects when an SSH host key is obtained (ssh_state_hostkey,
  // ssh_get_publickey_hash) but no known_hosts comparison follows.
  // ═══════════════════════════════════════════════════════
  {
    ruleId: "SSH_HOST_KEY_NOT_VERIFIED",
    description:
      "SSH host key retrieved but verification against known_hosts " +
      "may be insufficient. Host key must be cryptographically verified.",
    check: (steps) => {
      // Check if hostkey-related step exists
      const hostKeyIdx = steps.findIndex(
        (s) =>
          s.domain === "ssh_ops" &&
          (s.api.toLowerCase().includes("hostkey") ||
            s.api.toLowerCase().includes("host_key"))
      );
      if (hostKeyIdx < 0) return false;

      // Check if a verification/comparison step follows
      const afterHostKey = steps.slice(hostKeyIdx + 1);
      const hasVerify = afterHostKey.some(
        (s) =>
          s.api.toLowerCase().includes("verify") ||
          s.api.toLowerCase().includes("check") ||
          s.api.toLowerCase().includes("match") ||
          s.api.toLowerCase().includes("compare") ||
          s.api.toLowerCase().includes("known_host") ||
          s.api.toLowerCase().includes("fingerprint")
      );

      // Host key present but no verification detected
      return !hasVerify;
    },
  },

  // ═══════════════════════════════════════════════════════
  // TLS-004: SSL connection established but no cert verify visible
  //
  // Phase 4: Cross-function inference. When an SSL connection is
  // clearly being made (conn_is_ssl + do_connect/perform) but no
  // certificate verification is visible in the same function window,
  // this is suspicious. The verification might be in a callback,
  // but we can't confirm from this window alone.
  // Severity: LOW (cross-function uncertainty).
  // ═══════════════════════════════════════════════════════
  {
    ruleId: "TLS_INFERRED_NO_CERT_VERIFY",
    description:
      "SSL connection established but certificate verification " +
      "not visible in this function window. Verify that cert validation " +
      "is configured in the TLS backend callback or calling function.",
    check: (steps) => {
      // SSL is explicitly confirmed (conn_is_ssl or SSL filter/layer operations)
      const hasSslConfirmed = steps.some(
        (s) =>
          s.api.toLowerCase().includes("conn_is_ssl") ||
          s.api === "do_connect" ||
          (s.domain === "tls_config" &&
            /ssl|tls/i.test(s.api) &&
            !s.api.toLowerCase().includes("close_all")) // closing all SSL is cleanup, not active use
      );
      // Connection is being established (but NOT "connection" which is a noun)
      const hasConnect = steps.some(
        (s) =>
          (s.domain === "conn_mgmt" || s.api === "do_connect") &&
          (/(?<!n)connect(?!i)/i.test(s.api) ||  // "connect" not in "connection"
            s.api.toLowerCase().includes("perform") ||
            s.api === "do_connect")
      );
      // No cert verification visible in this window
      const hasCertVerify = steps.some((s) => s.domain === "tls_cert");
      // No session reuse
      const hasSessionReuse = steps.some(
        (s) =>
          s.domain === "tls_session" ||
          s.api.toLowerCase().includes("scache") ||
          s.api.toLowerCase().includes("session_")
      );
      // Phase 5: SSL filter explicitly added — cert verification is
      // handled inside the filter during connect. Don't flag.
      const hasSslFilterSetup = steps.some(
        (s) =>
          s.api.toLowerCase().includes("ssl_cfilter") ||
          s.api.toLowerCase().includes("ssl_filter_add") ||
          s.api.toLowerCase().includes("ssl_setup")
      );

      return hasSslConfirmed && hasConnect &&
        !hasCertVerify && !hasSessionReuse && !hasSslFilterSetup;
    },
  },

  // ═══════════════════════════════════════════════════════
  // TLS-005: TLS handshake without hostname verification
  //
  // CVE-2024-2466 pattern: mbedtls_ssl_set_hostname() only called
  // when SNI is set → connecting by IP address skips hostname check.
  // Also covers similar patterns in OpenSSL (SSL_set_tlsext_host_name),
  // GnuTLS (gnutls_server_name_set), wolfSSL (wolfSSL_CTX_set_verify),
  // and Rustls (cr_set_negotiated_alpn with hostname).
  // ═══════════════════════════════════════════════════════
  {
    ruleId: "TLS_NO_HOSTNAME_VERIFY",
    description:
      "TLS handshake performed without hostname verification. " +
      "Without hostname verification, an attacker can present a valid " +
      "certificate for a different hostname (CVE-2024-2466 pattern).",
    check: (steps) => {
      const hasTlsHandshake = steps.some(
        (s) => s.domain === "tls_handshake" &&
          classifyTlsAction(s) === "handshake_exec"
      );
      // Hostname/SNI verification functions across TLS backends
      const hasHostnameSet = steps.some(
        (s) =>
          s.api.toLowerCase().includes("ssl_set_hostname") ||      // mbedTLS
          s.api.toLowerCase().includes("set_tlsext_host_name") ||  // OpenSSL
          s.api.toLowerCase().includes("server_name_set") ||       // GnuTLS
          s.api.toLowerCase().includes("ctx_set_verify") ||        // wolfSSL
          s.api.toLowerCase().includes("set_hostname") ||          // Generic
          s.api.toLowerCase().includes("sni_")                     // SNI
      );
      // Exclude session reuse / early data / proxy context
      // (hostname was verified when session was established or by proxy)
      const hasPriorContext = steps.some(
        (s) =>
          s.domain === "tls_session" ||
          s.api.toLowerCase().includes("scache") ||
          s.api.toLowerCase().includes("session_") ||
          s.api.toLowerCase().includes("earlydata") ||     // TLS 1.3 early data
          s.api.toLowerCase().includes("ssl_cf_is_proxy")  // proxy handles hostname
      );

      return hasTlsHandshake && !hasHostnameSet && !hasPriorContext;
    },
  },

  // ═══════════════════════════════════════════════════════
  // CRYPTO-001: DH parameters/key not validated
  //
  // libssh FN #36/#41 pattern: Diffie-Hellman parameters generated
  // or key exchanged without validation. Small subgroup attacks
  // (CVE-2016-0701, CVE-2015-4000 LOGJAM) can downgrade or break DH.
  // Must call DH_check/DH_check_pub_key after parameter setup,
  // and check DH_compute_key result for 0 or 1.
  // ═══════════════════════════════════════════════════════
  {
    ruleId: "DH_UNVALIDATED_PARAMETERS",
    description:
      "DH key exchange performed without parameter validation. " +
      "Unvalidated DH parameters are vulnerable to small subgroup " +
      "attacks (LOGJAM CVE-2015-4000, CVE-2016-0701).",
    check: (steps) => {
      // SSH wrappers handle DH internally — but only suppress if
      // no raw OpenSSL DH operations are also present (mixed = suspicious)
      const hasRawDh = steps.some(s =>
        s.api.toLowerCase().includes("dh_set0") ||
        s.api.toLowerCase().includes("dh_new") ||
        s.api.toLowerCase().includes("dh_compute") ||
        s.api.toLowerCase().includes("derive_init")
      );
      const wrappedBySsh = steps.some(s =>
        s.api.toLowerCase().includes("dh_init") ||
        s.api.toLowerCase().includes("ssh_dh_keypair")
      );
      // Mixed: SSH wrapper + raw DH ops → still need to check
      if (wrappedBySsh && !hasRawDh) return false;

      const hasDhParams = steps.some(s =>
        s.api.toLowerCase().includes("dh_set0") ||
        s.api.toLowerCase().includes("dh_new") ||
        (s.domain === "auth_hash" && s.api.toLowerCase().includes("dh_"))
      );
      const hasDhCompute = steps.some(s =>
        s.api.toLowerCase().includes("dh_compute") ||
        s.api.toLowerCase().includes("derive_init")
      );
      const hasDhCheck = steps.some(s =>
        s.api.toLowerCase().includes("dh_check") ||
        s.api.toLowerCase().includes("bn_is_zero") ||
        s.api.toLowerCase().includes("bn_is_one") ||
        s.api.toLowerCase().includes("bn_cmp") ||
        s.api.toLowerCase().includes("dh_param") ||
        s.api.toLowerCase().includes("dh_debug")
      );
      return (hasDhParams || hasDhCompute) && !hasDhCheck;
    },
  },

  // ═══════════════════════════════════════════════════════
  // AUTH-003: JWT verification without explicit algorithm
  //
  // CVE-2022-23540 pattern: jwt.verify() called without algorithms
  // option → library defaults to "none" → accepts unsigned tokens.
  // Also catches jwt.decode() without verify=true (PyJWT pattern).
  // Severity: HIGH — can lead to complete authentication bypass.
  // ═══════════════════════════════════════════════════════
  {
    ruleId: "JWT_UNSAFE_ALGORITHM",
    description:
      "JWT verification may not specify required algorithms. " +
      "Without explicit algorithm whitelist, the 'none' algorithm " +
      "can be exploited to accept unsigned tokens (CVE-2022-23540).",
    check: (steps, filePath) => {
      // JWT verification functions being used
      const hasJwtVerify = steps.some(
        (s) =>
          (s.api === "jwt.verify" ||
            s.api === "verify" ||
            s.api.includes("jwt_verify") ||
            s.api.includes("jwtVerify") ||
            s.api.includes("verifyToken")) &&
          (s.domain === "auth_mech" || s.domain === "auth_cred")
      );
      // Unsafe: jwt.decode without verify (PyJWT pattern)
      const hasJwtDecode = steps.some(
        (s) =>
          (s.api === "jwt.decode" || s.api.includes("jwt_decode")) &&
          !steps.some((t) => t.api.includes("verify"))
      );
      if (!hasJwtVerify && !hasJwtDecode) return false;

      // Algorithm explicitly specified as a call name (rare, but possible)
      const hasAlgorithmSpec = steps.some(
        (s) =>
          s.api.toLowerCase().includes("algorithm") ||
          s.api.toLowerCase().includes("alg") ||
          s.api.toLowerCase().includes("hs256") ||
          s.api.toLowerCase().includes("rs256") ||
          s.api.toLowerCase().includes("es256") ||
          s.api.toLowerCase().includes("eddsa")
      );
      if (hasAlgorithmSpec) return false;

      // File-aware check: the `algorithms: ["HS256"]` option is an object
      // literal argument, invisible to call-name analysis. Read the source
      // and verify every jwtVerify/jwt.verify call site has the option nearby.
      if (filePath) {
        try {
          const fs = require("fs");
          const code = fs.readFileSync(filePath, "utf-8");
          const verifyRe = /\b(?:jwtVerify|jwt\.verify|verifyToken|jwt_decode|jwt\.decode)\s*\(/g;
          let found = false;
          let allSafe = true;
          let m: RegExpExecArray | null;
          while ((m = verifyRe.exec(code)) !== null) {
            found = true;
            // Look at the call's argument window for an algorithms whitelist
            const window = code.slice(m.index, Math.min(m.index + 400, code.length));
            if (!/algorithms\s*:/.test(window)) {
              allSafe = false;
              break;
            }
          }
          if (found && allSafe) return false; // every call site whitelists algorithms
          if (found && !allSafe) return true; // at least one site lacks the whitelist
          // No verify call sites found in file text → fall through to name-based
        } catch {
          // File unreadable → fall through to name-based heuristic
        }
      }

      return true;
    },
  },

  // ═══════════════════════════════════════════════════════
  // QUIC-001: Active migration disabled
  // ═══════════════════════════════════════════════════════
  {
    ruleId: "QUIC_DISABLE_ACTIVE_MIGRATION",
    description:
      "QUIC connection migration is disabled. This may impact privacy " +
      "and connection resilience. Review if this is intentional.",
    check: (steps) => {
      return steps.some((s) =>
        s.api.toLowerCase().includes("disable_active_migration")
      );
    },
  },
];

/**
 * Run specific violation checks against a semantic sequence.
 * Returns violations found (empty for Phase 1 MVP).
 */
export function checkSpecificViolations(
  seq: SemanticSequence,
  _filePath?: string
): Array<{
  ruleId: string;
  description: string;
  evidence: string;
}> {
  const violations: Array<{
    ruleId: string;
    description: string;
    evidence: string;
  }> = [];

  for (const check of SPECIFIC_VIOLATION_CHECKS) {
    if (check.check(seq.steps, _filePath)) {
      violations.push({
        ruleId: check.ruleId,
        description: check.description,
        evidence: seq.steps.map(s => `${s.api}[${s.domain}]`).join(" → "),
      });
    }
  }

  return violations;
}

// ═══════════════════════════════════════════════════════════════
// Batch Validation — used by Trust Engine
// ═══════════════════════════════════════════════════════════════

export interface BatchValidationResult {
  /** Total sequences checked */
  total: number;
  /** Sequences validated as clean protocol operations */
  clean: number;
  /** Sequences that couldn't be mapped to any known domain */
  unknown: number;
  /** Sequences flagged as potential violations */
  flagged: number;
  /** Detailed results per sequence */
  details: Array<{
    sequence: string[];
    semanticSteps: SemanticStep[];
    validation: DomainValidationResult;
  }>;
}

/**
 * Batch validate multiple call sequences.
 * This is the main entry point for the Trust Engine integration.
 */
export function batchValidateSequences(
  sequences: Array<{ calls: string[]; file?: string; function?: string }>,
  mapSequence: (calls: string[]) => SemanticSequence
): BatchValidationResult {
  const result: BatchValidationResult = {
    total: sequences.length,
    clean: 0,
    unknown: 0,
    flagged: 0,
    details: [],
  };

  for (const seq of sequences) {
    const semantic = mapSequence(seq.calls);
    const validation = validateSemanticSequence(semantic);

    result.details.push({
      sequence: seq.calls,
      semanticSteps: semantic.steps,
      validation,
    });

    if (validation.valid && validation.primaryGroup !== null) {
      result.clean++;
    } else if (validation.primaryGroup === null) {
      result.unknown++;
    } else {
      result.flagged++;
    }
  }

  return result;
}
