/* ═══ 演示层（非 libssh 代码）——服务端会话守卫：认证后才接受通道 ═══
 * 与 samplesshd-kbdint.c（真实示例 + 注解）同目录。
 * 注解设计：auth_password = verify 原语（真实密码比对）、
 *           authenticate = establish 原语（服务端认证循环，函数内顺序
 *           不检查——REALWORLD_C_V2.md 同款边界）、
 *           accept_channel_session = 会话守卫原语（认证后才可开通道）。
 */

/* @progmune(namespace="auth", pre=["AUTHENTICATED"], post=["CHANNEL_OPEN"]) */
int accept_channel_session(ssh_session session) {
    ssh_message message = ssh_message_get(session);
    if (message && ssh_message_type(message) == SSH_REQUEST_CHANNEL_OPEN) {
        ssh_channel chan = ssh_message_channel_request_open_reply_accept(message);
        ssh_message_free(message);
        return chan ? 1 : 0;
    }
    return 0;
}

/* 合法流：先 authenticate 再接受通道 */
int serve_session_good(ssh_session session) {
    if (authenticate(session) == 1) {
        return accept_channel_session(session);
    }
    return 0;
}

/* 植入违规：未认证直接接受通道（经典 missing-auth） */
int serve_session_no_auth(ssh_session session) {
    return accept_channel_session(session);
}
