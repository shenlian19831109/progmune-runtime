"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * annotation-suggest.test.ts — 注解建议引擎回归（纯函数，无文件系统 I/O）
 *
 * 词汇模式来自 3.7.6 金标 5/5 真实注解反推（REALWORLD_C_V6.md）：
 * check_user_pass/auth_password=verify、handle_PASS=establish、
 * do_RETR/do_STOR/new_session_channel=guard、open/close_data_connection=资源生命周期。
 */
const vitest_1 = require("vitest");
const annotation_suggest_1 = require("./annotation-suggest");
const fn = (name, extra = {}) => ({
    name,
    file: "src/demo.c",
    ...extra,
});
(0, vitest_1.describe)("annotation-suggest", () => {
    (0, vitest_1.it)("verify：凭证名词 × 比对动词（check_user_pass / auth_password）", () => {
        const s = (0, annotation_suggest_1.suggestAnnotations)([fn("check_user_pass"), fn("auth_password")]);
        (0, vitest_1.expect)(s).toHaveLength(2);
        for (const x of s) {
            (0, vitest_1.expect)(x.role).toBe("verify");
            (0, vitest_1.expect)(x.namespace).toBe("auth");
            (0, vitest_1.expect)(x.pre).toEqual(["UNAUTHENTICATED"]);
            (0, vitest_1.expect)(x.post).toEqual(["PASSWORD_VERIFIED"]);
        }
    });
    (0, vitest_1.it)("establish：登录完成原语（handle_PASS / authenticate）", () => {
        const s = (0, annotation_suggest_1.suggestAnnotations)([fn("handle_PASS"), fn("authenticate")]);
        (0, vitest_1.expect)(s.map((x) => [x.function, x.role])).toEqual(vitest_1.expect.arrayContaining([
            ["handle_PASS", "establish"],
            ["authenticate", "establish"],
        ]));
        (0, vitest_1.expect)(s[0].pre).toEqual([]);
        (0, vitest_1.expect)(s[0].post).toEqual(["AUTHENTICATED"]);
    });
    (0, vitest_1.it)("guard：FTP 命令处理器与通道开启回调（do_RETR/do_STOR/new_session_channel）", () => {
        const s = (0, annotation_suggest_1.suggestAnnotations)([
            fn("do_RETR"),
            fn("do_STOR"),
            fn("new_session_channel"),
        ]);
        for (const x of s) {
            (0, vitest_1.expect)(x.role).toBe("guard");
            (0, vitest_1.expect)(x.pre).toEqual(["AUTHENTICATED"]);
            (0, vitest_1.expect)(x.post).toEqual(["AUTHORIZED"]);
        }
    });
    (0, vitest_1.it)("资源生命周期：open/close_data_connection", () => {
        const s = (0, annotation_suggest_1.suggestAnnotations)([
            fn("open_data_connection"),
            fn("close_data_connection"),
        ]);
        const open = s.find((x) => x.function === "open_data_connection");
        const close = s.find((x) => x.function === "close_data_connection");
        (0, vitest_1.expect)(open?.role).toBe("open");
        (0, vitest_1.expect)(open?.post).toEqual(["FILE_OPEN"]);
        (0, vitest_1.expect)(close?.role).toBe("close");
        (0, vitest_1.expect)(close?.pre).toEqual(["FILE_OPEN"]);
        (0, vitest_1.expect)(close?.invalidate).toEqual(["FILE_OPEN"]);
    });
    (0, vitest_1.it)("已注解函数不再建议", () => {
        const annotated = fn("check_user_pass", {
            protocol: { pre_states: ["UNAUTHENTICATED"], post_states: ["PASSWORD_VERIFIED"], namespace: "auth" },
        });
        (0, vitest_1.expect)((0, annotation_suggest_1.suggestAnnotations)([annotated])).toHaveLength(0);
    });
    (0, vitest_1.it)("规则名函数（按名即命中）不再建议", () => {
        const s = (0, annotation_suggest_1.suggestAnnotations)([fn("verify_password")], new Set(["verify_password"]));
        (0, vitest_1.expect)(s).toHaveLength(0);
    });
    (0, vitest_1.it)("外部函数不再建议", () => {
        (0, vitest_1.expect)((0, annotation_suggest_1.suggestAnnotations)([fn("check_password", { external: true })])).toHaveLength(0);
    });
    (0, vitest_1.it)("模板可直接粘贴：完整注释块文本", () => {
        const [s] = (0, annotation_suggest_1.suggestAnnotations)([fn("check_user_pass")]);
        (0, vitest_1.expect)(s.template).toBe('/* @progmune(namespace="auth", pre=["UNAUTHENTICATED"], post=["PASSWORD_VERIFIED"]) */');
    });
    (0, vitest_1.it)("确定性 + 上限：同输入同输出，超过 limit 截断（置信度优先）", () => {
        const fns = Array.from({ length: 30 }, (_, i) => fn(`do_RETR_${i}`) // 全部 guard，单证据 medium
        );
        const a = (0, annotation_suggest_1.suggestAnnotations)(fns, undefined, 10);
        const b = (0, annotation_suggest_1.suggestAnnotations)(fns, undefined, 10);
        (0, vitest_1.expect)(a).toEqual(b);
        (0, vitest_1.expect)(a).toHaveLength(10);
        (0, vitest_1.expect)(a[0].function).toBe("do_RETR_0");
    });
    (0, vitest_1.it)("无命中词汇的函数不产生建议", () => {
        const s = (0, annotation_suggest_1.suggestAnnotations)([fn("parse_int"), fn("strlcat"), fn("main")]);
        (0, vitest_1.expect)(s).toHaveLength(0);
    });
    (0, vitest_1.it)("掩蔽风险：函数体调用已有规则原语 → maskRisk=true", () => {
        const [s] = (0, annotation_suggest_1.suggestAnnotations)([fn("login_flow", { calls: ["verify_password"] })], new Set(["verify_password"]));
        (0, vitest_1.expect)(s.maskRisk).toBe(true);
    });
    (0, vitest_1.it)("掩蔽风险：函数体调用本批同被建议的函数 → maskRisk=true（co-suggestion）", () => {
        const s = (0, annotation_suggest_1.suggestAnnotations)([
            fn("login_flow", { calls: ["start_file_transfer"] }),
            fn("start_file_transfer"),
        ]);
        const flow = s.find((x) => x.function === "login_flow");
        (0, vitest_1.expect)(flow?.maskRisk).toBe(true);
    });
    (0, vitest_1.it)("叶子函数（体内无规则原语调用）→ maskRisk=false", () => {
        const [s] = (0, annotation_suggest_1.suggestAnnotations)([fn("check_user_pass", { calls: ["strcmp", "strlcpy"] })]);
        (0, vitest_1.expect)(s.maskRisk).toBe(false);
    });
    (0, vitest_1.it)("会话工厂 new_session 不再误判为守卫", () => {
        const s = (0, annotation_suggest_1.suggestAnnotations)([fn("new_session")]);
        (0, vitest_1.expect)(s).toHaveLength(0);
    });
    (0, vitest_1.it)("通道守卫 new_session_channel 仍命中 guard", () => {
        const s = (0, annotation_suggest_1.suggestAnnotations)([fn("new_session_channel")]);
        (0, vitest_1.expect)(s).toHaveLength(1);
        (0, vitest_1.expect)(s[0].role).toBe("guard");
    });
});
