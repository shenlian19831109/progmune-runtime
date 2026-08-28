/*
 * authentication.c
 * This file contains an example of how to do an authentication to a
 * SSH server using libssh
 */

/*
Copyright 2003-2009 Aris Adamantiadis

This file is part of the SSH Library

You are free to copy this file, modify it in any way, consider it being public
domain. This does not apply to the rest of the library though, but it is
allowed to cut-and-paste working code from this file to any license of
program.
The goal is to show the API in action. It's not a reference on how terminal
clients must be made or how a client should react.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <libssh/libssh.h>
#include "examples_common.h"

int authenticate_kbdint(ssh_session session, const char *password)
{
    int err;

    err = ssh_userauth_kbdint(session, NULL, NULL);
    while (err == SSH_AUTH_INFO) {
        const char *instruction = NULL;
        const char *name = NULL;
        char buffer[128];
        int i, n;

        name = ssh_userauth_kbdint_getname(session);
        instruction = ssh_userauth_kbdint_getinstruction(session);
        n = ssh_userauth_kbdint_getnprompts(session);

        if (name && strlen(name) > 0) {
            printf("%s\n", name);
        }

        if (instruction && strlen(instruction) > 0) {
            printf("%s\n", instruction);
        }

        for (i = 0; i < n; i++) {
            const char *answer = NULL;
            const char *prompt = NULL;
            char echo;

            prompt = ssh_userauth_kbdint_getprompt(session, i, &echo);
            if (prompt == NULL) {
                break;
            }

            if (echo) {
                char *p = NULL;

                printf("%s", prompt);

                if (fgets(buffer, sizeof(buffer), stdin) == NULL) {
                    return SSH_AUTH_ERROR;
                }

                if ((p = strchr(buffer, '\n'))) {
                    *p = '\0';
                }

                if (ssh_userauth_kbdint_setanswer(session, i, buffer) < 0) {
                    return SSH_AUTH_ERROR;
                }

                memset(buffer, 0, sizeof(buffer));
            } else {
                if (password && strstr(prompt, "Password:")) {
                    answer = password;
                } else {
                    buffer[0] = '\0';

                    if (ssh_getpass(prompt, buffer, sizeof(buffer), 0, 0) < 0) {
                        return SSH_AUTH_ERROR;
                    }
                    answer = buffer;
                }
                err = ssh_userauth_kbdint_setanswer(session, i, answer);
                memset(buffer, 0, sizeof(buffer));
                if (err < 0) {
                    return SSH_AUTH_ERROR;
                }
            }
        }
        err=ssh_userauth_kbdint(session,NULL,NULL);
    }

    return err;
}

static int auth_keyfile(ssh_session session, char* keyfile)
{
    ssh_key key = NULL;
    char pubkey[132] = {0}; // +".pub"
    int rc;

    snprintf(pubkey, sizeof(pubkey), "%s.pub", keyfile);

    rc = ssh_pki_import_pubkey_file( pubkey, &key);

    if (rc != SSH_OK)
        return SSH_AUTH_DENIED;

    rc = ssh_userauth_try_publickey(session, NULL, key);

    ssh_key_free(key);

    if (rc!=SSH_AUTH_SUCCESS)
        return SSH_AUTH_DENIED;

    rc = ssh_pki_import_privkey_file(keyfile, NULL, NULL, NULL, &key);

    if (rc != SSH_OK)
        return SSH_AUTH_DENIED;

    rc = ssh_userauth_publickey(session, NULL, key);

    ssh_key_free(key);

    return rc;
}


static void error(ssh_session session)
{
    fprintf(stderr,"Authentication failed: %s\n",ssh_get_error(session));
}

int authenticate_console(ssh_session session)
{
    int rc;
    int method;
    char password[128] = {0};
    char *banner = NULL;

    // Try to authenticate
    rc = ssh_userauth_none(session, NULL);
    if (rc == SSH_AUTH_ERROR || !ssh_is_connected(session)) {
        error(session);
        return rc;
    }

    method = ssh_userauth_list(session, NULL);
    while (rc != SSH_AUTH_SUCCESS) {
        if (method & SSH_AUTH_METHOD_GSSAPI_MIC){
            rc = ssh_userauth_gssapi(session);
            if (rc == SSH_AUTH_ERROR || !ssh_is_connected(session)) {
                error(session);
                return rc;
            } else if (rc == SSH_AUTH_SUCCESS) {
                break;
            }
        }
        // Try to authenticate with public key first
        if (method & SSH_AUTH_METHOD_PUBLICKEY) {
            rc = ssh_userauth_publickey_auto(session, NULL, NULL);
            if (rc == SSH_AUTH_ERROR || !ssh_is_connected(session)) {
                error(session);
                return rc;
            } else if (rc == SSH_AUTH_SUCCESS) {
                break;
            }
        }
        {
            char buffer[128] = {0};
            char *p = NULL;

            printf("Automatic pubkey failed. "
                   "Do you want to try a specific key? (y/n)\n");
            if (fgets(buffer, sizeof(buffer), stdin) == NULL) {
                break;
            }
            if ((buffer[0]=='Y') || (buffer[0]=='y')) {
                printf("private key filename: ");

                if (fgets(buffer, sizeof(buffer), stdin) == NULL) {
                    return SSH_AUTH_ERROR;
                }

                buffer[sizeof(buffer) - 1] = '\0';
                if ((p = strchr(buffer, '\n'))) {
                    *p = '\0';
                }

                rc = auth_keyfile(session, buffer);

                if(rc == SSH_AUTH_SUCCESS) {
                    break;
                }
                fprintf(stderr, "failed with key\n");
            }
        }

        // Try to authenticate with keyboard interactive";
        if (method & SSH_AUTH_METHOD_INTERACTIVE) {
            rc = authenticate_kbdint(session, NULL);
            if (rc == SSH_AUTH_ERROR || !ssh_is_connected(session)) {
                error(session);
                return rc;
            } else if (rc == SSH_AUTH_SUCCESS) {
                break;
            }
        }

        if (ssh_getpass("Password: ", password, sizeof(password), 0, 0) < 0) {
            return SSH_AUTH_ERROR;
        }

        // Try to authenticate with password
        if (method & SSH_AUTH_METHOD_PASSWORD) {
            rc = ssh_userauth_password(session, NULL, password);
            if (rc == SSH_AUTH_ERROR || !ssh_is_connected(session)) {
                error(session);
                return rc;
            } else if (rc == SSH_AUTH_SUCCESS) {
                break;
            }
        }
        memset(password, 0, sizeof(password));
    }

    banner = ssh_get_issue_banner(session);
    if (banner) {
        printf("%s\n",banner);
        SSH_STRING_FREE_CHAR(banner);
    }

    return rc;
}

/* ═══════════════════════════════════════════════════════════════
 * 演示层（非 libssh 代码）：库边界别名 + 项目注解的两层机制示例。
 *
 * 库边界别名（.progmune_aliases.json）：ssh_userauth_password → verify_password
 *   ——跨项目迁移（孵化器燃料）：任何用 libssh 的项目获得该桥接。
 * 项目注解（本文件）：start_channel_session 是应用层的 establish 原语
 *   ——项目内语义，不迁移。
 *
 * 已知边界（见 REALWORLD_C_V3.md）：
 *   - 多机制认证重试循环（authenticate_console 的 while 循环）只映射
 *     终端机制 ssh_userauth_password——verify_password 的 pre 不可重入，
 *     全机制映射会在正常重试流上产生误报（状态机「尝试-重试」语义缺口）。
 * ═══════════════════════════════════════════════════════════════ */

/* @progmune(namespace="auth", pre=["PASSWORD_VERIFIED"], post=["SESSION_ACTIVE"]) */
void start_channel_session(ssh_session session) {
    ssh_channel channel = ssh_channel_new(session);
    ssh_channel_open_session(channel);
}

/* 合法流：先认证再开通道 */
void connect_flow_good(ssh_session session, const char *user, const char *pass) {
    if (ssh_userauth_password(session, user, pass) == SSH_AUTH_SUCCESS) {
        start_channel_session(session);
    }
}

/* 植入违规：未认证直接开通道（经典 missing-auth） */
void connect_flow_no_auth(ssh_session session) {
    start_channel_session(session);
}
