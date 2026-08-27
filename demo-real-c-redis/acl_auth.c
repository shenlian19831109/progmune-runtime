/*
 * demo-real-c-redis/acl_auth.c — 注解驱动真实项目演示（good 变体）
 *
 * 函数体逐字取自 redis 7.x src/acl.c（vendored benchmarks/redis），
 * 仅增加 @progmune 注解（3 条，覆盖 auth 协议）与「演示入口」段。
 *
 * 注解设计（映射真实语义）：
 *   ACLCheckUserCredentials    verify 原语：密码哈希比对成功 → PASSWORD_VERIFIED
 *   checkPasswordBasedAuth     establish 原语：c->authenticated = 1 的真实位置
 *                              → AUTHENTICATED（pre 为空：verify 发生在函数体内，
 *                              状态机只看函数间顺序——见 REALWORLD_C_V2.md 摩擦记录）
 *   ACLCheckAllPerm            权限检查原语：仅 AUTHENTICATED 状态可执行
 *
 * 演示入口（真实 redis 的 processCommand 在 server.c，此处以同形入口代表）：
 *   handle_authed_command      authenticate → perm-check 的合法完整流
 */

/* @progmune(namespace="auth", pre=["UNAUTHENTICATED"], post=["PASSWORD_VERIFIED"]) */
int ACLCheckUserCredentials(robj *username, robj *password) {
    user *u = ACLGetUserByName(username->ptr,sdslen(username->ptr));
    if (u == NULL) {
        errno = ENOENT;
        return C_ERR;
    }

    /* Disabled users can't login. */
    if (u->flags & USER_FLAG_DISABLED) {
        errno = EINVAL;
        return C_ERR;
    }

    /* If the user is configured to don't require any password, we
     * are already fine here. */
    if (u->flags & USER_FLAG_NOPASS) return C_OK;

    /* Check all the user passwords for at least one to match. */
    listIter li;
    listNode *ln;
    listRewind(u->passwords,&li);
    sds hashed = ACLHashPassword(password->ptr,sdslen(password->ptr));
    while((ln = listNext(&li))) {
        sds thispass = listNodeValue(ln);
        if (!time_independent_strcmp(hashed, thispass, HASH_PASSWORD_LEN)) {
            sdsfree(hashed);
            return C_OK;
        }
    }
    sdsfree(hashed);

    /* If we reached this point, no password matched. */
    errno = EINVAL;
    return C_ERR;
}

/* @progmune(namespace="auth", pre=[], post=["AUTHENTICATED"]) */
int checkPasswordBasedAuth(client *c, robj *username, robj *password) {
    if (ACLCheckUserCredentials(username,password) == C_OK) {
        c->authenticated = 1;
        c->user = ACLGetUserByName(username->ptr,sdslen(username->ptr));
        moduleNotifyUserChanged(c);
        return AUTH_OK;
    } else {
        addACLLogEntry(c,ACL_DENIED_AUTH,(c->flags & CLIENT_MULTI) ? ACL_LOG_CTX_MULTI : ACL_LOG_CTX_TOPLEVEL,0,username->ptr,NULL);
        return AUTH_ERR;
    }
}

/* Attempt authenticating the user - first through module based authentication,
 * and then, if needed, with normal password based authentication.
 * Returns one of the following codes:
 * AUTH_OK - Indicates that authentication succeeded.
 * AUTH_ERR - Indicates that authentication failed.
 * AUTH_BLOCKED - Indicates module authentication is in progress through a blocking implementation.
 */
int ACLAuthenticateUser(client *c, robj *username, robj *password, robj **err) {
    int result = checkModuleAuthentication(c, username, password, err);
    /* If authentication was not handled by any Module, attempt normal password based auth. */
    if (result == AUTH_NOT_HANDLED) {
        result = checkPasswordBasedAuth(c, username, password);
    }
    return result;
}

void authCommand(client *c) {
    /* Only two or three argument forms are allowed. */
    if (c->argc > 3) {
        addReplyErrorObject(c,shared.syntaxerr);
        return;
    }
    /* Always redact the second argument */
    redactClientCommandArgument(c, 1);

    /* Handle the two different forms here. The form with two arguments
     * will just use "default" as username. */
    robj *username, *password;
    if (c->argc == 2) {
        /* Mimic the old behavior of giving an error for the two argument
         * form if no password is configured. */
        if (DefaultUser->flags & USER_FLAG_NOPASS) {
            addReplyError(c,"AUTH <password> called without any password "
                            "configured for the default user. Are you sure "
                            "your configuration is correct?");
            return;
        }

        username = shared.default_username;
        password = c->argv[1];
    } else {
        username = c->argv[1];
        password = c->argv[2];
        redactClientCommandArgument(c, 2);

        /* Handle internal authentication commands.
         * Note: No user-defined ACL user can have this username (no spaces
         * allowed), thus no conflicts with ACL possible. */
        if (!strcmp(username->ptr, "internal connection")) {
            internalAuth(c);
            return;
        }
    }

    robj *err = NULL;
    int result = ACLAuthenticateUser(c, username, password, &err);
    if (result == AUTH_OK) {
        addReply(c, shared.ok);
    } else if (result == AUTH_ERR) {
        addAuthErrReply(c, err);
    }
    if (err) decrRefCount(err);
}

/* @progmune(namespace="auth", pre=["AUTHENTICATED"]) */
int ACLCheckAllPerm(client *c, int *idxptr) {
    return ACLCheckAllUserCommandPerm(c->user, c->cmd, c->argv, c->argc, getClientCachedKeyResult(c), idxptr);
}

/* ═══ 演示入口（真实 redis 的 processCommand 在 server.c，此处以同形入口代表） ═══ */

/* 合法完整流：authenticate → perm-check */
void handle_authed_command(client *c, robj *username, robj *password) {
    robj *err = NULL;
    int result = ACLAuthenticateUser(c, username, password, &err);
    if (result == AUTH_OK) {
        ACLCheckAllPerm(c, NULL);
    }
}
