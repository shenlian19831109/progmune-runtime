# Knowledge Base Full Changelog

## TLS Handshake (PROTO-TLS)

**Current:** v1.0.0 · stable · 85% confidence

| Version | Date | Confidence | Repos | Seqs | Notes |
|---------|------|------------|-------|------|-------|
| v0.1.0 | 2026-06-25 | 0% | 0 | 0 | SSG auto-discovery. 27 FP. |
| v0.5.0 | 2026-06-26 | 50% | 1 | 85 | Resource Lifecycle Detector. FP reduced to 8. |
| v1.0.0 | 2026-06-27 | 85% | 2 | 135 | Repo-agnostic patterns. Cross-project validated on nginx. |

## HTTP Request (PROTO-HTTP)

**Current:** v1.0.0 · stable · 80% confidence

| Version | Date | Confidence | Repos | Seqs | Notes |
|---------|------|------------|-------|------|-------|
| v0.5.0 | 2026-06-26 | 40% | 0 | 0 | Initial pattern definition. |
| v0.8.0 | 2026-06-26 | 70% | 1 | 50 | Validated on nginx HTTP module. |
| v1.0.0 | 2026-06-27 | 80% | 2 | 150 | PROMOTED TO STABLE. Extended patterns match Apache (ap_*) — 6/50 sequences matched. |

## SSH Connection (PROTO-SSH)

**Current:** v1.0.0 · stable · 78% confidence

| Version | Date | Confidence | Repos | Seqs | Notes |
|---------|------|------------|-------|------|-------|
| v0.3.0 | 2026-06-26 | 40% | 0 | 0 | Curl-specific (Curl_ssh_*). |
| v0.6.0 | 2026-06-26 | 60% | 1 | 85 | Repo-agnostic. myssh_* unmatched. |
| v1.0.0 | 2026-06-27 | 78% | 2 | 135 | PROMOTED TO STABLE. Validated on libssh standalone library (5/50 sequences matched). |

## Connection Lifecycle (PROTO-CONN)

**Current:** v0.5.0 · experimental · 55% confidence

| Version | Date | Confidence | Repos | Seqs | Notes |
|---------|------|------------|-------|------|-------|
| v0.5.0 | 2026-06-27 | 55% | 1 | 85 | Too broad. Needs refinement or narrower protocol scoping. |

## Authentication (PROTO-AUTH)

**Current:** v0.4.0 · experimental · 40% confidence

| Version | Date | Confidence | Repos | Seqs | Notes |
|---------|------|------------|-------|------|-------|
| v0.4.0 | 2026-06-27 | 40% | 0 | 0 | Awaiting first repo validation. |

## HTTP/2 Session (PROTO-H2)

**Current:** v0.8.0 · validated · 68% confidence

| Version | Date | Confidence | Repos | Seqs | Notes |
|---------|------|------------|-------|------|-------|
| v0.3.0 | 2026-06-26 | 35% | 0 | 0 | Pattern defined. Awaiting validation. |
| v0.8.0 | 2026-06-27 | 68% | 1 | 100 | PROMOTED TO VALIDATED. 13/50 sequences matched in nghttp2 reference library. |

## QUIC Connection (PROTO-QUIC)

**Current:** v0.2.0 · experimental · 25% confidence

| Version | Date | Confidence | Repos | Seqs | Notes |
|---------|------|------------|-------|------|-------|
| v0.2.0 | 2026-06-27 | 25% | 0 | 0 | Minimal pattern. Needs quiche library sequences. |

