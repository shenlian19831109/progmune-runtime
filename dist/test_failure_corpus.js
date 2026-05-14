"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const failure_corpus_1 = require("./failure-corpus");
// 模拟记录一条失败案例
(0, failure_corpus_1.recordFailure)({
    intent: "实现一个登录函数",
    projectFunctions: ["verify_password", "generate_jwt"],
    violatedSVL: "SVL-4",
    constraintType: "protocol",
    actionSequence: [{ kind: "call", function: "generate_jwt" }],
    errorDetail: "非法调用：generate_jwt 要求前置状态 [AUTHENTICATED]，当前状态为 [UNAUTHENTICATED]",
    ssgState: "UNAUTHENTICATED",
});
// 打印当前统计
console.log("当前失败案例总数:", (0, failure_corpus_1.getAllFailures)().length);
console.log("高频模式:", (0, failure_corpus_1.getTopFailurePatterns)());
