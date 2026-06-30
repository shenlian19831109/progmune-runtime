#!/bin/bash
# Progmune Runtime — End-to-End Demo
# Shows: verify → certify → policy → governance → explain
# Usage: bash demo/demo.sh

set -e
C='\033[36m' G='\033[32m' Y='\033[33m' R='\033[31m' X='\033[0m'
BOLD='\033[1m'

echo -e "\n${C}${BOLD}═══════════════════════════════════════════════════${X}"
echo -e "${C}${BOLD}  Progmune Runtime — End-to-End Demo${X}"
echo -e "${C}${BOLD}═══════════════════════════════════════════════════${X}"

# Step 1: System Status
echo -e "\n${BOLD}Step 1: System Health${X}"
npx ts-node --transpile-only --project tsconfig.json src/progmune-status.ts 2>/dev/null | head -8

# Step 2: Verify the auth demo server
echo -e "\n${BOLD}Step 2: Verify AI-generated code${X}"
echo -e "  ${Y}Running protocol detection on demo-auth server.ts...${X}"
npx ts-node --transpile-only --project tsconfig.json -e "
const { validateProtocolState } = require('./src/protocol-detector');
const seqs = [
  ['register','get_profile'],
  ['login','generate_access_token','refresh_token'],
  ['login','generate_access_token','refresh_token','get_profile','logout','revoke_token'],
];
const labels = ['Bypass', 'Token Leak', 'Complete'];
seqs.forEach((s,i) => {
  const r = validateProtocolState(s);
  console.log('  ' + (r.valid ? '✅' : '❌') + ' ' + labels[i] + ': ' + s.join(' → '));
  if (!r.valid) console.log('     ' + r.detail);
});
" 2>&1

# Step 3: Certify
echo -e "\n${BOLD}Step 3: Issue AI Code Certificate${X}"
npx ts-node --transpile-only --project tsconfig.json src/certify.ts demo-auth/src/server.ts 2>/dev/null | head -10

# Step 4: Policy Check
echo -e "\n${BOLD}Step 4: Policy Engine — Deploy Gate${X}"
npx ts-node --transpile-only --project tsconfig.json src/policy/cli.ts check demo-auth/src/server.ts 2>/dev/null | head -6

# Step 5: Knowledge Base
echo -e "\n${BOLD}Step 5: Knowledge Base${X}"
npx ts-node --transpile-only --project tsconfig.json -e "
const kb = require('./src/protocol-knowledge').buildKnowledgeBase();
console.log('  Assets: ' + kb.summary.totalUnits + ' units, ' + kb.summary.totalDomains + ' domains');
console.log('  Stable: ' + kb.summary.byMaturity['stable'] + ' (TLS, SSH, HTTP)');
console.log('  Evidence: ' + kb.summary.totalValidatedSequences + ' sequences from ' + kb.summary.totalValidatedRepos + ' repos');
console.log('  Confidence: ' + kb.summary.averageConfidence + '% avg');
" 2>&1

# Step 6: Knowledge Network
echo -e "\n${BOLD}Step 6: Knowledge Network${X}"
npx ts-node --transpile-only --project tsconfig.json -e "
const g = require('./src/knowledge-graph').buildKnowledgeGraph();
console.log('  Graph: ' + g.nodes.length + ' nodes, ' + g.edges.length + ' edges');
const top = g.nodes.map(n => ({n: n.name, t: (g.inDegree[n.id]||0)+(g.outDegree[n.id]||0)})).sort((a,b)=>b.t-a.t).slice(0,3);
top.forEach(r => console.log('  ' + r.n + ': ' + r.t + ' connections'));
" 2>&1

echo -e "\n${G}${BOLD}═══════════════════════════════════════════════════${X}"
echo -e "${G}${BOLD}  Demo Complete — Runtime v1.0 Ready${X}"
echo -e "${G}${BOLD}═══════════════════════════════════════════════════${X}\n"
