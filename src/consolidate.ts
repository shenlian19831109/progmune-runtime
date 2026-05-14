import { consolidateSemantic, getRecentEpisodes } from './memory-layer';

console.log("═══ 记忆巩固 ═══");
const recent = getRecentEpisodes(10);
console.log(`情景记忆: ${recent.length} 条`);
console.log(`成功: ${recent.filter(e => e.success).length} 条, 失败: ${recent.filter(e => !e.success).length} 条`);

consolidateSemantic(3);
console.log("巩固完成。");
