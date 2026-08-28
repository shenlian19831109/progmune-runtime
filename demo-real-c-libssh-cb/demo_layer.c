/* ═══ 演示层（非 libssh 代码）——回调分发认证流的守卫演示 ═══
 * 与 samplesshd-cb.c（真实示例 + 注解）同目录。
 *
 * 注解设计：auth_password = verify 原语（真实密码比对，回调分发的
 *           auth_password_function）；
 *           new_session_channel = 通道守卫原语（channel_open_request_
 *           session_function 回调——认证后才可开通道）；
 *           authenticate = establish 原语（认证完成的落点——真实代码中
 *           该状态跃迁发生在 libssh 内部 + main 循环条件
 *           `while (!(authenticated && chan != NULL))`，函数指针分发
 *           L3 边界下由同形 wrapper 表达，与 REALWORLD_C_V5.md 的
 *           wrapper 模式一致）。
 */

/* @progmune(namespace="auth", pre=[], post=["AUTHENTICATED"]) */
int authenticate(ssh_session session) {
    /* libssh 回调返回 SSH_AUTH_SUCCESS 后的会话完成点 */
    return 1;
}

/* 合法流：先认证（verify → establish）再开通道 */
int cb_session_good(ssh_session session, const char *user, const char *pass) {
    if (auth_password(session, user, pass, NULL) == SSH_AUTH_SUCCESS)
        if (authenticate(session) == 1)
            return new_session_channel(session, NULL) != NULL;
    return 0;
}

/* 植入违规：未认证直接开通道（经典 missing-auth） */
int cb_session_no_auth(ssh_session session) {
    return new_session_channel(session, NULL) != NULL;
}
