#!/usr/bin/env python3
"""
Application-corpus gold annotation — django-realworld, django-unicorn,
fastapi-realworld (well-written production apps, no planted vulnerabilities).

Judged-rule detections in these repos were reviewed (2026-08-16). Verdicts:

  FP — framework delegation / public-by-design / internal helper:
    * FastAPI routes authenticate via `Depends(get_current_user_authorizer())`
      — dependency injection is invisible to the call-name interface
    * DRF views enforce `permission_classes = (IsAuthenticatedOrReadOnly,)`
      etc. — public reads are by design (RealWorld spec)
    * Password hashing delegated: `user.change_password(password)`,
      Django `UserManager.create_user` (set_password), serializers → create_user
    * JWT service internals (create_access_token_for_user, get_username_from_token)
      and permission-check functions (check_*_permissions) ARE the auth layer
    * django-unicorn: component dispatch + cache restore are framework internals
      with their own authorization mechanism

Soft rules → UNLABELED (class-level), same as PyGoat annotation.

Output: gold/annotations-apps-v1.json (per-repo stats + combined)
"""

import json
from collections import Counter

SCAN = "blind-benchmark/reports/real-python-scan.json"
OUT = "blind-benchmark/gold/annotations-apps-v1.json"

REPOS = ("django-realworld-example-app", "django-unicorn", "fastapi-realworld-example-app")

JUDGED_RULES = (
    "Authorization (Unauthenticated Mutation)",
    "Authorization (Unauthenticated Access)",
    "Authorization (Ownership Check)",
    "Authorization (Resource Ownership)",
    "Session Fixation (Logout without Invalidation)",
    "No Token Rotation After Privilege Change",
    "Password Hashing",
    "Token Security (Weak Generation)",
)

# Per-function notes (verdict is fp for all of these repos)
FP_NOTES = {
    # django-realworld
    "ArticleViewSet.list": "DRF permission_classes=(IsAuthenticatedOrReadOnly,) — public reads by RealWorld spec",
    "TagListAPIView.list": "public tags endpoint — AllowAny by design",
    "ArticlesFeedAPIView.list": "feed requires auth via DRF permission_classes",
    "UserManager.create_user": "Django built-in — set_password() hashes (framework delegation)",
    "UserManager.create_superuser": "Django built-in — set_password() hashes (framework delegation)",
    "RegistrationSerializer.create": "delegates to create_user() — hashing in framework",
    # django-unicorn
    "restore_from_cache": "internal cache helper — not an endpoint",
    "Component.dispatch": "framework dispatch with its own component-level authorization",
    # fastapi-realworld
    "create_access_token_for_user": "JWT service internal — token generation IS the auth layer",
    "get_username_from_token": "JWT service internal — token parsing",
    "check_article_modification_permissions": "this function IS the permission check",
    "check_comment_modification_permissions": "this function IS the permission check",
    "retrieve_current_user": "Depends(get_current_user_authorizer()) — FastAPI DI auth",
    "register": "user.change_password(password) — hashing delegated to model",
    "follow_for_user": "Depends(get_current_user_authorizer()) — FastAPI DI auth",
    "unsubscribe_from_user": "Depends(get_current_user_authorizer()) — FastAPI DI auth",
    "list_comments_for_article": "public comments list by RealWorld spec",
    "create_comment_for_article": "Depends(get_current_user_authorizer()) — FastAPI DI auth",
    "list_articles": "public article list by RealWorld spec",
    "create_new_article": "Depends(get_current_user_authorizer()) — FastAPI DI auth",
    "get_articles_for_user_feed": "Depends(get_current_user_authorizer()) — FastAPI DI auth",
    "mark_article_as_favorite": "Depends(get_current_user_authorizer()) — FastAPI DI auth",
    "remove_article_from_favorites": "Depends(get_current_user_authorizer()) — FastAPI DI auth",
    "UsersRepository.create_user": "user.change_password(password) — hashing delegated to model",
}

SOFT_RULES = {
    "No Input Sanitization": ("unlabeled", "Django/Starlette autoescape; template-level rendering invisible to the interface"),
    "Context Manager Usage": ("unlabeled", "resource-hygiene style warning"),
    "Data Mutation Without Audit Trail": ("unlabeled", "audit logging absence — soft"),
    "Session No Timeout": ("unlabeled", "framework session defaults have expiry"),
    "Registration Without Email Verification": ("unlabeled", "true but standard practice — soft"),
    "Input Validation": ("unlabeled", "framework serializer/form validation invisible — soft"),
}


def main():
    scan = json.load(open(SCAN))
    detections = []
    per_repo = {}

    for repo in scan["results"]:
        if repo["repo"] not in REPOS:
            continue
        repo_dets = []
        for v in repo["violations"]:
            for s in v["safeguard"]:
                verdict = None
                note = None
                if s["rule"] in JUDGED_RULES or s["rule"].startswith("Password Hashing"):
                    note = FP_NOTES.get(v["name"], "framework delegation / DI auth invisible to call-name interface")
                    verdict = "fp"
                elif s["rule"] in SOFT_RULES:
                    verdict, note = SOFT_RULES[s["rule"]]
                else:
                    verdict, note = "unlabeled", "not individually reviewed"
                d = {"function": v["name"], "file": v["file"], "rule": s["rule"],
                     "verdict": verdict, "note": note}
                repo_dets.append(d)
                detections.append(d)

        c = Counter(d["verdict"] for d in repo_dets)
        per_repo[repo["repo"]] = {
            "functions_scanned": repo["totalFunctions"],
            "functions_with_violations": repo["functionsWithViolations"],
            "total_detections": len(repo_dets),
            "true_positives": c["tp"],
            "false_positives": c["fp"],
            "unlabeled": c["unlabeled"],
        }

    c = Counter(d["verdict"] for d in detections)
    total = sum(c.values())
    labeled = c["tp"] + c["fp"]
    precision = round(c["tp"] / labeled * 1000) / 10 if labeled else 0

    out = {
        "$description": "Application-corpus gold annotation v1 — 3 well-written production apps. "
                        "All judged-rule detections are framework-delegation / public-by-design / internal-helper FPs.",
        "annotated_by": "human review (Claude-assisted, 2026-08-16)",
        "version": "1.0",
        "summary": {
            "total_detections": total,
            "true_positives": c["tp"],
            "false_positives": c["fp"],
            "unlabeled": c["unlabeled"],
            "labeled_precision": precision,
        },
        "per_repo": per_repo,
        "detections": detections,
    }
    json.dump(out, open(OUT, "w"), indent=2, ensure_ascii=False)
    print(f"✅ {OUT}")
    for repo, st in per_repo.items():
        print(f"   {repo}: dets={st['total_detections']} TP={st['true_positives']} FP={st['false_positives']} unlabeled={st['unlabeled']}")
    print(f"   combined: {total} detections, TP {c['tp']}, FP {c['fp']}, unlabeled {c['unlabeled']}, labeled precision {precision}%")


if __name__ == "__main__":
    main()
