# PLSB Verification Checklist — Tier 1: Workflow Bypass (5 cases)

## Before You Start
- [ ] `npx tsx scripts/validate-plsb.ts benchmarks/plsb.json` — confirm 0 errors

## Case 1: WB-003 — JWT alg:none bypass (quality 0.60)
- **CVE**: CVE-2023-39362
- **Project**: nodejs / jsonwebtoken
- **Current broken**: `parse_jwt → grant_access`
- **Current expected**: `parse_jwt → validate_algorithm → verify_signature → check_expiry → grant_access`
- **Search**: https://github.com/advisories?query=CVE-2023-39362
- **What to verify**: The fix added algorithm validation (`validate_algorithm`), signature verification (`verify_signature`), and expiry check (`check_expiry`) before granting access.
- [ ] Found commit hash: _______________
- [ ] Extracted before/after from diff
- [ ] Updated `benchmarks/plsb.json`
- [ ] `npx tsx scripts/validate-plsb.ts benchmarks/plsb.json` — passes

## Case 2: WB-001 — OAuth redirect bypass (quality 0.40)
- **CVE**: CVE-2023-5072
- **Project**: keycloak
- **Current broken**: `oauth_redirect → issue_token`
- **Current expected**: `oauth_redirect → validate_redirect_uri → validate_state → issue_token`
- **Search**: https://github.com/advisories?query=CVE-2023-5072
- **What to verify**: Token issuance should require redirect_uri and state validation.
- [ ] Found commit hash: _______________
- [ ] Extracted before/after from diff
- [ ] Updated `benchmarks/plsb.json`
- [ ] `validate-plsb.ts` passes

## Case 3: WB-002 — Django admin CSRF bypass (quality 0.40)
- **CVE**: CVE-2024-1563
- **Project**: django
- **Current broken**: `receive_form → save_model`
- **Current expected**: `receive_form → validate_csrf → clean_data → save_model`
- **Search**: https://github.com/advisories?query=CVE-2024-1563
- [ ] Found commit hash: _______________
- [ ] Extracted before/after from diff
- [ ] Updated `benchmarks/plsb.json`
- [ ] `validate-plsb.ts` passes

## Case 4: WB-004 — macOS Gatekeeper bypass (quality 0.40)
- **CVE**: CVE-2023-38571
- **Project**: apple / macOS
- **Current broken**: `receive_file → execute_binary`
- **Current expected**: `receive_file → validate_code_sign → quarantine_check → execute_binary`
- **Search**: https://github.com/advisories?query=CVE-2023-38571
- **Note**: Apple CVEs may not have public commits. Fallback: search for similar pattern in Linux kernel (CVE-2022-XXXXX).
- [ ] Found commit hash: _______________
- [ ] Extracted before/after from diff
- [ ] Updated `benchmarks/plsb.json`
- [ ] `validate-plsb.ts` passes

## Case 5: WB-005 — GitLab CI bypass (quality 0.40)
- **CVE**: CVE-2023-43641
- **Project**: gitlab
- **Current broken**: `clone_repo → run_pipeline`
- **Current expected**: `clone_repo → validate_ci_config → authorize_runner → run_pipeline`
- **Search**: https://github.com/advisories?query=CVE-2023-43641
- [ ] Found commit hash: _______________
- [ ] Extracted before/after from diff
- [ ] Updated `benchmarks/plsb.json`
- [ ] `validate-plsb.ts` passes

## After Completing Tier 1
- [ ] `npx tsx scripts/validate-plsb.ts benchmarks/plsb.json` — 0 errors
- [ ] Verified recall ≥ 85%
- [ ] `git add benchmarks/plsb.json && git commit -m "PLSB: verify 5 Workflow Bypass cases (Tier 1 complete)"`
- [ ] `git push origin main`

## Quick Reference
```bash
# Validate after each case
npx tsx scripts/validate-plsb.ts benchmarks/plsb.json

# View current gold count
npx tsx -e "const p=require('./benchmarks/plsb.json'); console.log('Gold:', p.entries.filter(e=>e.verified).length, '/', p.entries.length)"

# Check a specific entry's quality
npx tsx -e "const {assessGoldQuality}=require('./dist/gold-quality'); const p=require('./benchmarks/plsb.json'); const e=p.entries.find(x=>x.id==='WB-003'); console.log(assessGoldQuality(e.broken,e.expected));"
```
