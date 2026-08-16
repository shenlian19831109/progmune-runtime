# Real-World Application Validation v1 — PyGoat Gold Annotation

**Date:** 2026-08-16
**Corpus:** PyGoat (OWASP vulnerable-by-design Django app, shallow clone)
**Artifact:** `gold/annotations-pygoat-v1.json` (per-detection verdicts, human review)
**Pipeline:** `scan-real-python.ts --dir benchmarks/python-apps PyGoat` → `annotate-pygoat.py`

## Headline

First gold annotation of the detector on real application code. **183 detections on
167 functions: 15 true positives, 11 false positives, 157 unlabeled. Labeled precision
57.7%.** Among the authorization rules specifically (the product's core surface):
**9 TP / 5 FP = 64.3% precision**, and all 9 TPs land on PyGoat's deliberately
vulnerable lab views — the detector correctly finds broken-access-control labs.

## Verified true positives (15)

| Finding | Rule | What it caught |
|---------|------|----------------|
| insec_des_lab | Unauthenticated Mutation | `pickle.loads()` on a user cookie — insecure deserialization |
| xxe_parse | Unauthenticated Mutation | External entities enabled + `parseString(request.body)` — XXE |
| ba_lab / a1_broken_access_lab_1 | Unauthenticated Mutation | Cookie-based admin check (`COOKIES.get('admin')=='1'`) |
| Otp | Unauthenticated Mutation | OTP rendered into client HTML |
| crypto_failure_lab3 | Unauthenticated Mutation | Client-side cookie tampering (`split('|')` expiry) |
| auth_failure_lab3 | Unauthenticated Mutation | Session-id cookie trusted directly |
| sec_misconfig_lab3 | Unauthenticated Mutation | JWT decoded with a hardcoded key |
| get_version | Unauthenticated Access | Unauthenticated version disclosure (the A9 lab) |
| auth_lab_signup, broken_auth register | Password Hashing ×2 rules | Plaintext password storage |
| auth_lab_login, broken_auth login | Token Security | `userid` cookie (samesite=None, secure=False) / base64(username:timestamp) token |

## Verified false positives (11) — the framework-delegation class

| Finding | Why wrong |
|---------|-----------|
| introduction register (3 rules) | `NewUserForm.save()` — Django hashes pbkdf2 by default |
| register_view (2 rules) | `User.objects.create_user()` hashes |
| login_view | Django `authenticate()`/`login()` manage sessions securely |
| a9_lab2, DoItFast.post | Both check `request.user.is_authenticated` and redirect |
| login_otp | Only renders a page — no token generated |
| auth_lab_logout | `delete_cookie('userid')` IS invalidation for this lab's auth |
| reset_form | The token check IS the authentication |
| reset_password | Real flaw is the predictable md5 token — not "no rotation after privilege change" |

**Pattern:** Django's framework delegation (forms/`create_user`/`login`) is invisible to
the call-name interface — the detector cannot see that the called framework function
hashes/sessions securely.

## Unlabeled (157) — soft classes

`No Input Sanitization` (124) dominates: every Django view calls `render()`, which
auto-escapes by default; the rule cannot see templates (the actual XSS labs are
vulnerable via `|safe` in the template, invisible to this interface). Context-manager
hygiene, audit-trail absence, session-TTL, registration verification — true-ish but soft.

## Recall side (what was missed)

PyGoat ships ~30 labs across OWASP classes. The rule set surfaces 10 broken-auth/access
labs. **Missed classes:** SQLi (sql_lab uses ORM raw without `execute` call names),
XSS (template-level), SSTI, SSRF, command injection, XXE-as-injection. These are outside
the protocol-lifecycle rule set by product positioning — a full recall number requires
lab-level gold enumeration, noted as future work.

## Framework-delegation allowlist (implemented, 2026-08-16)

The extractor now emits **qualified call chains** (`user.change_password`,
`User.objects.create_user`) instead of bare attr names, and the auth/password/token
rules accept qualified framework calls as safeguard satisfiers — a bare custom
`create_user` is NOT treated as secure, per the granularity requirement. Also: DI
authorizer names (`get_current_user_authorizer`, `login_required`…), token-layer
functions (`create_access_token`, `create_jwt_token`), password machinery
(`generate_salt`, `get_password_hash`), `delete_cookie`, template-tag registration
excludes. Bare `jwt.encode` is deliberately NOT allowlisted — a hardcoded secret key
makes the JWT layer itself the vulnerability (PyGoat sec_misconfig_lab3; caught after
an initial over-broad version suppressed it and was reverted).

### Result

| Repo | FP before | FP after |
|------|-----------|----------|
| fastapi-realworld | 34 | **4** |
| django-realworld | 14 | 11 (DRF `permission_classes` class attributes — irreducible at this interface) |
| django-unicorn | 4 | 5 (net +1: qualified-chain change surfaced new framework-internal firings) |
| PyGoat | 11 | 8 — **all 15+2 TPs preserved** |

**Cross-corpus: TP 17 / FP 28, labeled precision 37.8% (was 19.2%); auth rules
9 TP / 19 FP = 32.1%.** Both synthetic benchmarks unchanged (TS 98.5%/99.1%,
Python 100%/100%). Side benefit: the qualified-chain extractor activated two
previously-silent vulnerability rules — Command Injection catches PyGoat's cmd_lab,
Unsafe Deserialization catches the pickle labs.

## App-corpus recall measurement (2026-08-16)

PyGoat's 72 lab views enumerated from code and scored per class. Two metrics:

- **Any-rule fires: 100%** — every lab view gets some flag (mostly the soft
  No Input Sanitization). Misleading on its own.
- **Class-correct detection: 18/72 = 25%** — a fired rule whose claim corresponds
  to the lab's actual vulnerability class. This is the honest recall number.

| Class | Class-correct recall | Note |
|-------|---------------------|------|
| A2 Broken Auth | **9/11 (82%)** | the rule set's strength |
| A8 Insecure Deserialization | 2/3 | newly active Unsafe Deserialization rule |
| A9 Logging/Monitoring | 2/3 | via Authorization (get_version/a9_lab2) |
| A1 Command Injection | 1/2 | newly active Command Injection rule |
| A5 Broken Access | 2/5 | cookie-bypass labs caught; a1_2/3 flagged wrong-class |
| A2 Crypto / A6 Misconfig | 1/2, 1/3 | partial |
| **A1 SQLi (0/2), A1 SSTI (0/1), A10 SSRF (0/4), A3 DataExp (0/3), A4 XXE (0/2), A7 XSS (0/3), MITRE (0/28)** | **0%** | no rule class exists for these |

**Strategic conclusion:** precision-side work (param-gate, allowlist) is done to the
point of diminishing returns — remaining FPs are documented interface boundaries.
The binding constraint is now **coverage**: the rule set has zero class coverage for
SQLi / XSS / SSTI / SSRF / XXE / data-exposure, which is consistent with the
protocol-lifecycle positioning but quantifies exactly what a coverage expansion
would need to add. Every one of these classes requires interface upgrades beyond
call names (SQL needs source-level f-string/format analysis; XSS needs template
rendering; SSRF needs URL-flow) — they are new-rule projects, not pattern tweaks.

## Next steps

1. Remaining FP classes (documented, tier-2): unqualified-import framework calls,
   DRF class-attribute permissions, unicorn dispatch internals.
2. Coverage decisions per the recall table — if the product scope expands to
   injection/rendering classes, each is a new-rule project with an interface
   upgrade (SQL source-level matching is the deferred item and the first candidate).
