# C Protocol Coverage Dashboard v2

**Benchmark:** Gold v1 (curl + libssh) — 19 total FN

## Overall

| Status | Count |
|--------|-------|
| ✅ Recovered | 7 |
| ⬡ Regex Saturated | 5 |
| ~ Gold Mismatch | 3 |
| ❌ Remaining | 2 |
| **Regex-Friendly Coverage** | **100%** |

## Capability Map

| Mechanism | Categories | FN | Recovered |
|-----------|------------|----|-----------|
| ≡ Regex-Friendly | crypto_key_exchange, connection_lifecycle, certificate_pinning, safeguard_logic | 5 | 5 |
| ≢ Regex-Hostile | auth_message_lifecycle, state_machine, tls_config, packet_macro | 9 | 1 |

## Categories

| Mechanism | Status | Category | Coverage |
|-----------|--------|----------|----------|
| ≡ | graduated | Key Derivation Safety | 75% (3/6) |
| ≢ | regex_saturated | Auth Message Lifecycle | 0% (0/5) |
| ≢ | partial | TLS Configuration Safety | 50% (1/2) |
| ≡ | gold_mismatch | Connection Lifecycle Safety | 0% (0/1) |
| ≢ | pending | State Machine Transitions | 0% (0/1) |
| ≡ | graduated | Certificate Pinning Validation | 100% (1/1) |
| ≡ | graduated | Safeguard Logic (False Match) | 100% (2/2) |
| ≢ | deferred | Macro-Defined Callbacks | 0% (0/1) |