"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const memory_layer_1 = require("./memory-layer");
console.log("═══ 记忆巩固 ═══");
const recent = (0, memory_layer_1.getRecentEpisodes)(10);
console.log(`情景记忆: ${recent.length} 条`);
console.log(`成功: ${recent.filter(e => e.success).length} 条, 失败: ${recent.filter(e => !e.success).length} 条`);
(0, memory_layer_1.consolidateSemantic)(3);
console.log("巩固完成。");
