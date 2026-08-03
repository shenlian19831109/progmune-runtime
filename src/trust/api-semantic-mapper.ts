/**
 * Phase 1: API → Protocol Semantic Mapper
 *
 * Maps concrete library API calls (curl, libssh, etc.) to abstract protocol
 * semantic categories. LLM does NOT do verification — it only does "translation".
 *
 * Architecture:
 *   Call Sequence (raw API names)
 *     → Prefix-based lookup table (fast, deterministic)
 *     → LLM fallback for unknown APIs (cached)
 *     → SemanticCategory[]
 *
 * Categories are deliberately coarse-grained — just enough for the protocol
 * domain validator to determine "is this a valid protocol operation?"
 */

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

/** Protocol domain — which protocol subsystem a call belongs to */
export type ProtocolDomain =
  | "tls_config"       // TLS/SSL configuration & filter management
  | "tls_handshake"    // TLS handshake execution
  | "tls_cert"         // Certificate loading, verification, storage
  | "tls_session"      // Session cache, resumption
  | "tls_alpn"         // ALPN protocol negotiation
  | "auth_cred"        // Credential retrieval (user, password, token)
  | "auth_mech"        // Authentication mechanism selection & negotiation
  | "auth_hash"        // Cryptographic hash for auth (MD5, SHA, NTLM)
  | "auth_spn"         // Service Principal Name (Kerberos/SSPI)
  | "auth_gssapi"      // GSSAPI wrap/unwrap operations
  | "ldap_ops"         // LDAP protocol operations
  | "ftp_ops"          // FTP protocol operations
  | "smtp_ops"         // SMTP protocol operations
  | "imap_ops"         // IMAP protocol operations
  | "mqtt_ops"         // MQTT protocol operations
  | "smb_ops"          // SMB protocol operations
  | "ssh_ops"          // SSH/SFTP protocol operations
  | "telnet_ops"       // Telnet protocol operations
  | "dns_ops"          // DNS/DoH operations
  | "http_ops"         // HTTP request/response/header operations
  | "http2_ops"        // HTTP/2 session operations
  | "conn_mgmt"        // Connection lifecycle (connect, close, metadata)
  | "conn_poll"        // Connection polling & event loop
  | "mem_alloc"        // Memory allocation
  | "mem_free"         // Memory deallocation
  | "mem_util"         // Memory utilities (memset, memcpy, memcmp)
  | "str_util"         // String utilities (strlen, strcmp, strchr)
  | "str_format"       // String formatting (printf, msnprintf)
  | "buf_util"         // Buffer/dynamic string utilities
  | "net_util"         // Network byte order, socket utilities
  | "platform_util"    // Platform-specific utilities (Windows, macOS)
  | "debug_trace"      // Debug, logging, tracing
  | "error_handle"     // Error handling (strerror, GetLastError)
  | "util"             // Generic utility
  ;

export interface SemanticStep {
  /** Original API name */
  api: string;
  /** Mapped protocol domain */
  domain: ProtocolDomain;
  /** Human-readable description of what this API does at the protocol level */
  description: string;
  /** Whether this mapping came from the lookup table or LLM fallback */
  source: "lookup" | "llm";
}

export interface SemanticSequence {
  steps: SemanticStep[];
  /** All unique domains present in this sequence */
  domains: ProtocolDomain[];
  /** The primary (dominant) domain of this sequence */
  primaryDomain: ProtocolDomain | null;
}

// ═══════════════════════════════════════════════════════════════
// Prefix-based Mapping Table
// ═══════════════════════════════════════════════════════════════

interface MappingRule {
  /** Prefix pattern (case-insensitive match against API name) */
  prefix: string;
  domain: ProtocolDomain;
  description: string;
}

/**
 * Mapping rules ordered by specificity (longer/more specific prefixes first).
 * Covers curl, OpenSSL, wolfSSL, mbedTLS, GnuTLS, Rustls, Schannel,
 * SecureTransport (Apple), libssh2, nghttp2, LDAP, SASL, SSPI, GSSAPI, etc.
 */
