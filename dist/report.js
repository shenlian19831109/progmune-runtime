"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const immune_reporter_1 = require("./immune-reporter");
const args = process.argv.slice(2);
const command = args[0] || "preview";
async function main() {
    switch (command) {
        case "preview":
            console.log("═══ 待上报的脱敏错误指纹 ═══");
            const fps = (0, immune_reporter_1.previewFingerprints)();
            if (fps.length === 0) {
                console.log("（暂无新的失败案例）");
            }
            else {
                fps.forEach((f, i) => {
                    console.log(`${i + 1}. [${f.violatedSVL}:${f.constraintType}] ${f.functionSequence.join(" → ") || "(无函数调用)"}`);
                });
                console.log(`\n共 ${fps.length} 条脱敏指纹待上报`);
            }
            break;
        case "report":
            console.log("正在安全上报脱敏指纹...");
            const result = await (0, immune_reporter_1.reportFingerprints)();
            console.log(result.message);
            break;
        default:
            console.log("用法: npx ts-node src/report.ts [preview|report]");
            console.log("  preview  查看待上报的脱敏错误指纹");
            console.log("  report   执行安全上报");
    }
}
main().catch(console.error);
