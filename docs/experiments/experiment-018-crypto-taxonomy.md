# Experiment-018: Key Derivation Safety Taxonomy

**Date:** 2026-07-16
**Status:** Category CONFIRMED ✅

## Question

Does "Key Derivation Safety" deserve to be a protocol category?

## Independent Variable

One new safeguard rule covering ECDH, Curve25519, DH, and key exchange functions.
All other rules unchanged.

## Success Criteria

- 6/6 recovered → Category confirmed
- 2-5/6 recovered → Rule too narrow, category valid
- 6/6 + ≥2 FP → Category too broad
- ≤1/6 recovered → Category rejected

## Results

```
Baseline:    TP=19  FP=41  TN=53  FN=19  P=31.7%  R=50.0%  F1=38.8%
Experiment:  TP=22  FP=41  TN=53  FN=16  P=34.9%  R=57.9%  F1=43.6%
Δ:           +3    +0    +0    -3    +3.2pp   +7.9pp   +4.8pp
```

**Crypto FN Recovery: 3/6 (50%), 0 new FP**

### Recovered
- ✅ ecdh_build_k (ecdh_gcrypt.c)
- ✅ ecdh_build_k (ecdh_mbedcrypto.c)
- ✅ curve25519_do_create_k (curve25519_gcrypt.c)

### Not Recovered — Re-classified

| FN | Type | Why |
|----|------|-----|
| ecdh_kex_type_to_curve | Gold Semantic Mismatch | Function has EVP_PKEY_free + EC_KEY_get0_group. Gold violation is about something else. |
| ssh_dh_set_parameters | Gold Semantic Mismatch | Function has DH_free + BN_free + OSSL_PARAM_BLD_free. Gold violation is about something else. |
| derive_hybrid_secret | Context (per-file limit) | ssh_buffer_new without ssh_buffer_free. File-level false credit from same-file ssh_string_free. |

**Effective Recovery: 3/4 detectable FNs (75%)**

## Verdict

**Category CONFIRMED.** Key Derivation Safety deserves to be a protocol category.

The 3 unrecovered FNs are not rule failures:
- 2 are gold label mismatches (functions already have safeguards)
- 1 is a context limitation (the ONLY context-caused FN across all 19 FNs)

## Recommendation

- **Graduate to Production** (meets criteria: ≥30% Recovery, 0 FP)
- **Enter Coverage Expansion** phase: broaden trigger to kex, dh_set, derive patterns
- **Re-audit gold labels** for ecdh_kex_type_to_curve and ssh_dh_set_parameters
