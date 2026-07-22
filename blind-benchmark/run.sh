#!/bin/bash
# Progmune Blind Benchmark Runner
# Usage: bash blind-benchmark/run.sh [project_id]

set -e

BENCH_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$BENCH_DIR/.." && pwd)"
REPORT_DIR="$BENCH_DIR/reports"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     Progmune Blind Benchmark                                 ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Load gold annotations
echo "Step 1: Loading gold annotations..."
GOLD="$BENCH_DIR/gold/annotations.json"
if [ ! -f "$GOLD" ]; then
  echo "  No gold annotations found. Run annotations first."
  exit 1
fi

TOTAL=$(python3 -c "import json; d=json.load(open('$GOLD')); print(d['aggregate']['total_findings'])")
DETECTED=$(python3 -c "import json; d=json.load(open('$GOLD')); print(d['aggregate']['progmune_detected'])")
echo "  Gold dataset: $TOTAL findings across annotated projects"
echo ""

# Step 2: Run Progmune verification on annotated project
echo "Step 2: Running Progmune verification..."
echo ""

npx ts-node --transpile-only -e "
const { RepairExecutor } = require('$PROJECT_DIR/src/repair-executor');

async function run() {
  const executor = new RepairExecutor({ recordTrajectory: false });
  const results = [];

  // Auth rules
  const authRules = new Map([
    ['verify_password', { pre_states: ['UNAUTHENTICATED'], post_states: ['PASSWORD_VERIFIED'], namespace: 'auth' }],
    ['generate_jwt', { pre_states: ['PASSWORD_VERIFIED'], post_states: ['TOKEN_ISSUED'], invalidate: ['PASSWORD_VERIFIED'], namespace: 'auth' }],
    ['create_session', { pre_states: ['TOKEN_ISSUED'], post_states: ['SESSION_ACTIVE'], invalidate: ['TOKEN_ISSUED'], namespace: 'auth' }],
    ['logout', { pre_states: ['SESSION_ACTIVE'], post_states: ['UNAUTHENTICATED'], invalidate: ['SESSION_ACTIVE'], namespace: 'auth' }],
  ]);

  const resourceRules = new Map([
    ['validate_content', { pre_states: [], post_states: ['CONTENT_VALID'], namespace: 'resource' }],
    ['create_post', { pre_states: ['CONTENT_VALID'], post_states: ['POST_CREATED'], namespace: 'resource' }],
    ['check_post_exists', { pre_states: [], post_states: ['POST_EXISTS'], namespace: 'resource' }],
    ['create_comment', { pre_states: ['POST_EXISTS'], post_states: ['COMMENT_CREATED'], namespace: 'resource' }],
  ]);

  const testCases = [
    { id: 'XL-001', name: 'Auth: insecureQuickLogin', seq: ['create_session'], rules: authRules, state: ['UNAUTHENTICATED'], target: ['SESSION_ACTIVE'] },
    { id: 'XL-002', name: 'Auth: registerAndPostDirect', seq: ['create_session'], rules: authRules, state: ['UNAUTHENTICATED'], target: ['SESSION_ACTIVE'] },
    { id: 'XL-003', name: 'Posts: quickPost', seq: ['create_post'], rules: resourceRules, state: [], target: ['POST_CREATED'] },
    { id: 'XL-004', name: 'Comments: unsafeComment', seq: ['create_comment'], rules: resourceRules, state: [], target: ['COMMENT_CREATED'] },
    { id: 'XL-005', name: 'Social: silentFollow', seq: ['follow_user'], rules: new Map([['follow_user', { pre_states: [], post_states: ['FOLLOWING'] }], ['send_notification', { pre_states: ['FOLLOWING'], post_states: ['NOTIFIED'] }]]), state: [], target: ['NOTIFIED'] },
  ];

  for (const tc of testCases) {
    const r = await executor.execute({
      violation: { svl: 4, violatedConstraint: 'protocol_violation', actionIndex: 0, currentStates: tc.state, requiredStates: tc.target, description: tc.name },
      protocol: 'Test', currentState: tc.state, targetState: tc.target,
      actionSequence: tc.seq, rules: tc.rules,
    });
    results.push({ id: tc.id, name: tc.name, detected: r.success, fixed: r.fixedSequence });
  }

  console.log('');
  console.log('── Benchmark Results ──');
  console.log('┌──────────┬────────────────────────────────────────────┬──────────┬──────────────────────────────────┐');
  console.log('│ ID       │ Finding                                    │ Detected │ Fixed Sequence                   │');
  console.log('├──────────┼────────────────────────────────────────────┼──────────┼──────────────────────────────────┤');
  for (const r of results) {
    const icon = r.detected ? '✅' : '❌';
    const fixed = r.fixed ? r.fixed.join(' → ') : 'N/A';
    console.log('│ ' + r.id.padEnd(8) + ' │ ' + r.name.padEnd(42) + ' │ ' + icon.padEnd(8) + ' │ ' + fixed.padEnd(32) + ' │');
  }
  console.log('└──────────┴────────────────────────────────────────────┴──────────┴──────────────────────────────────┘');

  const detected = results.filter(r => r.detected).length;
  console.log('');
  console.log('Detection Rate: ' + detected + '/' + results.length + ' (' + (detected/results.length*100).toFixed(0) + '%)');
}

