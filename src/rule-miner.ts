import { getTopFailurePatterns, generateCandidateRules } from './failure-corpus';

console.log("═══ 失败模式分析 ═══");
const patterns = getTopFailurePatterns(5);
console.log("Top 5 失败模式:");
patterns.forEach(p => console.log(`  ${p.pattern}: ${p.count} 次`));

console.log("\n候选规则建议:");
const rules = generateCandidateRules();
rules.forEach(r => console.log(`  - ${r}`));
