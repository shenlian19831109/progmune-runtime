"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ssg_validator_1 = require("./ssg-validator");
const authProtocol = [
    {
        function: 'verify_password',
        protocol: {
            pre_states: ['UNAUTHENTICATED'],
            post_states: ['AUTHENTICATED'],
        }
    },
    {
        function: 'generate_jwt',
        protocol: {
            pre_states: ['AUTHENTICATED'],
            post_states: ['TOKEN_ISSUED'],
            invalidate: ['AUTHENTICATED']
        }
    },
    {
        function: 'create_session',
        protocol: {
            pre_states: ['TOKEN_ISSUED'],
            post_states: ['SESSION_ACTIVE'],
            invalidate: ['TOKEN_ISSUED']
        }
    }
];
function runDemo() {
    console.log('═══ Semantic State Graph (SSG) 原型演示 ═══\n');
    console.log('场景1：合法序列 (verify_password → generate_jwt → create_session)');
    const legalSequence = ['verify_password', 'generate_jwt', 'create_session'];
    const validator1 = new ssg_validator_1.StateMachineValidator(authProtocol, 'UNAUTHENTICATED');
    let allPassed = true;
    for (const fn of legalSequence) {
        const result = validator1.apply(fn);
        if (!result.valid) {
            console.log(`  ❌ ${fn} 被拦截：${result.error}`);
            allPassed = false;
            break;
        }
        else {
            console.log(`  ✅ ${fn} 通过，当前状态：[${result.statesAfter}]`);
        }
    }
    if (allPassed)
        console.log('  ✔ 合法序列全部通过\n');
    console.log('场景2：非法序列 (generate_jwt → verify_password)');
    const illegalSequence = ['generate_jwt', 'verify_password'];
    const validator2 = new ssg_validator_1.StateMachineValidator(authProtocol, 'UNAUTHENTICATED');
    for (const fn of illegalSequence) {
        const result = validator2.apply(fn);
        if (!result.valid) {
            console.log(`  🚫 ${fn} 被拦截：${result.error}`);
            console.log('  🛡️ SSG 成功阻止了非法状态跃迁！');
            break;
        }
        else {
            console.log(`  ✅ ${fn} 通过，当前状态：[${result.statesAfter}]`);
        }
    }
    console.log('\n═══ 演示完成 ═══');
}
runDemo();
