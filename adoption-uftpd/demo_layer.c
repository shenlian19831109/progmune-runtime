/* ═══ 演示层（非 uftpd 代码）——采纳案例的守卫演示 ═══
 * uftpd 的真实登录原语（check_user_pass/handle_PASS）在 src/ftpcmd.c 中
 * 已注解（static 函数，演示层不可跨文件调用——真实入口经函数指针表分发，
 * 本身就是 L3 边界）。本层以同形 wrapper 演示守卫语义。
 */

/* @progmune(namespace="auth", pre=[], post=["AUTHENTICATED"]) */
void establish_login(const char *user, const char *pass) {
    check_user_pass_wrapper(user, pass);
}

/* @progmune(namespace="auth", pre=["AUTHENTICATED"]) */
void start_file_transfer(const char *path) {
    transfer_wrapper(path);
}

/* 合法流：先登录再传输 */
void ftp_session_good(const char *user, const char *pass, const char *path) {
    establish_login(user, pass);
    start_file_transfer(path);
}

/* 植入违规：未登录直接传输（经典 missing-auth） */
void ftp_session_no_login(const char *path) {
    start_file_transfer(path);
}

/* ═══ 数据传送授权（金标 5/5）——真实传送原语 do_RETR/do_STOR ═══
 * src/ftpcmd.c 中已注解：pre=[AUTHENTICATED], post=[AUTHORIZED]
 * （namespace=auth——SSG 状态机 per-namespace，data_integrity 内置规则
 *  check_resource_ownership 的跨命名空间 pre 不可满足，见 V6 发现 G5）。
 * 真实入口经 uev 事件回调注册（uev_io_init(..., do_RETR, ...)）——
 * 函数指针分发 L3 边界，本层按名调用真实原语表达传送守卫语义。
 */

/* 合法流：登录后下载（do_RETR 真实原语） */
void ftp_transfer_good(const char *user, const char *pass, const char *path) {
    uev_t *w = NULL;
    establish_login(user, pass);
    do_RETR(w, NULL, 0);
}

/* 植入违规：未登录直接下载（missing-auth 传送） */
void ftp_transfer_no_login(const char *path) {
    uev_t *w = NULL;
    do_RETR(w, NULL, 0);
}
