/*
 * demo-real-c-redis/acl_auth_broken.c — 注解驱动真实项目演示（broken 变体）
 *
 * 与 acl_auth.c 相同的真实 redis 函数与注解，另植入一条真实类违规：
 *   handle_monitor_no_auth — 未认证直接做权限检查（经典 missing-auth-check bug，
 *   对应 CVE 类「敏感命令无需认证」模式）。
 */

/* @progmune(namespace="auth", pre=["UNAUTHENTICATED"], post=["PASSWORD_VERIFIED"]) */
int ACLCheckUserCredentials(robj *username, robj *password) {
    user *u = ACLGetUserByName(username->ptr,sdslen(username->ptr));
    if (u == NULL) {
        errno = ENOENT;
        return C_ERR;
    }
    if (u->flags & USER_FLAG_DISABLED) {
        errno = EINVAL;
        return C_ERR;
    }
    if (u->flags & USER_FLAG_NOPASS) return C_OK;
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

int ACLAuthenticateUser(client *c, robj *username, robj *password, robj **err) {
    int result = checkModuleAuthentication(c, username, password, err);
    if (result == AUTH_NOT_HANDLED) {
        result = checkPasswordBasedAuth(c, username, password);
    }
    return result;
}

/* @progmune(namespace="auth", pre=["AUTHENTICATED"]) */
int ACLCheckAllPerm(client *c, int *idxptr) {
    return ACLCheckAllUserCommandPerm(c->user, c->cmd, c->argv, c->argc, getClientCachedKeyResult(c), idxptr);
}

/* ═══ 植入违规：未认证直接做权限检查（经典 missing-auth-check bug） ═══ */
void handle_monitor_no_auth(client *c) {
    ACLCheckAllPerm(c, NULL);
}
