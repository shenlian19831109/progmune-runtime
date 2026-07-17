# Experiment-017: Snake_case Trigger Lexical Normalization

**Date:** 2026-07-16

## Question

Does snake_case lexical normalization improve C protocol detection?

## Independent Variable

Trigger regex: `[A-Z]` → `(?:[A-Z]|_)` in all safeguard rule triggers.

- Before: `\b(create)[A-Z]\w*\b` → matches `createPost`, `CreateUser`
- After:  `\b(create)(?:[A-Z]|_)\w*\b` → also matches `create_post`, `create_user`

## Method

A/B test — only trigger regex changed. Safeguard patterns unchanged. Rules unchanged.

## Results

```
Baseline:    TP=19  FP=41  TN=53  FN=19  P=31.7%  R=50.0%  F1=38.8%
Experiment:  TP=20  FP=44  TN=50  FN=18  P=31.3%  R=52.6%  F1=39.2%
Δ:           +1    +3    -3    -1    -0.4pp   +2.6pp   +0.4pp
```

## Parser-Failed FN Recovery

| FN | Function | Recovered? |
|----|----------|-----------|
| [16] | Curl_conn_connect | ❌ |
| [22] | schannel_connect_step2 | ✅ |
| [27] | Curl_auth_decode_spnego_message | ❌ |
| [40] | curve25519_do_create_k | ❌ |
| [85] | Curl_auth_create_ntlm_type1_message | ❌ |

**Recovery: 1/5 (20%)**

## Key Insight

The experiment proved that **4/5 FNs classified as "parser_failed" in P0 analysis were actually "rule_missing"** — the verbs `connect`, `auth`, `decode` are not in the trigger verb list, regardless of snake_case support.

Revised FN root cause distribution:
- rule_missing: 16/19 (84%) — up from 63%
- parser_failed: 1/19 (5%) — down from 26%
- rule_logic_flawed: 2/19 (11%)

## New FPs

Snake_case support introduced 3 new FPs via "get_" matching the "Unauthenticated Access" trigger:
- `get_client_cert` (schannel.c)
- `schannel_connect_step1` (schannel.c)
- `hostip_resolv_start` (hostip.c)

## Decision

**Do not merge.** Net effect is negative (3 new FPs > 1 recovered FN). The real bottleneck remains Rule Coverage for C idioms.