const MAPPING_TABLE: MappingRule[] = [
  // ── TLS Configuration ──
  { prefix: "Curl_ssl_cf_get_primary_config", domain: "tls_config", description: "获取 TLS 主配置" },
  { prefix: "Curl_ssl_cf_get_config", domain: "tls_config", description: "获取 TLS SSL 配置" },
  { prefix: "Curl_ssl_cf_is_proxy", domain: "tls_config", description: "判断 TLS 是否为代理连接" },
  { prefix: "Curl_ssl_cfilter_add", domain: "tls_config", description: "添加 SSL 过滤层到连接" },
  { prefix: "Curl_conn_is_ssl", domain: "tls_config", description: "判断连接是否已 SSL" },
  { prefix: "Curl_tls_keylog_enabled", domain: "tls_config", description: "TLS keylog 启用检查" },
  { prefix: "Curl_ssl_scache_use", domain: "tls_session", description: "判断是否使用 SSL session cache" },
  { prefix: "Curl_ssl_scache_lock", domain: "tls_session", description: "SSL session cache 加锁" },
  { prefix: "Curl_ssl_scache_unlock", domain: "tls_session", description: "SSL session cache 解锁" },
  { prefix: "Curl_ssl_scache_get_obj", domain: "tls_session", description: "从 cache 获取 SSL session 对象" },
  { prefix: "Curl_ssl_scache_take", domain: "tls_session", description: "从 session cache 取出条目" },

  // ── TLS ALPN ──
  { prefix: "Curl_alpn_copy", domain: "tls_alpn", description: "ALPN 协议列表复制" },
  { prefix: "Curl_alpn_contains_proto", domain: "tls_alpn", description: "检查 ALPN 是否包含某协议" },
  { prefix: "Curl_alpn_restrict_to", domain: "tls_alpn", description: "限制 ALPN 协议范围" },
  { prefix: "Curl_alpn_to_proto_buf", domain: "tls_alpn", description: "ALPN 转协议缓冲" },
  { prefix: "Curl_str2alpnid", domain: "tls_alpn", description: "字符串转 ALPN ID" },

  // ── TLS Handshake (OpenSSL) ──
  { prefix: "SSL_CTX_set_default_passwd_cb", domain: "tls_cert", description: "SSL_CTX 设置密码回调" },
  { prefix: "SSL_CTX_set_default_passwd_cb_userdata", domain: "tls_cert", description: "SSL_CTX 设置密码回调用户数据" },
  { prefix: "SSL_CTX_use_certificate_chain_file", domain: "tls_cert", description: "SSL_CTX 加载证书链文件" },
  { prefix: "SSL_CTX_use_certificate_file", domain: "tls_cert", description: "SSL_CTX 加载证书文件" },
  { prefix: "SSL_CTX_get_cert_store", domain: "tls_cert", description: "SSL_CTX 获取证书存储" },
  { prefix: "SSL_set_session", domain: "tls_session", description: "设置 SSL session" },
  { prefix: "SSL_get_tlsext_status_ocsp_resp", domain: "tls_cert", description: "获取 OCSP stapling 响应" },
  { prefix: "SSL_get_peer_cert_chain", domain: "tls_cert", description: "获取对端证书链" },
  { prefix: "SSL_get1_peer_certificate", domain: "tls_cert", description: "获取对端证书" },
  { prefix: "d2i_SSL_SESSION", domain: "tls_session", description: "DER 解码 SSL session" },
  { prefix: "d2i_PKCS12_bio", domain: "tls_cert", description: "DER 解码 PKCS12 证书" },
  { prefix: "d2i_OCSP_RESPONSE", domain: "tls_cert", description: "DER 解码 OCSP 响应" },
  { prefix: "OCSP_response_status", domain: "tls_cert", description: "OCSP 响应状态" },
  { prefix: "OCSP_response_status_str", domain: "tls_cert", description: "OCSP 响应状态字符串" },
  { prefix: "OCSP_response_get1_basic", domain: "tls_cert", description: "OCSP 获取基本响应" },
  { prefix: "OCSP_basic_verify", domain: "tls_cert", description: "OCSP 基本响应验证" },
  { prefix: "ossl_do_file_type", domain: "tls_cert", description: "OpenSSL 文件类型处理" },
  { prefix: "ossl_strerror", domain: "error_handle", description: "OpenSSL 错误信息" },
  { prefix: "ERR_get_error", domain: "error_handle", description: "OpenSSL 获取错误码" },
  { prefix: "BIO_new_mem_buf", domain: "tls_cert", description: "BIO 内存缓冲创建" },
  { prefix: "BIO_new", domain: "tls_cert", description: "BIO 创建" },
  { prefix: "BIO_s_file", domain: "tls_cert", description: "BIO 文件接口" },
  { prefix: "BIO_read_filename", domain: "tls_cert", description: "BIO 读取文件名" },
  { prefix: "BIO_free", domain: "tls_cert", description: "BIO 释放" },
  { prefix: "X509_get_ext_d2i", domain: "tls_cert", description: "X509 扩展解码" },
  { prefix: "sk_GENERAL_NAME_", domain: "tls_cert", description: "X509 SAN 扩展操作" },
  { prefix: "ASN1_STRING_", domain: "tls_cert", description: "ASN1 字符串操作" },
  { prefix: "STACK_OF", domain: "tls_cert", description: "OpenSSL STACK 类型" },

  // ── TLS Handshake (wolfSSL) ──
  { prefix: "wolfTLS_client_method", domain: "tls_handshake", description: "wolfSSL 客户端方法" },
  { prefix: "wolfSSL_CTX_free", domain: "tls_handshake", description: "wolfSSL 释放 CTX" },
  { prefix: "wolfSSL_CTX_new", domain: "tls_handshake", description: "wolfSSL 创建 CTX" },
  { prefix: "wolfSSL_connect", domain: "tls_handshake", description: "wolfSSL TLS 连接" },
  { prefix: "wolfSSL_ERR_clear_error", domain: "error_handle", description: "wolfSSL 清除错误" },
  { prefix: "wolfSSL_want_read", domain: "tls_handshake", description: "wolfSSL 读就绪检查" },
  { prefix: "wssl_send_earlydata", domain: "tls_handshake", description: "wolfSSL TLS 1.3 early data" },
  { prefix: "wssl_init_ciphers", domain: "tls_config", description: "wolfSSL 初始化密码套件" },
  { prefix: "wssl_init_curves", domain: "tls_config", description: "wolfSSL 初始化椭圆曲线" },
  { prefix: "Curl_wssl_setup_x509_store", domain: "tls_cert", description: "wolfSSL 设置 X509 证书存储" },

  // ── TLS Handshake (mbedTLS) ──
  { prefix: "mbedtls_ssl_handshake", domain: "tls_handshake", description: "mbedTLS SSL 握手" },
  { prefix: "mbedtls_ssl_get_version_number", domain: "tls_handshake", description: "mbedTLS 获取 TLS 版本号" },
  { prefix: "mbedtls_ssl_get_version", domain: "tls_handshake", description: "mbedTLS 获取 TLS 版本字符串" },
  { prefix: "mbedtls_ssl_get_ciphersuite_id_from_ssl", domain: "tls_handshake", description: "mbedTLS 获取密码套件 ID" },
  { prefix: "mbedtls_ssl_get_peer_cert", domain: "tls_cert", description: "mbedTLS 获取对端证书" },
  { prefix: "mbedtls_strerror", domain: "error_handle", description: "mbedTLS 错误信息" },
  { prefix: "mbed_cipher_suite_get_str", domain: "tls_handshake", description: "mbedTLS 密码套件名称" },

  // ── TLS Handshake (GnuTLS) ──
  { prefix: "gtls_client_init", domain: "tls_handshake", description: "GnuTLS 客户端初始化" },
  { prefix: "gnutls_session_set_data", domain: "tls_session", description: "GnuTLS 设置 session 数据" },
  { prefix: "gnutls_session_set_ptr", domain: "tls_session", description: "GnuTLS 设置 session 指针" },
  { prefix: "gnutls_srp_allocate_client_credentials", domain: "auth_cred", description: "GnuTLS SRP 凭证分配" },
  { prefix: "gnutls_srp_allocate_client_cred", domain: "auth_cred", description: "GnuTLS SRP 凭证分配" },
  { prefix: "gnutls_srp_set_client_credentials", domain: "auth_cred", description: "GnuTLS SRP 设置凭证" },
  { prefix: "gnutls_srp_set_client_cred", domain: "auth_cred", description: "GnuTLS SRP 设置凭证" },
  { prefix: "gnutls_strerror", domain: "error_handle", description: "GnuTLS 错误信息" },

  // ── TLS Handshake (Rustls) ──
  { prefix: "cr_ech_need_httpsrr", domain: "tls_config", description: "Rustls ECH 检查" },
  { prefix: "cr_init_backend", domain: "tls_handshake", description: "Rustls 后端初始化" },
  { prefix: "cr_set_negotiated_alpn", domain: "tls_alpn", description: "Rustls 设置协商 ALPN" },
  { prefix: "cr_send", domain: "tls_handshake", description: "Rustls 发送数据" },
  { prefix: "rustls_connection_is_handshaking", domain: "tls_handshake", description: "Rustls 握手状态检查" },
  { prefix: "rustls_connection_get_protocol_version", domain: "tls_handshake", description: "Rustls 获取协议版本" },
  { prefix: "rustls_connection_get_negotiated_ciphersuite_name", domain: "tls_handshake", description: "Rustls 获取密码套件" },
  { prefix: "rustls_connection_get_negotiated_key_exchange_group_name", domain: "tls_handshake", description: "Rustls 获取密钥交换组" },

  // ── TLS Handshake (Schannel / Windows) ──
  { prefix: "schannel_acquire_credential_handle", domain: "tls_handshake", description: "Schannel 获取凭证句柄" },
  { prefix: "Curl_schannel_get_cached_cert_store", domain: "tls_cert", description: "Schannel 获取缓存证书存储" },
  { prefix: "Curl_sspi_strerror", domain: "error_handle", description: "SSPI 错误信息" },

  // ── TLS Handshake (Apple SecureTransport) ──
  { prefix: "SecPolicyCreateSSL", domain: "tls_config", description: "Apple: 创建 SSL 安全策略" },
  { prefix: "CFStringCreateWithCString", domain: "platform_util", description: "Apple CF 字符串创建" },
  { prefix: "CFArrayCreateMutable", domain: "platform_util", description: "Apple CF 数组创建" },
  { prefix: "CFArrayAppendValue", domain: "platform_util", description: "Apple CF 数组追加" },
  { prefix: "CFRelease", domain: "platform_util", description: "Apple CF 对象释放" },

  // ── TLS Session Cache ──
  { prefix: "cf_ssl_scache_get", domain: "tls_session", description: "SSL session cache 获取" },
  { prefix: "cf_ssl_scache_peer_set_hmac", domain: "tls_session", description: "SSL session cache HMAC 设置" },
  { prefix: "cf_scache_peer_remove_expired", domain: "tls_session", description: "SSL session cache 清理过期" },

  // ── Auth: Credentials ──
  { prefix: "Curl_creds_has_user", domain: "auth_cred", description: "认证: 检查是否有用户名" },
  { prefix: "Curl_creds_has_passwd", domain: "auth_cred", description: "认证: 检查是否有密码" },
  { prefix: "Curl_creds_has_sasl_service", domain: "auth_mech", description: "SASL: 检查是否有服务名" },
  { prefix: "Curl_creds_user", domain: "auth_cred", description: "认证: 获取用户名" },
  { prefix: "Curl_creds_passwd", domain: "auth_cred", description: "认证: 获取密码" },
  { prefix: "Curl_creds_sasl_service", domain: "auth_mech", description: "SASL: 获取服务名" },

  // ── Auth: SASL ──
  { prefix: "Curl_sasl_init", domain: "auth_mech", description: "SASL 初始化" },
  { prefix: "sasl_choose_", domain: "auth_mech", description: "SASL 机制选择" },
  { prefix: "Curl_auth_create_plain_message", domain: "auth_mech", description: "SASL PLAIN 消息创建" },
  { prefix: "Curl_auth_create_login_message", domain: "auth_mech", description: "SASL LOGIN 消息创建" },
  { prefix: "Curl_auth_create_external_message", domain: "auth_mech", description: "SASL EXTERNAL 消息创建" },
  { prefix: "Curl_auth_allowed_to_host", domain: "auth_mech", description: "检查认证是否允许到此主机" },
  { prefix: "Curl_auth_build_spn", domain: "auth_spn", description: "构建 Kerberos SPN" },
  { prefix: "Curl_auth_gsasl_get", domain: "auth_mech", description: "GSASL 认证获取" },
  { prefix: "sasl_state", domain: "auth_mech", description: "SASL 状态" },

  // ── Auth: NTLM ──
  { prefix: "Curl_ntlm_core_mk_nt_hash", domain: "auth_hash", description: "NTLM NT 哈希生成" },

  // ── Auth: DIGEST-MD5 ──
  { prefix: "auth_decode_digest_md5_message", domain: "auth_mech", description: "DIGEST-MD5 解码 challenge" },
  { prefix: "auth_digest_get_qop_values", domain: "auth_mech", description: "DIGEST-MD5 获取 QOP 值" },

  // ── Auth: GSSAPI/Kerberos ──
  { prefix: "gss_seal", domain: "auth_gssapi", description: "GSSAPI 封装消息" },
  { prefix: "gss_wrap", domain: "auth_gssapi", description: "GSSAPI 包装消息" },
  { prefix: "gss_unseal", domain: "auth_gssapi", description: "GSSAPI 解封消息" },
  { prefix: "gss_unwrap", domain: "auth_gssapi", description: "GSSAPI 解包消息" },
  { prefix: "Curl_gss_delete_sec_context", domain: "auth_gssapi", description: "GSSAPI 删除安全上下文" },
  { prefix: "check_gss_err", domain: "auth_gssapi", description: "GSSAPI 错误检查" },
  { prefix: "gss_indicate_mechs", domain: "auth_gssapi", description: "GSSAPI 指示可用机制" },
  { prefix: "gss_create_empty_oid_set", domain: "auth_gssapi", description: "GSSAPI 创建空 OID 集合" },
  { prefix: "gss_add_oid_set_member", domain: "auth_gssapi", description: "GSSAPI 添加 OID 成员" },
  { prefix: "gss_import_name", domain: "auth_gssapi", description: "GSSAPI 导入名称" },
  { prefix: "gss_acquire_cred", domain: "auth_gssapi", description: "GSSAPI 获取凭证" },
  { prefix: "gss_inquire_cred", domain: "auth_gssapi", description: "GSSAPI 查询凭证" },
  { prefix: "gss_inquire_cred_by_mech", domain: "auth_gssapi", description: "GSSAPI 按机制查询凭证" },
  { prefix: "GSS_ERROR", domain: "auth_gssapi", description: "GSSAPI 错误宏" },
  { prefix: "ssh_gssapi_", domain: "auth_gssapi", description: "SSH GSSAPI 操作" },

  // ── Auth: SSPI (Windows) ──
  { prefix: "QuerySecurityPackageInfo", domain: "auth_mech", description: "SSPI 查询安全包信息" },
  { prefix: "QueryContextAttributes", domain: "auth_mech", description: "SSPI 查询上下文属性" },
  { prefix: "FreeContextBuffer", domain: "mem_free", description: "SSPI 释放上下文缓冲" },
  { prefix: "Curl_create_sspi_identity", domain: "auth_mech", description: "SSPI 创建安全身份" },
  { prefix: "Curl_sspi_", domain: "auth_mech", description: "SSPI 操作" },

  // ── Auth: Hash/Crypto ──
  { prefix: "Curl_rand", domain: "auth_hash", description: "随机数生成 (auth nonce)" },
  { prefix: "Curl_rand_bytes", domain: "auth_hash", description: "随机字节生成" },
  { prefix: "Curl_rand_hex", domain: "auth_hash", description: "随机十六进制字符串" },
  { prefix: "Curl_MD5_init", domain: "auth_hash", description: "MD5 初始化" },
  { prefix: "Curl_MD5_update", domain: "auth_hash", description: "MD5 更新" },
  { prefix: "curlx_base64_encode", domain: "auth_hash", description: "Base64 编码 (凭证)" },

  // ── LDAP ──
  { prefix: "ldap_url_parse", domain: "ldap_ops", description: "LDAP URL 解析" },
  { prefix: "ldap_url_parse_low", domain: "ldap_ops", description: "LDAP URL 底层解析" },
  { prefix: "ldap_pvt_url_scheme2proto", domain: "ldap_ops", description: "LDAP URL scheme→协议" },
  { prefix: "ldap_result", domain: "ldap_ops", description: "LDAP 获取结果" },
  { prefix: "ldap_err2string", domain: "ldap_ops", description: "LDAP 错误码→字符串" },
  { prefix: "ldap_parse_result", domain: "ldap_ops", description: "LDAP 解析结果" },
  { prefix: "ldap_msgtype", domain: "ldap_ops", description: "LDAP 消息类型" },
  { prefix: "ldap_msgfree", domain: "ldap_ops", description: "LDAP 释放消息" },
  { prefix: "ldap_memfree", domain: "ldap_ops", description: "LDAP 释放内存" },
  { prefix: "ldap_set_option", domain: "ldap_ops", description: "LDAP 设置选项" },
  { prefix: "ldap_init_fd", domain: "ldap_ops", description: "LDAP 文件描述符初始化" },
  { prefix: "ldap_get_dn_ber", domain: "ldap_ops", description: "LDAP 获取 DN BER 编码" },
  { prefix: "oldap_parse_login_options", domain: "ldap_ops", description: "LDAP 解析登录选项" },
  { prefix: "oldap_map_error", domain: "ldap_ops", description: "LDAP 映射错误码" },
  { prefix: "oldap_perform_bind", domain: "ldap_ops", description: "LDAP 执行绑定" },

  // ── FTP ──
  { prefix: "ftp_readresp", domain: "ftp_ops", description: "FTP 读取响应" },
  { prefix: "ftp_wait_resp", domain: "ftp_ops", description: "FTP 等待响应" },

  // ── SMTP ──
  { prefix: "smtp_perform_upgrade_tls", domain: "smtp_ops", description: "SMTP 升级到 TLS" },
  { prefix: "smtp_state_", domain: "smtp_ops", description: "SMTP 协议状态" },

  // ── IMAP ──
  { prefix: "imap_perform_upgrade_tls", domain: "imap_ops", description: "IMAP 升级到 TLS" },
  { prefix: "imap_state_", domain: "imap_ops", description: "IMAP 协议状态" },
  { prefix: "imap_find_literal", domain: "imap_ops", description: "IMAP 查找 literal 边界" },
  { prefix: "imap_atom", domain: "imap_ops", description: "IMAP atom 令牌" },
  { prefix: "is_custom_fetch_listing", domain: "imap_ops", description: "IMAP 自定义 FETCH 列表" },

  // ── MQTT ──
  { prefix: "mqtt_send", domain: "mqtt_ops", description: "MQTT 发送消息" },
  { prefix: "mqtt_ping", domain: "mqtt_ops", description: "MQTT 心跳 PING" },
  { prefix: "mqstate", domain: "mqtt_ops", description: "MQTT 状态" },

  // ── SMB ──
  { prefix: "smb_send_tree_connect", domain: "smb_ops", description: "SMB 发送树连接" },
  { prefix: "smb_send_and_recv", domain: "smb_ops", description: "SMB 发送并接收" },
  { prefix: "smb_swap", domain: "smb_ops", description: "SMB 字节序转换" },

  // ── SSH/SFTP (libssh2) ──
  { prefix: "libssh2_crypto_engine", domain: "ssh_ops", description: "libssh2 加密引擎" },
  { prefix: "libssh2_session_init_ex", domain: "ssh_ops", description: "libssh2 会话初始化" },
  { prefix: "libssh2_session_set_read_timeout", domain: "ssh_ops", description: "libssh2 设置读超时" },
  { prefix: "libssh2_session_callback_set2", domain: "ssh_ops", description: "libssh2 设置回调" },
  { prefix: "recvcb", domain: "ssh_ops", description: "SSH 接收回调" },
  { prefix: "sendcb", domain: "ssh_ops", description: "SSH 发送回调" },
  { prefix: "libssh2_session_last_errno", domain: "ssh_ops", description: "libssh2 最后错误" },
  { prefix: "libssh2_sftp_", domain: "ssh_ops", description: "libssh2 SFTP 操作" },
  { prefix: "sftp_stat", domain: "ssh_ops", description: "SFTP 文件状态" },
  { prefix: "sftp_attributes_free", domain: "ssh_ops", description: "SFTP 释放属性" },
  { prefix: "sftp_open", domain: "ssh_ops", description: "SFTP 打开文件" },
  { prefix: "sftp_close", domain: "ssh_ops", description: "SFTP 关闭文件" },
  { prefix: "sftp_get_error", domain: "ssh_ops", description: "SFTP 获取错误" },
  { prefix: "myssh_to_ERROR", domain: "ssh_ops", description: "SSH 错误码映射" },
  { prefix: "myssh_to", domain: "ssh_ops", description: "SSH 错误码映射" },
  { prefix: "ssh_state_", domain: "ssh_ops", description: "SSH 协议状态" },
  { prefix: "ssh_agent_new", domain: "ssh_ops", description: "SSH agent 创建" },
  { prefix: "ssh_socket_new", domain: "ssh_ops", description: "SSH socket 创建" },
  { prefix: "ssh_channel_", domain: "ssh_ops", description: "SSH channel 操作" },

  // ── Telnet ──
  { prefix: "init_telnet", domain: "telnet_ops", description: "Telnet 初始化" },
  { prefix: "check_telnet_options", domain: "telnet_ops", description: "Telnet 选项检查" },

  // ── DNS/DoH ──
  { prefix: "doh_close", domain: "dns_ops", description: "DoH 关闭" },
  { prefix: "doh_resp_decode", domain: "dns_ops", description: "DoH 响应解码" },
  { prefix: "doh_strerror", domain: "dns_ops", description: "DoH 错误信息" },
  { prefix: "doh_type2name", domain: "dns_ops", description: "DoH 类型→名称" },
  { prefix: "de_init", domain: "dns_ops", description: "DoH 引擎初始化" },
  { prefix: "Curl_doh", domain: "dns_ops", description: "DoH 入口" },
  { prefix: "Curl_resolv_", domain: "dns_ops", description: "DNS 解析" },
  { prefix: "Curl_is_ipaddr", domain: "dns_ops", description: "判断是否 IP 地址" },
  { prefix: "Curl_str2addr", domain: "dns_ops", description: "字符串转地址" },
  { prefix: "get_localhost", domain: "dns_ops", description: "获取 localhost 地址" },
  { prefix: "hostip_async_new", domain: "dns_ops", description: "异步 DNS 查询" },
  { prefix: "Curl_host_is_ipnum", domain: "dns_ops", description: "判断主机名是否为 IP" },

  // ── HTTP ──
  { prefix: "Curl_http_neg_init", domain: "http_ops", description: "HTTP 协商初始化" },
  { prefix: "Curl_http_req_to_h2", domain: "http_ops", description: "HTTP/1→HTTP/2 请求转换" },
  { prefix: "Curl_h1_req_parse_read", domain: "http_ops", description: "HTTP/1 请求解析" },
  { prefix: "Curl_h1_req_parse_free", domain: "http_ops", description: "HTTP/1 请求解析释放" },
  { prefix: "Curl_checkheaders", domain: "http_ops", description: "HTTP 检查已有 headers" },
  { prefix: "Curl_checkProxyheaders", domain: "http_ops", description: "HTTP 检查代理 headers" },
  { prefix: "http_on_response", domain: "http_ops", description: "HTTP 响应回调" },
  { prefix: "http_target", domain: "http_ops", description: "HTTP 请求目标" },
  { prefix: "get_http_string", domain: "http_ops", description: "HTTP 字符串获取" },
  { prefix: "http2_data_setup", domain: "http2_ops", description: "HTTP/2 数据设置" },
  { prefix: "Curl_dynhds_init", domain: "http_ops", description: "HTTP headers 动态初始化" },
  { prefix: "Curl_dynhds_to_nva", domain: "http2_ops", description: "HTTP headers 转 nghttp2 nva" },
  { prefix: "h2_pri_spec", domain: "http2_ops", description: "HTTP/2 优先级" },
  { prefix: "nghttp2_session_", domain: "http2_ops", description: "nghttp2 session 操作" },
  { prefix: "nghttp2_session_check_request_allowed", domain: "http2_ops", description: "nghttp2 请求允许检查" },
  { prefix: "tunnel_stream_init", domain: "http2_ops", description: "HTTP/2 tunnel 流初始化" },

  // ── MIME ──
  { prefix: "IS_MIME_POST", domain: "http_ops", description: "MIME POST 判断" },
  { prefix: "curl_mime_headers", domain: "http_ops", description: "MIME headers 获取" },
  { prefix: "Curl_mime_prepare_headers", domain: "http_ops", description: "MIME headers 准备" },
  { prefix: "Curl_mime_add_header", domain: "http_ops", description: "MIME header 添加" },

  // ── Connection Management ──
  { prefix: "Curl_conn_meta_get", domain: "conn_mgmt", description: "连接元数据获取" },
  { prefix: "Curl_conn_meta_set", domain: "conn_mgmt", description: "连接元数据设置" },
  { prefix: "Curl_conn_get_origin", domain: "conn_mgmt", description: "获取连接原始地址" },
  { prefix: "Curl_conn_get_ip_info", domain: "conn_mgmt", description: "获取连接 IP 信息" },
  { prefix: "Curl_conn_get_current_host", domain: "conn_mgmt", description: "获取当前主机" },
  { prefix: "Curl_conn_connect", domain: "conn_mgmt", description: "建立连接" },
  { prefix: "do_connect", domain: "conn_mgmt", description: "执行连接 (含 TLS 握手)" },
  { prefix: "Curl_conn_is_ssl", domain: "conn_mgmt", description: "判断是否 SSL 连接" },
  { prefix: "Curl_conn_cf_get_transport", domain: "conn_mgmt", description: "获取传输层" },
  { prefix: "Curl_conn_needs_flush", domain: "conn_mgmt", description: "连接刷新检查" },
  { prefix: "Curl_conn_flush", domain: "conn_mgmt", description: "连接刷新" },
  { prefix: "Curl_conn_cntrl_update_info", domain: "conn_mgmt", description: "连接控制信息更新" },
  { prefix: "Curl_conn_dns_resolved_https", domain: "conn_mgmt", description: "DNS 已解析 HTTPS 记录" },
  { prefix: "Curl_detach_connection", domain: "conn_mgmt", description: "分离连接" },

  // ── Connection Poll/Event ──
  { prefix: "Curl_pollset_", domain: "conn_poll", description: "连接轮询集操作" },
  { prefix: "Curl_pollfds_init", domain: "conn_poll", description: "pollfd 初始化" },
  { prefix: "multi_now", domain: "conn_poll", description: "multi 当前时间" },
  { prefix: "multi_perform", domain: "conn_poll", description: "multi 执行" },
  { prefix: "multi_runsingle", domain: "conn_poll", description: "multi 单次运行" },
  { prefix: "multi_done", domain: "conn_poll", description: "multi 完成" },
  { prefix: "multi_assess_wakeup", domain: "conn_poll", description: "multi 唤醒评估" },
  { prefix: "Curl_multi_ev_assess", domain: "conn_poll", description: "multi 事件评估" },
  { prefix: "Curl_multi_ev_", domain: "conn_poll", description: "multi 事件操作" },
  { prefix: "Curl_multi_get_easy", domain: "conn_poll", description: "multi 获取 easy handle" },
  { prefix: "Curl_multi_xfers_running", domain: "conn_poll", description: "multi 活跃传输计数" },
  { prefix: "Curl_update_timer", domain: "conn_poll", description: "更新定时器" },
  { prefix: "curl_multi_socket_action", domain: "conn_poll", description: "multi socket 动作" },
  { prefix: "curl_multi_remove_handle", domain: "conn_poll", description: "multi 移除 handle" },
  { prefix: "curl_multi_cleanup", domain: "conn_poll", description: "multi 清理" },
  { prefix: "curl_easy_perform", domain: "conn_poll", description: "easy 执行" },
  { prefix: "sigpipe_init", domain: "conn_poll", description: "SIGPIPE 初始化" },
  { prefix: "sigpipe_restore", domain: "conn_poll", description: "SIGPIPE 恢复" },
  { prefix: "Curl_expire", domain: "conn_poll", description: "设置超时" },
  { prefix: "Curl_expire_clear", domain: "conn_poll", description: "清除超时" },
  { prefix: "conn_report_connect_stats", domain: "conn_poll", description: "连接统计报告" },

  // ── Transfer/Reader ──
  { prefix: "Curl_xfer_recv", domain: "conn_mgmt", description: "传输层接收" },
  { prefix: "Curl_client_write", domain: "conn_mgmt", description: "客户端写入" },
  { prefix: "client_write", domain: "conn_mgmt", description: "客户端写入 (协议层)" },
  { prefix: "Curl_creader_set_mime", domain: "http_ops", description: "读取器设置 MIME" },
  { prefix: "Curl_creader_client_length", domain: "http_ops", description: "读取器客户端长度" },
  { prefix: "Curl_creader_set_fread", domain: "http_ops", description: "读取器设置文件读取" },
  { prefix: "Curl_pp_flushsend", domain: "conn_mgmt", description: "协议层刷新发送缓冲" },
  { prefix: "Curl_pp_readresp", domain: "conn_mgmt", description: "协议层读取响应" },
  { prefix: "Curl_pgrs_now", domain: "conn_mgmt", description: "进度当前时间" },
  { prefix: "Curl_pgrsSetUploadSize", domain: "conn_mgmt", description: "进度设置上传大小" },

  // ── Memory Operations ──
  { prefix: "curlx_malloc", domain: "mem_alloc", description: "curl 内存分配" },
  { prefix: "curlx_calloc", domain: "mem_alloc", description: "curl 零初始化分配" },
  { prefix: "curlx_free", domain: "mem_free", description: "curl 内存释放" },
  { prefix: "curlx_safefree", domain: "mem_free", description: "curl 安全释放" },
  { prefix: "curlx_memdup", domain: "mem_util", description: "curl 内存复制" },
  { prefix: "curlx_memdup0", domain: "mem_util", description: "curl 内存复制+零终止" },
  { prefix: "memset", domain: "mem_util", description: "内存设置" },
  { prefix: "memcpy", domain: "mem_util", description: "内存复制" },
  { prefix: "memcmp", domain: "mem_util", description: "内存比较" },
  { prefix: "memchr", domain: "mem_util", description: "内存字符查找" },
  { prefix: "calloc", domain: "mem_alloc", description: "标准零初始化分配" },
  { prefix: "malloc", domain: "mem_alloc", description: "标准内存分配" },

  // ── String Operations ──
  { prefix: "strlen", domain: "str_util", description: "字符串长度" },
  { prefix: "strcmp", domain: "str_util", description: "字符串比较" },
  { prefix: "strcasecmp", domain: "str_util", description: "字符串忽略大小写比较" },
  { prefix: "strncmp", domain: "str_util", description: "字符串定长比较" },
  { prefix: "strchr", domain: "str_util", description: "字符串字符查找" },
  { prefix: "strcspn", domain: "str_util", description: "字符串跨度" },
  { prefix: "strrchr", domain: "str_util", description: "字符串反向字符查找" },
  { prefix: "strstr", domain: "str_util", description: "字符串子串查找" },
  { prefix: "curl_strequal", domain: "str_util", description: "curl 字符串相等" },
  { prefix: "curlx_str_", domain: "str_util", description: "curl 字符串工具" },
  { prefix: "curlx_dyn_init", domain: "buf_util", description: "动态缓冲初始化" },
  { prefix: "curlx_dyn_free", domain: "buf_util", description: "动态缓冲释放" },
  { prefix: "curlx_dyn_add", domain: "buf_util", description: "动态缓冲追加" },
  { prefix: "curlx_dyn_addn", domain: "buf_util", description: "动态缓冲追加 n 字节" },
  { prefix: "curlx_dyn_addf", domain: "buf_util", description: "动态缓冲格式化追加" },
  { prefix: "curlx_dyn_reset", domain: "buf_util", description: "动态缓冲重置" },
  { prefix: "curlx_dyn_ptr", domain: "buf_util", description: "动态缓冲获取指针" },
  { prefix: "curlx_dyn_len", domain: "buf_util", description: "动态缓冲获取长度" },
  { prefix: "curlx_dyn_uptr", domain: "buf_util", description: "动态缓冲获取无符号指针" },
  { prefix: "curl_msnprintf", domain: "str_format", description: "curl 格式化输出" },
  { prefix: "curl_maprintf", domain: "str_format", description: "curl 格式化分配" },
  { prefix: "curlx_convert_UTF8_to_tchar", domain: "platform_util", description: "UTF8→TCHAR 编码转换" },

  // ── Buffer/URL ──
  { prefix: "Curl_bufref_ptr", domain: "buf_util", description: "缓冲引用获取指针" },
  { prefix: "Curl_bufref_set", domain: "buf_util", description: "缓冲引用设置" },
  { prefix: "Curl_bufref_free", domain: "buf_util", description: "缓冲引用释放" },
  { prefix: "Curl_bufref_init", domain: "buf_util", description: "缓冲引用初始化" },
  { prefix: "Curl_bufq_init", domain: "buf_util", description: "缓冲队列初始化" },
  { prefix: "curl_url", domain: "buf_util", description: "URL 对象创建" },
  { prefix: "curl_url_set", domain: "buf_util", description: "URL 设置" },
  { prefix: "curl_url_get", domain: "buf_util", description: "URL 获取" },
  { prefix: "curl_url_cleanup", domain: "buf_util", description: "URL 清理" },
  { prefix: "curl_url_strerror", domain: "buf_util", description: "URL 错误信息" },
  { prefix: "Curl_is_absolute_url", domain: "buf_util", description: "URL 绝对路径判断" },
  { prefix: "Curl_uc_to_curlcode", domain: "buf_util", description: "URL 错误码转换" },

  // ── Network Utilities ──
  { prefix: "htonl", domain: "net_util", description: "主机→网络字节序 (32-bit)" },
  { prefix: "htons", domain: "net_util", description: "主机→网络字节序 (16-bit)" },
  { prefix: "ntohl", domain: "net_util", description: "网络→主机字节序 (32-bit)" },
  { prefix: "ntohs", domain: "net_util", description: "网络→主机字节序 (16-bit)" },
  { prefix: "setsockopt", domain: "net_util", description: "socket 选项设置" },
  { prefix: "getsockname", domain: "net_util", description: "获取 socket 名称" },
  { prefix: "curlx_nonblock", domain: "net_util", description: "设置非阻塞" },
  { prefix: "curlx_inet_pton", domain: "net_util", description: "IP 地址转换" },

  // ── Platform Utilities ──
  { prefix: "curlx_verify_windows_version", domain: "platform_util", description: "Windows 版本检查" },
  { prefix: "curlx_winapi_strerror", domain: "error_handle", description: "Windows API 错误信息" },
  { prefix: "GetLastError", domain: "error_handle", description: "Windows 最后错误" },
  { prefix: "GetStdHandle", domain: "platform_util", description: "Windows 标准句柄" },
  { prefix: "GetSystemTimeAsFileTime", domain: "platform_util", description: "Windows 系统时间" },
  { prefix: "CompareFileTime", domain: "platform_util", description: "Windows 文件时间比较" },
  { prefix: "CertOpenSystemStoreA", domain: "tls_cert", description: "Windows 打开系统证书存储" },
  { prefix: "CertOpenStore", domain: "tls_cert", description: "Windows 打开证书存储" },
  { prefix: "CertEnumCertificatesInStore", domain: "tls_cert", description: "Windows 枚举证书" },
  { prefix: "CertGetNameStringA", domain: "tls_cert", description: "Windows 获取证书名称" },
  { prefix: "CertGetNameString", domain: "tls_cert", description: "Windows 获取证书名称" },
  { prefix: "CertGetIntendedKeyUsage", domain: "tls_cert", description: "Windows 获取证书密钥用途" },
  { prefix: "WSACreateEvent", domain: "platform_util", description: "Windows WSA 事件创建" },
  { prefix: "WSAEventSelect", domain: "platform_util", description: "Windows WSA 事件选择" },
  { prefix: "WSACloseEvent", domain: "platform_util", description: "Windows WSA 事件关闭" },
  { prefix: "WaitForMultipleObjects", domain: "platform_util", description: "Windows 等待多个对象" },
  { prefix: "__builtin_available", domain: "platform_util", description: "macOS 版本检查" },

  // ── Debug/Trace ──
  { prefix: "CURL_TRC_CF", domain: "debug_trace", description: "连接过滤层跟踪" },
  { prefix: "CURL_TRC_M", domain: "debug_trace", description: "multi 跟踪" },
  { prefix: "CURL_TRC_DNS", domain: "debug_trace", description: "DNS 跟踪" },
  { prefix: "Curl_debug", domain: "debug_trace", description: "调试输出" },
  { prefix: "Curl_trc_ft_is_verbose", domain: "debug_trace", description: "跟踪详细检查" },
  { prefix: "VERBOSE", domain: "debug_trace", description: "详细日志宏" },
  { prefix: "infof", domain: "debug_trace", description: "信息日志" },

  // ── Meta/Generic ──
  { prefix: "Curl_meta_get", domain: "conn_mgmt", description: "元数据获取" },
  { prefix: "Curl_uint32_tbl_", domain: "util", description: "uint32 表操作" },
  { prefix: "Curl_uint32_bset_", domain: "util", description: "uint32 位集操作" },
  { prefix: "Curl_llist_init", domain: "util", description: "链表初始化" },
  { prefix: "Curl_llist_count", domain: "util", description: "链表计数" },
  { prefix: "Curl_llist_head", domain: "util", description: "链表头" },
  { prefix: "Curl_node_next", domain: "util", description: "链表下一节点" },
  { prefix: "Curl_node_elem", domain: "util", description: "链表节点元素" },
  { prefix: "GOOD_MULTI_HANDLE", domain: "util", description: "multi handle 断言" },
  { prefix: "GOOD_EASY_HANDLE", domain: "util", description: "easy handle 断言" },
  { prefix: "Curl_slist_append_nodup", domain: "util", description: "slist 去重追加" },
  { prefix: "Curl_secure_context", domain: "util", description: "安全上下文" },

  // ── Rfc/Conditional/Generic ──
  { prefix: "RFC2228", domain: "ftp_ops", description: "FTP 安全扩展 RFC2228" },
  { prefix: "USE_SSL", domain: "tls_config", description: "SSL 编译选项" },
  { prefix: "CURL_UNCONST", domain: "util", description: "const 转换宏" },
  { prefix: "STRCONST", domain: "util", description: "字符串常量宏" },
  { prefix: "TEXT", domain: "util", description: "Windows 宽字符宏" },
  { prefix: "FALLTHROUGH", domain: "util", description: "switch 穿透标记" },
  { prefix: "UNUSED", domain: "util", description: "未使用参数标记" },
  { prefix: "defined", domain: "util", description: "条件编译检查" },
  { prefix: "endif", domain: "util", description: "预处理结束" },
  { prefix: "CURL_SOCKET", domain: "net_util", description: "Socket 类型" },

  // ── File I/O ──
  { prefix: "curlx_fopen", domain: "util", description: "curl 文件打开" },
  { prefix: "curlx_fclose", domain: "util", description: "curl 文件关闭" },
  { prefix: "curlx_fstat", domain: "util", description: "curl 文件状态" },
  { prefix: "fopen", domain: "util", description: "文件打开" },
  { prefix: "fclose", domain: "util", description: "文件关闭" },
  { prefix: "fseek", domain: "util", description: "文件定位" },
  { prefix: "ftell", domain: "util", description: "文件位置" },
  { prefix: "fread", domain: "util", description: "文件读取" },
  { prefix: "fileno", domain: "util", description: "文件描述符" },

  // ── Time/Cookie/Etc ──
  { prefix: "Curl_meets_timecondition", domain: "util", description: "时间条件检查" },
  { prefix: "curlx_gmtime", domain: "util", description: "GMT 时间" },
  { prefix: "curlx_ptimediff_ms", domain: "util", description: "时间差毫秒" },
  { prefix: "time", domain: "util", description: "系统时间" },
  { prefix: "getenv", domain: "platform_util", description: "获取环境变量" },
  { prefix: "cookiehash", domain: "util", description: "Cookie 哈希" },
  { prefix: "cookie_tailmatch", domain: "util", description: "Cookie 尾部匹配" },
  { prefix: "remove_expired", domain: "util", description: "移除过期条目" },
  { prefix: "Curl_junkscan", domain: "buf_util", description: "URL junk 扫描" },
  { prefix: "guess_scheme", domain: "buf_util", description: "猜测 URL scheme" },
  { prefix: "parse_file", domain: "buf_util", description: "解析文件 URL" },
  { prefix: "parse_scheme", domain: "buf_util", description: "解析 scheme" },
  { prefix: "parse_authority", domain: "buf_util", description: "解析 authority" },
  { prefix: "tailmatch", domain: "str_util", description: "尾部匹配" },
  { prefix: "Curl_cert_hostcheck", domain: "tls_cert", description: "证书主机名验证" },
  { prefix: "cert_get_name_string", domain: "tls_cert", description: "证书名称获取" },
  { prefix: "get_cert_location", domain: "tls_cert", description: "证书位置获取" },
  { prefix: "get_num_host_info", domain: "tls_cert", description: "主机信息数量" },
  { prefix: "get_alt_name_info", domain: "tls_cert", description: "SAN 信息获取" },
  { prefix: "add_certs_data_to_store", domain: "tls_cert", description: "证书添加到存储" },
  { prefix: "ssl_installed", domain: "tls_config", description: "SSL 是否已安装" },
  { prefix: "ssl_version", domain: "tls_config", description: "SSL 版本" },
  { prefix: "engineload", domain: "tls_config", description: "OpenSSL 引擎加载" },
  { prefix: "use_certificate_chain_blob", domain: "tls_cert", description: "证书链 blob 加载" },
  { prefix: "use_certificate_blob", domain: "tls_cert", description: "证书 blob 加载" },
  { prefix: "sess_reuse_cb", domain: "tls_session", description: "Session 复用回调" },
  { prefix: "secrets", domain: "tls_handshake", description: "TLS 密钥材料" },
  { prefix: "handshake", domain: "tls_handshake", description: "TLS 握手标记" },

  // ── File upload ──
  { prefix: "file_upload", domain: "util", description: "文件上传" },
  { prefix: "S_ISDIR", domain: "util", description: "目录判断宏" },

  // ── Catch-all for unmapped but common patterns ──
  { prefix: "Curl_resolv_destroy_all", domain: "dns_ops", description: "DNS 解析器销毁" },
  { prefix: "Curl_req_free", domain: "http_ops", description: "HTTP 请求释放" },
  { prefix: "Curl_ssl_close_all", domain: "tls_config", description: "SSL 全部关闭" },
  { prefix: "Curl_wildcard_dtor", domain: "conn_mgmt", description: "通配符析构" },
  { prefix: "Curl_peer_unlink", domain: "conn_mgmt", description: "对端连接断开" },
  { prefix: "Curl_data_priority_clear_state", domain: "http_ops", description: "HTTP 数据优先级清理" },
  { prefix: "cf_ip_attempt_connect", domain: "conn_mgmt", description: "IP 连接尝试" },
  { prefix: "cf_ip_attempt_free", domain: "conn_mgmt", description: "IP 连接尝试释放" },
  { prefix: "cf_ai_iter_has_more", domain: "conn_mgmt", description: "地址迭代检查" },
  { prefix: "cf_ai_iter_next", domain: "conn_mgmt", description: "地址迭代下一个" },
  { prefix: "Curl_reset_fail", domain: "conn_mgmt", description: "连接失败重置" },
  { prefix: "multi_xfers_add", domain: "conn_poll", description: "multi 传输添加" },
  { prefix: "multi_mark_expired_as_dirty", domain: "conn_poll", description: "multi 过期标记" },
  { prefix: "connclose", domain: "conn_mgmt", description: "连接关闭标记" },
  { prefix: "streamclose", domain: "conn_mgmt", description: "流关闭" },
  { prefix: "request_state", domain: "conn_mgmt", description: "请求状态" },
  { prefix: "select", domain: "net_util", description: "I/O 多路复用" },
  { prefix: "altsvc_flush", domain: "http_ops", description: "Alt-Svc 刷新" },
  { prefix: "Curl_strntolower", domain: "str_util", description: "字符串转小写" },
  { prefix: "Curl_raw_toupper", domain: "str_util", description: "字符转大写" },
  { prefix: "Curl_ssl_cf_get_primary_config", domain: "tls_config", description: "获取 TLS 主配置" }, // duplicate guard
];

