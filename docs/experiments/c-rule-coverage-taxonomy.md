# C Rule Coverage Taxonomy

**Date:** 2026-07-16
**Source:** P0 FN Root Cause Analysis + Experiment-017

## FN Distribution by Protocol Category

19 FNs from curl (7) + libssh (12) classified by what C protocol they exercise:

### curl (7 FN)

| Idx | Function | Category | Root Cause | Missing Pattern |
|-----|----------|----------|-----------|-----------------|
| 1 | mbed_configure_ssl | TLS Config | rule_missing | TLS init→config→connect chain not covered |
| 3 | myssh_statemachine | SSH State Machine | rule_missing | State machine transition guard |
| 16 | Curl_conn_connect | Connection Lifecycle | rule_missing | `connect` not in trigger verbs |
| 22 | schannel_connect_step2 | TLS/Schannel | parser_failed→recovered by Exp-017 | ✅ snake_case fixed |
| 27 | Curl_auth_decode_spnego_message | Auth/Negotiate | rule_missing | SPNEGO/NTLM decode missing auth cleanup |
| 71 | Curl_pin_peer_pubkey | Certificate Pinning | rule_missing | Pubkey pinning without cert validation |
| 85 | Curl_auth_create_ntlm_type1_message | Auth/NTLM | rule_missing | NTLM message creation without cleanup/free |

### libssh (12 FN)

| Idx | Function | Category | Root Cause | Missing Pattern |
|-----|----------|----------|-----------|-----------------|
| 0 | ecdh_kex_type_to_curve | Crypto/ECDH | rule_missing | Key exchange type→curve mapping |
| 12 | SSH_PACKET_CALLBACK | Packet Handling | rule_missing | Macro-defined callback (C macro pattern) |
| 14 | ssh_userauth_agent | Auth/Agent | rule_missing | Agent auth without verification |
| 15 | ssh_userauth_publickey_auto | Auth/PublicKey | rule_missing | Auto publickey auth chain |
| 19 | ecdh_build_k | Crypto/ECDH | rule_missing | ECDH key building (gcrypt) |
| 27 | ssh_exec_shell | Process | rule_logic_flawed | False safeguard match |
| 32 | ecdh_build_k | Crypto/ECDH | rule_missing | ECDH key building (mbedcrypto) |
| 36 | ssh_dh_set_parameters | Crypto/DH | rule_missing | DH parameter setting |
| 37 | derive_hybrid_secret | Crypto/Hybrid | rule_missing | Hybrid key derivation |
| 38 | ssh_agent_remove_identity | Auth/Agent | rule_missing | Agent identity removal |
| 39 | ssh_select | I/O Multiplexing | rule_logic_flawed | False safeguard match |
| 40 | curve25519_do_create_k | Crypto/Curve25519 | rule_missing | `create` not triggering correctly |

## Category Summary

```
Category              FN Count   %
─────────────────────────────────────
Crypto/Key Exchange     6       32%   ← Largest gap
Auth/Negotiate          5       26%
TLS/Schannel            2       11%
Connection Lifecycle    1        5%
State Machine           1        5%
Certificate Pinning     1        5%
Process/I/O             1        5%
Packet Handling         1        5%
Logic Flawed            2       11%   (not rule_missing)
─────────────────────────────────────
                       19      100%
```

## Rule Coverage Map

### 1. Crypto/Key Exchange (6 FN — highest priority)

Missing rule patterns:
- `ecdh_*`, `curve25519_*`, `ssh_dh_*` — key exchange functions
- No trigger covers "key derivation" or "key building" operations
- C naming: `ecdh_build_k`, `derive_hybrid_secret`, `ssh_dh_set_parameters`

Needed triggers:
- `\b(build|derive|generate|compute)\w*(key|secret|k|dh|ec)\b` — key/secret creation
- `\b(set)\w*(param|dh|key)\b` — parameter configuration

### 2. Auth/Negotiate (5 FN)

