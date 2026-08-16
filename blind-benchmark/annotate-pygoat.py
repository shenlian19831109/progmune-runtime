#!/usr/bin/env python3
"""
PyGoat gold annotation — application-corpus validation v1.

Annotates the PyGoat scan (reports/real-python-scan.json) with per-detection
verdicts from manual code review (2026-08-16):

  TP        — rule claim is factually correct AND security-relevant
  FP        — rule claim contradicted by the code
  UNLABELED — claim true-ish but soft / delegated to framework (Django
              autoescape, create_user hashing, session defaults) or a different
              vulnerability class than the rule's claim

Verdicts for the auth/password/token rules are per-function (verified by
reading each function); soft rules (No Input Sanitization, Context Manager,
Audit Trail, Session No Timeout, Registration Verification) are class-level
UNLABELED with documented reasons.

Output: gold/annotations-pygoat-v1.json
"""

import json
from collections import Counter

SCAN = "blind-benchmark/reports/real-python-scan.json"
OUT = "blind-benchmark/gold/annotations-pygoat-v1.json"

# ── Per-function verdicts (verified by code review) ──
VERDICTS = {
    # Unauthenticated Mutation — 8 deliberately vulnerable labs (TP) + 1 FP
    "introduction.views.insec_des_lab": ("tp", "pickle.loads() on user cookie — insecure deserialization lab"),
    "introduction.views.xxe_parse": ("tp", "external entities enabled + parseString(request.body) — XXE lab"),
    "introduction.views.ba_lab": ("tp", "cookie-based admin check (COOKIES.get('admin')=='1') — broken access lab"),
    "introduction.views.Otp": ("tp", "OTP rendered into client HTML — broken auth lab"),
    "introduction.views.a1_broken_access_lab_1": ("tp", "cookie admin bypass — IDOR/broken access lab"),
    "introduction.views.crypto_failure_lab3": ("tp", "client-side cookie tampering with split('|') expiry — crypto failure lab"),
    "introduction.views.auth_failure_lab3": ("tp", "session_id cookie directly trusted — broken auth lab"),
    "introduction.views.sec_misconfig_lab3": ("tp", "JWT decoded with hardcoded SECRET_COOKIE_KEY — misconfig lab"),
    "broken_auth_lab.app.reset_form": ("fp", "token IS checked (if token in password_reset_tokens) — token is the auth"),
    # Unauthenticated Access
    "introduction.views.get_version": ("tp", "unauthenticated version disclosure — the A9 lab's vulnerability"),
    "introduction.views.a9_lab2": ("fp", "view checks request.user.is_authenticated and redirects"),
    "challenge.views.DoItFast.post": ("fp", "checks request.user.is_authenticated and redirects"),
    # Session Fixation
    "introduction.views.auth_lab_logout": ("fp", "logout deletes the auth cookie — invalidation for this lab's cookie-based auth"),
    # Token rotation
    "broken_auth_lab.app.reset_password": ("fp", "real flaw is predictable md5 token — not 'no rotation after privilege change'"),
    # Password Hashing (+Weak)
    "introduction.views.auth_lab_signup": ("tp", "password stored in plaintext via authLogin.objects.create"),
    "broken_auth_lab.app.register": ("tp", "plaintext password storage — commented 'Vulnerable' in source"),
    "introduction.views.register": ("fp", "Django NewUserForm.save() hashes (pbkdf2 default) — delegation to framework"),
    "dataexposure.views.register_view": ("fp", "User.objects.create_user() hashes — delegation to framework"),
    # Token Security
    "introduction.views.auth_lab_login": ("tp", "userid cookie, samesite=None, secure=False — weak session material"),
    "broken_auth_lab.app.login": ("tp", "base64(username:timestamp) session token — commented 'Vulnerable'"),
    "introduction.views.login_otp": ("fp", "just renders the OTP page — no token generated here"),
    "introduction.views.register": ("fp", "Django login() manages session securely"),
    "dataexposure.views.login_view": ("fp", "Django authenticate()/login() — secure session handling"),
    "introduction.mitre.csrf_lab_login": ("unlabeled", "md5 password storage is a hashing flaw, not token generation"),
    # SQL Injection (source-level, new rule)
    "introduction.views.sql_lab": ("tp", "raw() with string-concatenated SQL from POST input — SQLi lab"),
    "introduction.views.injection_sql_lab": ("tp", "raw() with string-concatenated SQL from POST input — SQLi lab"),
    # Command Injection (newly active rule)
    "introduction.views.cmd_lab": ("tp", "user-supplied domain executed via OS command — CMD lab"),
    "introduction.views.cmd_lab2": ("tp", "eval(val) on user input — code execution lab"),
    "uninstaller.uninstall_pip_packages": ("fp", "subprocess with static args — no user input reaches the command"),
    "uninstaller.uninstall_pip": ("fp", "subprocess with static args — no user input reaches the command"),
    "challenge.views.DoItFast.post": ("fp", "auth checked; container management calls, no user-controlled command verified"),
    "challenge.views.DoItFast.delete": ("fp", "auth checked; container management calls, no user-controlled command verified"),
    # Unsafe Deserialization (newly active rule)
    "introduction.views.insec_des_lab": ("tp", "pickle.loads() on user cookie — deserialization lab"),
    "introduction.views.a9_lab": ("tp", "yaml.load(file, yaml.Loader) on upload — unsafe YAML deserialization lab"),
    "dataexposure_lab.main.deserialize_data": ("tp", "dockerized insec_des lab — pickle-based"),
    # SSRF
    "introduction.views.ssrf_lab2": ("tp", "requests.get() on user-supplied URL — SSRF lab"),
}