// Deduplicate: keep first (most specific) match
const seen = new Set<string>();
const DEDUPED_TABLE = MAPPING_TABLE.filter(rule => {
  if (seen.has(rule.prefix)) return false;
  seen.add(rule.prefix);
  return true;
});

// ═══════════════════════════════════════════════════════════════
// Core Mapping Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Map a single API name to its semantic category.
 * Uses prefix-based lookup (O(n) over ~300 rules, fast enough).
 * Falls back to "util" for unknown APIs.
 */
export function mapApiToSemantic(apiName: string): SemanticStep {
  const lower = apiName.toLowerCase();

  for (const rule of DEDUPED_TABLE) {
    if (lower.startsWith(rule.prefix.toLowerCase())) {
      return {
        api: apiName,
        domain: rule.domain,
        description: rule.description,
        source: "lookup",
      };
    }
  }

  // Fallback: unknown API
  return {
    api: apiName,
    domain: "util",
    description: `未知 API: ${apiName}`,
    source: "lookup", // will be "llm" when LLM fallback is implemented
  };
}

/**
 * Map a call sequence to a semantic sequence.
 */
export function mapSequenceToSemantic(calls: string[]): SemanticSequence {
  const steps = calls.map(mapApiToSemantic);
  const domainSet = new Set<ProtocolDomain>();
  const domainCounts = new Map<ProtocolDomain, number>();

  for (const step of steps) {
    domainSet.add(step.domain);
    domainCounts.set(step.domain, (domainCounts.get(step.domain) || 0) + 1);
  }

  // Determine primary domain (most frequent, excluding util/mem/str/platform)
  let primaryDomain: ProtocolDomain | null = null;
  let maxCount = 0;
  const noiseDomains: ProtocolDomain[] = ["util", "mem_alloc", "mem_free", "mem_util", "str_util", "str_format", "buf_util", "net_util", "platform_util", "debug_trace", "error_handle"];

  for (const [domain, count] of domainCounts) {
    if (!noiseDomains.includes(domain) && count > maxCount) {
      maxCount = count;
      primaryDomain = domain;
    }
  }

  return {
    steps,
    domains: [...domainSet],
    primaryDomain,
  };
}