run().catch(e => console.error(e.message));
" 2>&1

echo ""
echo "Step 3: Compare with gold annotations"
python3 -c "
import json
with open('$GOLD') as f:
    data = json.load(f)

for proj in data['projects']:
    s = proj['progmune_summary']
    missed = s.get('missed_findings', s.get('missed_finding', []))
    missed_str = ', '.join(missed) if missed else 'none'
    print(f'  {proj[\"project_id\"]} ({proj[\"project_type\"]}): {s[\"detected\"]}/{s[\"total_findings\"]} detected ({s[\"detection_rate\"]}%), missed: {missed_str}')

agg = data['aggregate']
print()
print(f'  Aggregate ({agg[\"projects_annotated\"]} projects):')
print(f'    Total findings:  {agg[\"total_findings\"]}')
print(f'    Detected:        {agg[\"progmune_detected\"]}')
print(f'    Missed:          {agg[\"progmune_missed\"]}')
print(f'    Recall:          {agg[\"overall_recall\"]}%')
print(f'    Precision:       {agg[\"overall_precision\"]}%')
print(f'    FP Rate:         {agg[\"false_positive_rate\"]}%')

if 'effective_recall_excluding_out_of_scope' in agg:
    print(f'    Eff. Recall:     {agg[\"effective_recall_excluding_out_of_scope\"]}% (excl. out-of-scope)')
print()
print(f'  By category:')
for cat, v in agg.get('by_category', {}).items():
    print(f'    {cat}: {v[\"detected\"]}/{v[\"total\"]} recall={v[\"recall\"]}%')
print()
print(f'  By protocol:')
for proto, v in agg.get('by_protocol', {}).items():
    print(f'    {proto}: {v[\"detected\"]}/{v[\"total\"]} recall={v[\"recall\"]}%')
" 2>&1

echo ""
echo "Step 4: Capability Gap Analysis"
python3 -c "
import json
with open('$REPORT_DIR/capability-gap-analysis.json') as f:
    data = json.load(f)

print()
print('── Current State ──')
print(f'  Overall Recall:           {data[\"overall_metrics\"][\"recall\"]}%')
print(f'  Precision:                {data[\"overall_metrics\"][\"precision\"]}%')
print(f'  F1:                       {data[\"overall_metrics\"][\"f1\"]}%')
print(f'  FN remaining:             {data[\"overall_metrics\"][\"fn\"]}')
print()

print('── Recall Evolution ──')
steps = data.get('capability_gap_map', {}).get('cumulative_recall_path', {}).get('steps', [])
for s in steps:
    v = s.get('version', '?')
    r = s.get('recall', 0)
    bar = chr(0x2588) * int(r/10) + chr(0x2591) * (10 - int(r/10))
    print(f'  {v}  [{bar}] {r}%  {s.get(\"note\", \"\")}')
print()

print('── Remaining Gaps ──')
for g in data.get('capability_gap_map', {}).get('gaps', []):
    print(f'  {g[\"id\"]}: {g[\"capability\"]} ({g[\"category\"]})')
    if g.get('fn_ids'):
        print(f'    FN: {g[\"fn_ids\"]}')
    print(f'    {g[\"current_state\"][:120]}')
" 2>&1

echo ""
echo "Step 5: Asset Coverage Matrix"
python3 -c "
import json
with open('$REPORT_DIR/asset-coverage-matrix.json') as f:
    data = json.load(f)
print('┌──────────────────────────┬──────────┬────────┬────────┬──────────┐')
print('│ Asset                    │ Mode     │ Conf   │ P / R  │ Detects  │')
print('├──────────────────────────┼──────────┼────────┼────────┼──────────┤')
for a in data['coverage']:
    mode = a['mode']
    conf = str(a['confidence']) + '%' if a['confidence'] > 0 else '—'
    pr = f'{a[\"precision\"]}%/{a[\"recall\"]}%' if a['precision'] > 0 else '—'
    detects = '✅' if a['can_detect'] else '❌'
    print(f'│ {a[\"asset\"].ljust(24)} │ {mode.ljust(8)} │ {conf.ljust(6)} │ {pr.ljust(6)} │ {detects.ljust(8)} │')
print('└──────────────────────────┴──────────┴────────┴────────┴──────────┘')
print()
print(f'Covered: {data[\"summary\"][\"covered_protocols\"]}/{data[\"summary\"][\"total_assets\"]} protocols ({data[\"summary\"][\"current_coverage_pct\"]}%)')
print(f'Target:  {data[\"summary\"][\"target_coverage_pct\"]}% coverage ({data[\"summary\"][\"total_assets\"]} total assets)')
" 2>&1

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Benchmark Complete                                          ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Reports: blind-benchmark/reports/"
echo "  Gold:    blind-benchmark/gold/annotations.json"
echo "  Prompts: blind-benchmark/prompts/templates.json"
echo ""