Missing rule patterns:
- `Curl_auth_*_message` — NTLM/SPNEGO auth message creation
- `ssh_userauth_*` — SSH userauth functions
- Auth message creation without cleanup/free verification

Needed triggers:
- `\b(auth)\w*(create|build|decode|encode)\w*\b` — auth message construction
- `\b(userauth)\w*\b` — user authentication operations

### 3. TLS/Schannel (2 FN)

- `mbed_configure_ssl` — TLS config without cert verification
- `schannel_connect_step2` — recovered by Exp-017 (snake_case)

Needed triggers:
- `\b(configure|setup)\w*(ssl|tls|schannel)\b` — TLS configuration
- Already partially covered by existing TLS rules, but `configure_ssl` pattern missed

### 4. Other (4 FN)

- Connection Lifecycle: `connect` not in trigger verbs
- State Machine: C state machine patterns (FALLTHROUGH, state transitions)
- Certificate Pinning: pubkey pinning without validation
- Packet Handling: Macro-defined callbacks (SSH_PACKET_CALLBACK)

## Development Order

Based on Experimental Evidence:

| Priority | Category | FN | Effort | Experiment | Result |
|----------|----------|----|--------|-----------|--------|
| 1 | Crypto/Key Exchange | 6 | Medium | Exp-018 | ✅ Category confirmed (3/6, 0 FP) |
| 2 | Auth/Negotiate | 5 | Medium | — | Pending |
| 3 | TLS/Schannel | 2 | Low | Exp-017 partial | 1 recovered via snake_case |
| 4 | Connection | 1 | Low | — | `connect` verb missing |
| 5 | State Machine | 1 | High | — | Complex control flow |
| 6 | Cert Pinning | 1 | Low | — | Pending |
| 7 | Packet Handling | 1 | High | — | Macro-based, IR limitation |

### Experiment-018: Crypto Category Result

- **Recovered**: 3/6 Crypto FNs (ecdh_build_k ×2, curve25519_do_create_k)
- **New FP**: 0
- **Remaining 3 FNs re-classification**:

| FN | Type | Root Cause |
|----|------|-----------|
| ecdh_kex_type_to_curve | Gold Semantic Mismatch | Function HAS EVP_PKEY_free + EC_KEY_get0_group. Violation is about something else. |
| ssh_dh_set_parameters | Gold Semantic Mismatch | Function HAS DH_free + BN_free. Violation is about something else. |
| derive_hybrid_secret | Context (per-file limit) | ssh_buffer_new without ssh_buffer_free, but file-level has ssh_string_free from another function. |

- **Effective Recovery**: 3/4 detectable FNs (75%)
- **Verdict**: Category CONFIRMED. Graduate to Production.

### Category Graduation Criteria

A category graduates to Production when:

1. ≥30% Recovery of target FNs in its category
2. FP ≈ 0 (no measurable Precision regression)
3. At least one cross-repo hit (not single-repo overfit)

After graduation, the category enters **Coverage Expansion** phase — broadening trigger/safeguard to capture remaining FNs, constrained by the same FP threshold.

## Revised FN Distribution (post Experiment-018)

```
19 FN total:
  rule_missing (recovered):      3  (16%)  ← Exp-018: ecdh_build_k×2, curve25519
  rule_missing (gold mismatch):  2  (11%)  ← Exp-018 identified: not rule issues
  rule_missing (pending):       10  (53%)  ← Auth, TLS, Connection, etc.
  rule_logic_flawed:             2  (11%)  ← false safeguard matches
  parser_failed:                 1  ( 5%)  ← Exp-017: schannel_connect_step2
  context (per-file limit):      1  ( 5%)  ← Exp-018: derive_hybrid_secret
```

## Note

This taxonomy is **current state**, not permanent. After Crypto and Auth rules are added, re-run the full benchmark to check if:
- Target FNs are recovered
- New FPs appear (rule too broad)
- Constraint shifts (e.g., Context becomes new bottleneck after Recall improves)