// ═══════════════════════════════════════════════════════════════
// Phase 4: LLM Fallback + Persistent Cache
// ═══════════════════════════════════════════════════════════════

import * as fs from "fs";
import * as path from "path";

const CACHE_FILE = path.resolve(__dirname, "../../.progmune_generated/api-semantic-cache.json");

/** In-memory LLM result cache: apiName → SemanticStep */
const llmCache = new Map<string, SemanticStep>();

/** Load persisted cache from disk */
function loadLlmCache(): void {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
      for (const [key, value] of Object.entries(raw) as [string, any][]) {
        llmCache.set(key, value as SemanticStep);
      }
    }
  } catch { /* best-effort */ }
}

/** Persist in-memory cache to disk */
function saveLlmCache(): void {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj: Record<string, SemanticStep> = {};
    for (const [key, value] of llmCache) {
      obj[key] = value;
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), "utf-8");
  } catch { /* best-effort */ }
}

// Load cache on module init
loadLlmCache();

/** All valid protocol domains for the LLM prompt */
const ALL_DOMAINS: ProtocolDomain[] = [
  "tls_config", "tls_handshake", "tls_cert", "tls_session", "tls_alpn",
  "auth_cred", "auth_mech", "auth_hash", "auth_spn", "auth_gssapi",
  "ldap_ops", "ftp_ops", "smtp_ops", "imap_ops", "mqtt_ops", "smb_ops",
  "ssh_ops", "telnet_ops", "dns_ops", "http_ops", "http2_ops",
  "conn_mgmt", "conn_poll",
  "mem_alloc", "mem_free", "mem_util",
  "str_util", "str_format", "buf_util",
  "net_util", "platform_util", "debug_trace", "error_handle",
  "util",
];