# Soft-rule class verdicts (class-level, sampled)
SOFT_RULES = {
    "No Input Sanitization": ("unlabeled", "Django autoescape makes render-based claims unverifiable at view level; xss/ssti labs are vulnerable via templates (|safe), invisible to this interface"),
    "Context Manager Usage": ("unlabeled", "resource-hygiene style warning, not a vulnerability class"),
    "Data Mutation Without Audit Trail": ("unlabeled", "audit logging absence — soft"),
    "Session No Timeout": ("unlabeled", "Django session defaults have expiry; 1-year cookie is long but set"),
    "Registration Without Email Verification": ("unlabeled", "true but standard practice — soft"),
    "Input Validation": ("unlabeled", "management-command code — soft"),
}


def main():
    scan = json.load(open(SCAN))
    repo = next(r for r in scan["results"] if r["repo"] == "PyGoat")

    # Rules judged per-function (auth / password / token / injection classes)
    JUDGED_RULES = (
        "Authorization (Unauthenticated Mutation)",
        "Authorization (Unauthenticated Access)",
        "Session Fixation (Logout without Invalidation)",
        "No Token Rotation After Privilege Change",
        "Password Hashing",
        "Token Security (Weak Generation)",
        "Command Injection",
        "Unsafe Deserialization (Pickle)",
        "SQL Injection (Python)",
        "SSRF (User-Controlled URL Fetch)",
    )

    detections = []
    for v in repo["violations"]:
        for s in v["safeguard"]:
            verdict = None
            if s["rule"] in JUDGED_RULES or s["rule"].startswith("Password Hashing"):
                # Match by file basename + function name (extractor reports relative paths)
                candidates = [k for k in VERDICTS
                              if k.endswith("." + v["name"])
                              and k.split(".")[-2].removesuffix(".py") == v["file"].split("/")[-1].removesuffix(".py")]
                if len(candidates) == 1:
                    verdict = VERDICTS[candidates[0]]
            if verdict is None and s["rule"] in SOFT_RULES:
                verdict = SOFT_RULES[s["rule"]]
            if verdict is None:
                verdict = ("unlabeled", "not individually reviewed")
            detections.append({
                "function": v["name"],
                "file": v["file"],
                "rule": s["rule"],
                "verdict": verdict[0],
                "note": verdict[1],
            })

    c = Counter(d["verdict"] for d in detections)
    total = sum(c.values())
    labeled = c["tp"] + c["fp"]
    precision = round(c["tp"] / labeled * 1000) / 10 if labeled else 0

    out = {
        "$description": "PyGoat gold annotation v1 — application-corpus validation. Per-detection verdicts from manual code review.",
        "annotated_by": "human review (Claude-assisted, 2026-08-16)",
        "version": "1.0",
        "corpus": "PyGoat (OWASP vulnerable-by-design Django app, shallow clone)",
        "summary": {
            "total_detections": total,
            "true_positives": c["tp"],
            "false_positives": c["fp"],
            "unlabeled": c["unlabeled"],
            "labeled_precision": precision,
            "auth_rule_tp": sum(1 for d in detections if d["verdict"] == "tp" and ("Authorization" in d["rule"] or "Session Fixation" in d["rule"] or "Token Rotation" in d["rule"])),
        },
        "recall_notes": "PyGoat's lab inventory spans ~30 labs across OWASP classes. The detector surfaced 10 auth/broken-access labs and 3 weak-hashing/token labs. Missed classes: SQLi, XSS, SSTI, SSRF, command injection, XXE-as-injection (the xxe lab fired via the auth rule, not an injection rule) — out of scope for the protocol-lifecycle rule set. A full recall number would require lab-level gold enumeration.",
        "detections": detections,
    }

    json.dump(out, open(OUT, "w"), indent=2, ensure_ascii=False)
    print(f"✅ {OUT}")
    print(f"   detections {total}: TP {c['tp']} | FP {c['fp']} | unlabeled {c['unlabeled']}")
    print(f"   labeled precision {precision}%")


if __name__ == "__main__":
    main()
