"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * protocol-domain-validator.test.ts — specific violation checks 的语言门控回归
 *
 * 2026-08-28 语言门控（REALWORLD_C_V6.md）：PLAINTEXT_AUTH_WITHOUT_TLS 的
 * Web/TLS 语义在 C 真实项目上 3 FP / 0 TP（libssh 演示 1 + uftpd 采纳案例 2，
 * FTP/SSH 应用层本就明文）。SSH 主机密钥规则保留全语言（libssh 演示 1 TP）。
 *
 * 测试避免文件系统 I/O——直接构造 SemanticSequence。
 */
const vitest_1 = require("vitest");
const protocol_domain_validator_1 = require("./protocol-domain-validator");
/** PLAINTEXT 触发序列：auth 凭证 + 网络发送 + 无 TLS 保护 */
function plaintextSequence() {
    return {
        steps: [
            { api: "create_credentials", domain: "auth_cred", description: "", source: "lookup" },
            { api: "network_send", domain: "conn_mgmt", description: "", source: "lookup" },
        ],
        domains: ["auth_cred", "conn_mgmt"],
        primaryDomain: "conn_mgmt",
    };
}
/** SSH 无主机密钥校验触发序列：≥4 个 ssh_ops + userauth + 凭证、无 hostkey */
function sshNoHostKeySequence() {
    return {
        steps: [
            { api: "ssh_bind_accept", domain: "ssh_ops", description: "", source: "lookup" },
            { api: "ssh_handle_key_exchange", domain: "ssh_ops", description: "", source: "lookup" },
            { api: "ssh_userauth_password", domain: "ssh_ops", description: "", source: "lookup" },
            { api: "ssh_event_dopoll", domain: "ssh_ops", description: "", source: "lookup" },
            { api: "password_compare", domain: "auth_cred", description: "", source: "lookup" },
        ],
        domains: ["ssh_ops", "auth_cred"],
        primaryDomain: "ssh_ops",
    };
}
(0, vitest_1.describe)("protocol-domain-validator language gating", () => {
    (0, vitest_1.it)("PLAINTEXT_AUTH_WITHOUT_TLS fires for typescript", () => {
        const v = (0, protocol_domain_validator_1.checkSpecificViolations)(plaintextSequence(), undefined, "typescript");
        (0, vitest_1.expect)(v.map((x) => x.ruleId)).toContain("PLAINTEXT_AUTH_WITHOUT_TLS");
    });
    (0, vitest_1.it)("PLAINTEXT_AUTH_WITHOUT_TLS fires for python", () => {
        const v = (0, protocol_domain_validator_1.checkSpecificViolations)(plaintextSequence(), undefined, "python");
        (0, vitest_1.expect)(v.map((x) => x.ruleId)).toContain("PLAINTEXT_AUTH_WITHOUT_TLS");
    });
    (0, vitest_1.it)("PLAINTEXT_AUTH_WITHOUT_TLS does NOT fire for C (language gate)", () => {
        const v = (0, protocol_domain_validator_1.checkSpecificViolations)(plaintextSequence(), undefined, "c");
        (0, vitest_1.expect)(v.map((x) => x.ruleId)).not.toContain("PLAINTEXT_AUTH_WITHOUT_TLS");
    });
    (0, vitest_1.it)("SSH_NO_HOST_KEY_CHECK still fires for C (ungated — libssh TP 保留)", () => {
        const v = (0, protocol_domain_validator_1.checkSpecificViolations)(sshNoHostKeySequence(), undefined, "c");
        (0, vitest_1.expect)(v.map((x) => x.ruleId)).toContain("SSH_NO_HOST_KEY_CHECK");
    });
    (0, vitest_1.it)("undefined language keeps legacy behavior (all checks run)", () => {
        const v = (0, protocol_domain_validator_1.checkSpecificViolations)(plaintextSequence());
        (0, vitest_1.expect)(v.map((x) => x.ruleId)).toContain("PLAINTEXT_AUTH_WITHOUT_TLS");
    });
});