const LLM_SYSTEM_PROMPT = `You are an API semantic classifier. Your ONLY job is to map function names to protocol domains.

Rules:
1. Output ONLY the domain name, nothing else. No explanation, no punctuation.
2. Choose from these domains: ${ALL_DOMAINS.join(", ")}
3. If unsure, output "util".
4. Use context clues: function name prefixes, library conventions, common patterns.
5. Examples:
   - axios.post → http_ops
   - bcrypt.hash → auth_hash
   - pg.connect → conn_mgmt
   - os.open → util
   - flask.route → http_ops
   - mysql.query → conn_mgmt
   - jwt.sign → auth_mech
   - socket.send → conn_mgmt
   - redis.get → conn_mgmt`;

/**
 * LLM fallback for unknown APIs.
 * Sends API name to LLM for semantic classification, caches result.
 */
export async function llmMapApiToSemantic(
  apiName: string,
  _context?: { surroundingCalls: string[] }
): Promise<SemanticStep> {
  // Check cache first (in-memory)
  const cacheKey = apiName.toLowerCase();
  const cached = llmCache.get(cacheKey);
  if (cached) return { ...cached, api: apiName };

  try {
    const { chat } = require("../llm");
    const result = await chat(
      LLM_SYSTEM_PROMPT,
      `Map this function to a protocol domain: ${apiName}`
    );

    // Parse: take first line, trim, lowercase, validate
    const rawDomain = result.trim().split("\n")[0].toLowerCase().replace(/[^a-z_]/g, "");
    const domain = ALL_DOMAINS.includes(rawDomain as ProtocolDomain)
      ? (rawDomain as ProtocolDomain)
      : "util";

    const step: SemanticStep = {
      api: apiName,
      domain,
      description: `LLM: ${apiName} → ${domain}`,
      source: "llm",
    };

    // Cache and persist
    llmCache.set(cacheKey, step);
    saveLlmCache();

    return step;
  } catch {
    // LLM unavailable — fall back to util
    return {
      api: apiName,
      domain: "util",
      description: `LLM unavailable: ${apiName}`,
      source: "lookup",
    };
  }
}

/**
 * Batch LLM mapping for multiple unknown APIs in one call.
 * Minimizes LLM round-trips.
 */
export async function llmBatchMapApis(
  apiNames: string[]
): Promise<Map<string, SemanticStep>> {
  const results = new Map<string, SemanticStep>();

  // Filter out already-cached
  const unknowns = apiNames.filter((name) => {
    const cached = llmCache.get(name.toLowerCase());
    if (cached) {
      results.set(name, { ...cached, api: name });
      return false;
    }
    return true;
  });

  if (unknowns.length === 0) return results;

  try {
    const { chat } = require("../llm");
    const prompt = unknowns.map((n, i) => `${i + 1}. ${n}`).join("\n");
    const response = await chat(
      LLM_SYSTEM_PROMPT + "\n\nOutput one domain per line, matching the input order. No numbering, no explanation.",
      `Map each function to ONE protocol domain:\n${prompt}`
    );

    const lines = response.trim().split("\n");
    for (let i = 0; i < unknowns.length; i++) {
      const rawDomain = (lines[i] || "util").trim().toLowerCase().replace(/[^a-z_]/g, "");
      const domain = ALL_DOMAINS.includes(rawDomain as ProtocolDomain)
        ? (rawDomain as ProtocolDomain)
        : "util";

      const step: SemanticStep = {
        api: unknowns[i],
        domain,
        description: `LLM: ${unknowns[i]} → ${domain}`,
        source: "llm",
      };

      const cacheKey = unknowns[i].toLowerCase();
      llmCache.set(cacheKey, step);
      results.set(unknowns[i], step);
    }

    saveLlmCache();
  } catch {
    // LLM unavailable — all unknowns → util
    for (const name of unknowns) {
      const step: SemanticStep = {
        api: name,
        domain: "util",
        description: `LLM unavailable: ${name}`,
        source: "lookup",
      };
      results.set(name, step);
    }
  }

  return results;
}

/**
 * Map a call sequence to semantic categories, using LLM fallback
 * for APIs not found in the lookup table.
 */
export async function mapSequenceToSemanticWithLLM(
  calls: string[]
): Promise<SemanticSequence> {
  // First pass: lookup table
  const steps: SemanticStep[] = calls.map(mapApiToSemantic);

  // Identify unknowns (mapped to "util" by lookup)
  const unknownIndices: number[] = [];
  const unknownApis: string[] = [];
  steps.forEach((s, i) => {
    if (s.domain === "util" && s.source === "lookup") {
      // Check if it's a common word that genuinely is util
      const isCommonWord = /^(buffer|bytes|block|files|directories|size|seek|writing|secrets|handshake|allowed|conditions|status|keys|accessed|delay|secret|startup|argument|info|time|proc|set|get|part|chars|name|type|state|data|list|are|hostname|scheme|literal|failed|defined|endif|VERBOSE|TEXT|STRCONST|CURL_UNCONST|FALLTHROUGH|UNUSED)$/i.test(s.api);
      if (!isCommonWord && s.api.length > 3) {
        unknownIndices.push(i);
        unknownApis.push(s.api);
      }
    }
  });

  // Second pass: LLM batch mapping for unknowns
  if (unknownApis.length > 0) {
    try {
      const llmResults = await llmBatchMapApis(unknownApis);
      for (let i = 0; i < unknownIndices.length; i++) {
        const apiName = unknownApis[i];
        const llmStep = llmResults.get(apiName);
        if (llmStep && llmStep.domain !== "util") {
          steps[unknownIndices[i]] = llmStep;
        }
      }
    } catch { /* LLM failed — keep lookup results */ }
  }

  // Compute domains and primary domain (same as sync version)
  const domainSet = new Set<ProtocolDomain>();
  const domainCounts = new Map<ProtocolDomain, number>();

  for (const step of steps) {
    domainSet.add(step.domain);
    domainCounts.set(step.domain, (domainCounts.get(step.domain) || 0) + 1);
  }

  let primaryDomain: ProtocolDomain | null = null;
  let maxCount = 0;
  const noiseDomains: ProtocolDomain[] = [
    "util", "mem_alloc", "mem_free", "mem_util",
    "str_util", "str_format", "buf_util", "net_util",
    "platform_util", "debug_trace", "error_handle",
  ];

  for (const [domain, count] of domainCounts) {
    if (!noiseDomains.includes(domain) && count > maxCount) {
      maxCount = count;
      primaryDomain = domain;
    }
  }

  return { steps, domains: [...domainSet], primaryDomain };
}

/**
 * Check if a semantic sequence belongs to a known protocol domain
 * (i.e., it has a clear primary domain that is not "util")
 */
export function isKnownProtocolDomain(seq: SemanticSequence): boolean {
  return seq.primaryDomain !== null && seq.primaryDomain !== "util";
}
