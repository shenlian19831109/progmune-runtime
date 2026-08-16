/**
 * Protocol State Machine Detector v2 — Repo-Agnostic
 *
 * All protocol patterns use \w* prefix/suffix patterns to match
 * any project's naming conventions (curl, nginx, redis, any C project).
 */

interface ProtocolStep { pattern: RegExp; label: string; required: boolean; }
interface ProtocolDefinition { name: string; category: string; steps: ProtocolStep[]; minCompleteness: number; }

const PROTOCOLS: ProtocolDefinition[] = [
  {
    name: "TLS Handshake", category: "ssl", minCompleteness: 0.5,
    steps: [
      { pattern: /\b(\w*ssl\w*init|\w*SSL\w*new|\w*ssl\w*create|\w*ssl\w*setup|\w*tls\w*init|\w*TLS\w*new|\w*ssl_cf_get_primary|\w*OPENSSL_init)\b/i, label: "tls_init", required: true },
      { pattern: /\b(\w*ssl\w*connect|\w*ssl\w*handshake|\w*tls\w*connect|\w*tls\w*handshake|\w*SSL_do_handshake)\b/i, label: "tls_connect", required: true },
      { pattern: /\b(\w*ssl\w*free|\w*SSL\w*cleanup|\w*ssl\w*shutdown|\w*tls\w*free|\w*SSL_CTX_free)\b/i, label: "tls_free", required: true },
    ],
  },
  {
    name: "SSH Connection", category: "ssh", minCompleteness: 0.4,
    steps: [
      { pattern: /\b(\w*ssh\w*init|ssh\w*setup|\w*ssh_state_init)\b/i, label: "ssh_init", required: true },
      { pattern: /\b(\w*ssh\w*auth|\w*ssh\w*login|\w*ssh\w*cred)\b/i, label: "ssh_auth", required: true },
      { pattern: /\b(\w*ssh\w*done|\w*ssh\w*close|\w*ssh\w*cleanup|\w*ssh\w*error|\w*ssh\w*finish|\w*ssh\w*free|\w*ssh\w*disconnect)\b/i, label: "ssh_done", required: true },
    ],
  },
  {
    name: "HTTP Request", category: "http", minCompleteness: 0.5,
    steps: [
      // init: handler setup, hook registration (nginx + Apache + curl)
      { pattern: /\b(\w*http\w*init|\w*http\w*create|\w*http\w*setup|\w*http\w*handler|\w*hook_handler|\w*hook_pre_config|curl_easy_init)\b/i, label: "http_init", required: true },
      // process: request handling (all naming conventions)
      { pattern: /\b(\w*http\w*perform|\w*http\w*send|\w*http\w*request|\w*http\w*process|\w*process_request|\w*run_method|curl_easy_perform|\w*http\w*response|ap_pass_brigade)\b/i, label: "http_send", required: true },
      // cleanup: finalize (all naming conventions)
      { pattern: /\b(\w*http\w*cleanup|\w*http\w*free|\w*http\w*close|\w*http\w*done|\w*finalize_request|curl_easy_cleanup|\w*http\w*finalize|ap_remove_output_filter)\b/i, label: "http_cleanup", required: true },
    ],
  },
  {
    name: "Connection Lifecycle", category: "connection", minCompleteness: 0.4,
    steps: [
      { pattern: /\b(\w*connect\b|\w*do_connect|\w*start_connect|\w*conn\w*init|\w*conn\w*setup)\b/i, label: "conn_init", required: true },
      { pattern: /\b(\w*send\b|\w*recv\b|\w*readwrite|\w*transfer|\w*xfer)\b/i, label: "conn_transfer", required: true },
      { pattern: /\b(\w*disconnect|\w*done\b|\w*conn\w*cleanup|\w*close_connection|\w*conn\w*free)\b/i, label: "conn_done", required: true },
    ],
  },
  {
    name: "Authentication", category: "auth", minCompleteness: 0.5,
    steps: [
      { pattern: /\b(\w*auth\w*init|\w*auth\w*create|\w*auth\w*ntlm|\w*auth\w*spnego|\w*auth\w*digest|\w*auth\w*plain|\w*auth\w*login)\b/i, label: "auth_init", required: true },
      { pattern: /\b(\w*auth\w*free|\w*auth\w*cleanup|\w*auth\w*delete|FreeContextBuffer|DeleteSecurityContext)\b/i, label: "auth_cleanup", required: true },
    ],
  },
  {
    name: "HTTP/2 Session", category: "http2", minCompleteness: 0.5,
    steps: [
      { pattern: /\b(\w*h2\w*init|\w*http2\w*init|\w*nghttp2_session_new)\b/i, label: "h2_init", required: true },
      { pattern: /\b(\w*h2\w*send|\w*http2\w*send|\w*nghttp2_submit|\w*nghttp2_session_send)\b/i, label: "h2_send", required: true },
      { pattern: /\b(\w*h2\w*close|\w*http2\w*free|\w*nghttp2_session_del)\b/i, label: "h2_close", required: true },
    ],
  },
  {
    name: "QUIC Connection", category: "connection", minCompleteness: 0.4,
    steps: [
      { pattern: /\b(\w*quic\w*init|\w*quic\w*new|\w*quiche_config_new)\b/i, label: "quic_init", required: true },
      { pattern: /\b(\w*quic\w*send|\w*quic\w*recv|\w*quiche_conn)\b/i, label: "quic_transfer", required: true },
    ],
  },
  {
    name: "SSL Configuration", category: "ssl", minCompleteness: 0.4,
    steps: [
      { pattern: /\b(\w*ssl\w*get_config|\w*ssl_cf_get|\w*ssl\w*setup|\w*ssl\w*seed)\b/i, label: "ssl_cfg_init", required: true },
      { pattern: /\b(\w*ssl\w*config|\w*ssl\w*set|\w*ssl\w*default|\w*ssl\w*init_method)\b/i, label: "ssl_cfg_apply", required: true },
      { pattern: /\b(\w*ssl\w*verify|\w*ssl\w*cert|\w*ssl\w*handshake|\w*ssl\w*connect)\b/i, label: "ssl_cfg_done", required: true },
    ],
  },
  {
    name: "Auth Protocol", category: "auth", minCompleteness: 0.5,
    steps: [
      { pattern: /\b(login|register|authenticate|signin)\b/i, label: "auth_login", required: true },
      { pattern: /\b(generate_token|generate_access_token|issue_token|create_session|jwt_sign)\b/i, label: "auth_token", required: true },
      { pattern: /\b(refresh_token|get_profile|access_resource|verify_token|authorize|access_token)\b/i, label: "auth_access", required: true },
      { pattern: /\b(logout|destroy_session|revoke_token|token_revoke|invalidate)\b/i, label: "auth_logout", required: true },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // P0 Injection: Payment Processing + Session Management detectors
  // ═══════════════════════════════════════════════════════════════
  {
    name: "Payment Processing", category: "payment", minCompleteness: 0.4,
    steps: [
      // init: payment intent creation (Stripe, PayPal, Braintree, generic)
      { pattern: /\b(\w*payment\w*intent|\w*payment\w*init|\w*pay\w*init|\w*pay\w*create|\w*create\w*payment|\w*create\w*order|\w*stripe\w*create|\w*paypal\w*create|\w*braintree\w*create|\w*checkout\w*create|\w*initiate\w*payment|\w*initiate\w*order)\b/i, label: "pay_init", required: true },
      // process: callback/webhook handling
      { pattern: /\b(\w*payment\w*callback|\w*webhook|\w*payment\w*confirm|\w*handle\w*webhook|\w*verify\w*signature|\w*validate\w*webhook|\w*stripe\w*webhook|\w*paypal\w*ipn|\w*callback\w*handler|\w*payment\w*success)\b/i, label: "pay_callback", required: true },
      // complete: confirm/capture
      { pattern: /\b(\w*payment\w*confirm|\w*capture\w*payment|\w*confirm\w*order|\w*payment\w*done|\w*payment\w*success|\w*order\w*complete|\w*payment\w*succeed)\b/i, label: "pay_done", required: true },
      // protect: signature verification (not required for minCompleteness)
      { pattern: /\b(\w*verify\w*sign|\w*check\w*sign|\w*validate\w*sign|\w*hmac\b|\w*webhook\w*secret|\w*stripe\w*sign|\w*paypal\w*verify|\w*verify\w*webhook\w*sign)\b/i, label: "pay_sig_check", required: false },
    ],
  },
  {
    name: "Session Management", category: "session", minCompleteness: 0.4,
    steps: [
      // create: session establishment
      { pattern: /\b(\w*session\w*create|\w*create\w*session|\w*session\w*init|\w*session\w*new|\w*session\w*start|\w*login\w*session|\w*init\w*session)\b/i, label: "sess_create", required: true },
      // validate: session check (middleware)
      { pattern: /\b(\w*session\w*check|\w*session\w*valid|\w*validate\w*session|\w*verify\w*session|\w*authenticate\w*session|\w*session\w*auth|\w*check\w*session|\w*get\w*session)\b/i, label: "sess_validate", required: true },
      // destroy: session termination/cleanup
      { pattern: /\b(\w*session\w*destroy|\w*session\w*delete|\w*session\w*revoke|\w*session\w*invalidate|\w*session\w*end|\w*session\w*logout|\w*session\w*signout|\w*session\w*expire|\w*session\w*timeout|\w*destroy\w*session|\w*cleanup\w*session|\w*purge\w*session)\b/i, label: "sess_destroy", required: true },
      // refresh: token/session refresh (not required for minCompleteness)
      { pattern: /\b(\w*session\w*refresh|\w*session\w*renew|\w*session\w*extend|\w*refresh\w*session|\w*rotate\w*token|\w*session\w*rotate|\w*renew\w*session)\b/i, label: "sess_refresh", required: false },
    ],
  },

  // ── P0 Round 2: Registration + File Upload + Resource Validation ──
  {
    name: "User Registration", category: "registration", minCompleteness: 0.4,
    steps: [
      { pattern: /\b(\w*register\w*user|\w*user\w*register|\w*signup|\w*sign\w*up|\w*create\w*account|\w*account\w*create|\w*registration\w*init|\w*registration\w*start)\b/i, label: "reg_init", required: true },
      { pattern: /\b(\w*send\w*(code|otp|token|verif|sms|email)|\w*(code|otp|token|verif|sms|email)\w*send|\w*verification\w*send|\w*send\w*verif)\b/i, label: "reg_send_code", required: true },
      { pattern: /\b(\w*verify\w*(code|otp|token|email)|\w*(code|otp|token)\w*verify|\w*confirm\w*(code|registration|account)|\w*validate\w*(code|token|verif))\b/i, label: "reg_verify", required: true },
      { pattern: /\b(\w*activ\w*account|\w*account\w*activ|\w*registration\w*complete|\w*registration\w*done|\w*registration\w*finish)\b/i, label: "reg_activate", required: false },
    ],
  },
  {
    name: "File Upload", category: "file_upload", minCompleteness: 0.4,
    steps: [
      { pattern: /\b(upload\w*file|file\w*upload|handle\w*upload|receive\w*upload|process\w*upload|multipart|form\w*data|upload\w*handler|upload\w*endpoint)\b/i, label: "up_receive", required: true },
      { pattern: /\b(\w*validate\w*file|\w*file\w*valid|\w*check\w*file\w*type|\w*check\w*file\w*size|\w*mime\w*check|\w*max\w*file\w*size|\w*allow\w*ext|\w*file\w*ext\w*check)\b/i, label: "up_validate", required: true },
      { pattern: /\b(\w*file\w*store|\w*store\w*file|\w*file\w*save|\w*save\w*file|\w*upload\w*to\w*cloud|\w*S3\w*upload|\w*cloud\w*upload)\b/i, label: "up_store", required: true },
      { pattern: /\b(\w*file\w*clean|\w*file\w*remove|\w*remove\w*file|\w*file\w*delete|\w*cleanup\w*upload|\w*upload\w*clean)\b/i, label: "up_cleanup", required: false },
    ],
  },
  {
    name: "Input Validation Chain", category: "resource", minCompleteness: 0.4,
    steps: [
      { pattern: /\b(\w*sanitize|\w*escape|\w*clean|\w*strip\w*tags|\w*html\w*escape|\w*xss\w*clean|\w*filter\w*input|\w*input\w*filter)\b/i, label: "res_sanitize", required: true },
      { pattern: /\b(\w*valid\w*type|\w*type\w*check|\w*check\w*type|\w*is_string|\w*is_number|\w*is_int|\w*is_bool|\w*type\w*of|\w*schema\w*valid|\w*valid\w*schema)\b/i, label: "res_validate", required: true },
      { pattern: /\b(\w*valid\w*range|\w*range\w*check|\w*min\w*length|\w*max\w*length|\w*min_value|\w*max_value|\w*length\w*check|\w*bound\w*check)\b/i, label: "res_range", required: false },
    ],
  },

  // ── P0 Round 3: api_gateway + notification + supplier + tls
  //              + data_integrity + dev_pipeline
  //              + printlab_order + printlab_print ──
  {
    name: "Rate Limiting", category: "api_gateway", minCompleteness: 0.4,
    steps: [
      { pattern: /\b(\w*rate\w*limit|\w*rate\w*check|\w*throttle\b|\w*check\w*rate|\w*quota\w*check|\w*concurrency\w*limit|\w*rate\w*limiter)\b/i, label: "rate_check", required: true },
      { pattern: /\b(\w*rate\w*exceed|rate\w*block|rate\w*reject|conn\w*limit|circuit\w*break|circuit\w*open|too\w*many\w*request)\b/i, label: "rate_block", required: true },
    ],
  },
  {
    name: "Notification Delivery", category: "notification", minCompleteness: 0.4,
    steps: [
      { pattern: /\b(\w*notif\w*compos|\w*compos\w*notif|\w*email\w*compos|\w*sms\w*compos|\w*push\w*compos|\w*notif\w*create|\w*notif\w*build|\w*build\w*notif)\b/i, label: "notif_compose", required: true },
      { pattern: /\b(\w*send\w*notif|\w*notif\w*send|\w*email\w*send|\w*sms\w*send|\w*push\w*send|\w*dispatch\w*notif|\w*notif\w*dispatch)\b/i, label: "notif_send", required: true },
      { pattern: /\b(\w*confirm\w*deliv|\w*deliv\w*confirm|\w*notif\w*ack|\w*notif\w*confirm|\w*send\w*confirm|\w*ack\w*deliv)\b/i, label: "notif_confirm", required: false },
    ],
  },
  {
    name: "Supplier Lifecycle", category: "supplier", minCompleteness: 0.4,
    steps: [
      { pattern: /\b(\w*supplier\w*regist|\w*regist\w*supplier|\w*vendor\w*regist|\w*partner\w*onboard|\w*onboard\w*partner|\w*supplier\w*create)\b/i, label: "sup_register", required: true },
      { pattern: /\b(\w*supplier\w*verif|\w*verif\w*supplier|\w*supplier\w*valid|\w*approve\w*supplier|\w*supplier\w*approve|\w*kyc\w*check)\b/i, label: "sup_verify", required: true },
      { pattern: /\b(\w*supplier\w*enabl|\w*enabl\w*supplier|\w*supplier\w*activ|\w*activ\w*supplier|\w*supplier\w*assign)\b/i, label: "sup_enable", required: true },
    ],
  },
  {
    name: "TLS Server Setup", category: "tls", minCompleteness: 0.4,
    steps: [
      { pattern: /\b(\w*tls\w*config|\w*ssl\w*config|\w*cert\w*load|\w*load\w*cert|\w*key\w*load|\w*tls\w*setup|\w*tls\w*init|\w*SSL_CTX\w*config)\b/i, label: "tls_config", required: true },
      { pattern: /\b(\w*create\w*server|\w*server\w*start|\w*listen\b|\w*bind\b|\w*server\w*init|\w*start\w*server|\w*http\w*listen)\b/i, label: "tls_server", required: false },
    ],
  },
  {
    name: "Data Integrity Check", category: "data_integrity", minCompleteness: 0.4,
    steps: [
      { pattern: /\b(\w*check\w*exist|\w*exist\w*check|\w*lookup|\w*find\w*by\w*id|\w*get\w*entity|\w*valid\w*refer|\w*refer\w*valid)\b/i, label: "di_check", required: true },
      { pattern: /\b(\w*create\w*refer|\w*refer\w*create|\w*link\w*entity|\w*assoc\w*entity|\w*set\w*foreign|\w*foreign\w*key)\b/i, label: "di_refer", required: true },
      { pattern: /\b(\w*audit|\w*log\w*change|\w*record\w*mutation|\w*track\w*change|\w*change\w*log|\w*audit\w*trail)\b/i, label: "di_audit", required: false },
    ],
  },
  {
    name: "Dev Pipeline", category: "dev_pipeline", minCompleteness: 0.4,
    steps: [
      { pattern: /\b(\w*extract\w*ir|\w*ir\w*extract|\w*parse\w*source|\w*analyze\w*code|\w*ast\w*parse|\w*build\w*ast|\w*compile\w*ir)\b/i, label: "dev_extract", required: true },
      { pattern: /\b(\w*valid\w*action|\w*action\w*valid|\w*check\w*rule|\w*rule\w*check|\w*lint|\w*verify\w*rule|\w*enforce\w*rule)\b/i, label: "dev_validate", required: true },
      { pattern: /\b(\w*emit|\w*generate|\w*output|\w*codegen|\w*compile|\w*build\w*out|\w*write\w*out)\b/i, label: "dev_emit", required: false },
    ],
  },
  {
    name: "3D Print Order", category: "printlab_order", minCompleteness: 0.3,
    steps: [
      { pattern: /\b(\w*upload\w*stl|\w*stl\w*upload|\w*upload\w*model|\w*model\w*upload|\w*file\w*upload|\w*upload\w*file)\b/i, label: "po_upload", required: true },
      { pattern: /\b(\w*slice|\w*gcode|\w*generate\w*gcode|\w*estimate|\w*cost\w*calc|\w*calc\w*cost|\w*create\w*order)\b/i, label: "po_process", required: true },
      { pattern: /\b(\w*queue|\w*ship|\w*deliver|\w*complete\w*order|\w*order\w*done|\w*finish\w*order)\b/i, label: "po_complete", required: false },
    ],
  },
  {
    name: "3D Print Execution", category: "printlab_print", minCompleteness: 0.4,
    steps: [
      { pattern: /\b(\w*start\w*print|\w*print\w*start|\w*begin\w*print|\w*print\w*begin|\w*execute\w*print|\w*run\w*print)\b/i, label: "pp_start", required: true },
      { pattern: /\b(\w*complete\w*print|\w*print\w*complete|\w*finish\w*print|\w*print\w*done|\w*print\w*success|\w*print\w*finish)\b/i, label: "pp_complete", required: true },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════
// P0 Round 4: PLSB Coverage — Double Release, Use After Release,
//              Session Fixation, Privilege Escalation, Double Commit,
//              API Contract / Workflow Bypass
// ═══════════════════════════════════════════════════════════════
const PLSB_PROTOCOLS: ProtocolDefinition[] = [
  {
    // PLS-002: Double Release
    name: "Double Release Detection", category: "resource_leak", minCompleteness: 0.3,
    steps: [
      { pattern: /\b(\w*close|close\w*|\w*free|free\w*|\w*disconnect|disconnect\w*|\w*cleanup|cleanup\w*|\w*destroy|destroy\w*|\w*release|release\w*|\w*shutdown|shutdown\w*|\w*end|end\w*|\w*delete|delete\w*)\b/i, label: "release_first", required: true },
      { pattern: /\b(\w*close|close\w*|\w*free|free\w*|\w*disconnect|disconnect\w*|\w*cleanup|cleanup\w*|\w*destroy|destroy\w*|\w*release|release\w*|\w*shutdown|shutdown\w*|\w*end|end\w*|\w*delete|delete\w*)\b/i, label: "release_second", required: false },
    ],
  },
  {
    // PLS-003: Use After Release
    name: "Use After Release Detection", category: "use_after_free", minCompleteness: 0.3,
    steps: [
      { pattern: /\b(\w*close|close\w*|\w*free|free\w*|\w*disconnect|disconnect\w*|\w*destroy|destroy\w*|\w*release|release\w*|\w*shutdown|shutdown\w*)\b/i, label: "release", required: true },
      { pattern: /\b(\w*read|read\w*|\w*write|write\w*|\w*send|send\w*|\w*recv|recv\w*|\w*query|query\w*|\w*access|access\w*|\w*use|use\w*|\w*get|get\w*|\w*execute|execute\w*)\b/i, label: "use_after", required: false },
    ],
  },
  {
    // PLS-005: Session Fixation
    name: "Session Fixation Detection", category: "session_fixation", minCompleteness: 0.5,
    steps: [
      { pattern: /\b(\w*login|login\w*|\w*signin|signin\w*|\w*authenticate|authenticate\w*|\w*create\w*session|session\w*create|\w*session\w*init|init\w*session|\w*session\w*start|start\w*session)\b/i, label: "session_create", required: true },
      { pattern: /\b(\w*logout|logout\w*|\w*signout|signout\w*|\w*session\w*destroy|destroy\w*session|\w*session\w*invalidate|invalidate\w*session|\w*session\w*revoke|revoke\w*session|\w*session\w*end|end\w*session|\w*session\w*expire|expire\w*session|\w*session\w*clear|clear\w*session|\w*clear\w*session|session\w*clear)\b/i, label: "session_destroy", required: true },
    ],
  },
  {
    // PLS-006: Privilege Escalation
    name: "Privilege Escalation Detection", category: "privilege_escalation", minCompleteness: 0.5,
    steps: [
      { pattern: /\b(\w*delete\w*all|deleteAll\w*|\w*delete\w*user|deleteUser\w*|\w*delete\w*account|deleteAccount\w*|\w*admin|admin\w*|\w*manage\w*user|manageUser\w*|\w*manage\w*system|manageSystem\w*|\w*system\w*config|systemConfig\w*|\w*ban\w*user|banUser\w*|\w*modify\w*role|modifyRole\w*|\w*assign\w*role|assignRole\w*|\w*grant\w*permission|grantPermission\w*)\b/i, label: "admin_action", required: true },
      { pattern: /\b(\w*check\w*role|checkRole\w*|\w*verify\w*admin|verifyAdmin\w*|\w*require\w*admin|requireAdmin\w*|\w*is\w*admin|isAdmin\w*|\w*has\w*role|hasRole\w*|\w*check\w*permission|checkPermission\w*|\w*has\w*permission|hasPermission\w*|\w*require\w*role|requireRole\w*|\w*admin\w*only|adminOnly\w*|\w*authorize|authorize\w*|\w*check\w*access|checkAccess\w*)\b/i, label: "admin_auth", required: true },
    ],
  },
  {
    // PLS-008: Double Commit
    name: "Double Commit Detection", category: "transaction_violation", minCompleteness: 0.3,
    steps: [
      { pattern: /\b(\w*begin\w*tx|beginTx\w*|\w*start\w*transaction|startTransaction\w*|\w*begin\w*transaction|beginTransaction\w*|\w*tx\w*start|txStart\w*|\w*db\w*transaction|dbTransaction\w*|\w*with\w*transaction|withTransaction\w*)\b/i, label: "tx_begin", required: true },
      { pattern: /\b(\w*commit|commit\w*|\w*commit\w*tx|commitTx\w*|\w*end\w*transaction|endTransaction\w*)\b/i, label: "tx_commit_first", required: true },
      { pattern: /\b(\w*commit|commit\w*|\w*commit\w*tx|commitTx\w*|\w*end\w*transaction|endTransaction\w*)\b/i, label: "tx_commit_second", required: false },
    ],
  },
  {
    // PLS-013: Workflow Bypass / API Contract
    name: "Workflow Bypass Detection", category: "missing_validation", minCompleteness: 0.5,
    steps: [
      { pattern: /\b(\w*validate|validate\w*|\w*check|check\w*|\w*verify|verify\w*|\w*sanitize|sanitize\w*|\w*parse|parse\w*|\w*schema|schema\w*|\w*zod|zod\w*|\w*input\w*valid|valid\w*input)\b/i, label: "wf_validate", required: true },
      { pattern: /\b(\w*execute|execute\w*|\w*process|process\w*|\w*handle|handle\w*|\w*run|run\w*|\w*do\w*action|doAction\w*|\w*perform|perform\w*|\w*dispatch|dispatch\w*|\w*apply|apply\w*)\b/i, label: "wf_action", required: true },
      { pattern: /\b(\w*log|log\w*|\w*audit|audit\w*|\w*record|record\w*|\w*track|track\w*|\w*metric|metric\w*|\w*monitor|monitor\w*)\b/i, label: "wf_audit", required: false },
    ],
  },
];

const ALL_PROTOCOLS = [...PROTOCOLS, ...PLSB_PROTOCOLS];

// ═══════════════════════════════════════════════════════════════
// P2: Safeguard Rules — "if trigger present, safeguard MUST also be present"
// These detect missing protections in individual functions, not just
// orchestrator-level protocol chains.
// ═══════════════════════════════════════════════════════════════

interface SafeguardRule {
  name: string;
  category: string;
  /** Languages this rule applies to. undefined = all languages. */
  languages?: string[];
  /** Function name pattern that triggers this rule */
  trigger: RegExp;
  /** Required safeguard patterns — at least one must match */
  safeguards: Array<{ pattern: RegExp; label: string; /** match against callee names only, excluding the enclosing function's own name (delegation checks) */ callsOnly?: boolean }>;
  /** Human-readable description of what's missing */
  violationMessage: string;
  /** Concept mapping */
  conceptMissing: string[];
  conceptExpected: string[];
  /** Optional: function name patterns to exclude (library internals, etc.) */
  excludePatterns?: RegExp[];
  /** When set, the rule only applies if the function takes a parent-reference
   *  parameter (name ends with "Id", or entityType/entityId). Requires the
   *  caller to pass param names (see `params` argument of detectSafeguardViolations). */
  parentRefGated?: boolean;
  /** When set, the trigger is tested against raw callee names only — not the
   *  identifier-parsed words (which split execute_command into "execute"). */
  triggerCallsOnly?: boolean;
  /** When set, the rule applies only if this synthetic marker is present in
   *  the function's calls — a semantic precondition emitted by the extractor
   *  (e.g. the function actually issues token material, or executes a
   *  dynamic command). */
  requireMarker?: string;
  /** When set, the rule only applies to functions that plausibly serve user
   *  requests: the function is called by a web-handler function (exposed) or
   *  takes an identity-ish parameter (token/session/user/auth/request/...).
   *  Requires the caller to pass param names + the `exposed` flag. Kills the
   *  library-internal noise class found in the real-world Python validation
   *  (94% of auth-rule detections lacked identity params). */
  paramGated?: boolean;
  /** Stricter safeguard patterns used when param names are known
   *  (parentRefGated rules); the default `safeguards` stay for legacy callers. */
  strictSafeguards?: Array<{ pattern: RegExp; label: string; callsOnly?: boolean }>;
}

const SAFEGUARD_RULES: SafeguardRule[] = [
  // ── Password Hashing ──
  {
    name: "Password Hashing",
    category: "password_hashing",
    trigger: /\b(register|signUp|createUser|createAccount|registerUser|sign_up|create_user|create_account|register_user|register_new_user)\b/i,
    safeguards: [
      { pattern: /\b(bcrypt|argon2|scrypt|pbkdf2|hash|hashPassword|createHash|hashSync|hash_password)\b/i, label: "secure_hash" },
      // Framework delegation (qualified chains only — a bare custom create_user
      // is NOT treated as secure): Django's built-in user manager and password
      // setters hash internally; repository/service create_user methods delegate
      // to the model (users_repo.create_user, self.create_user). Also
      // XForm(request.POST).save() — Django form validation + hashing
      // (extractor marker).
      { pattern: /\.create_user\b|\.(change_password|set_password)\b|__progmune_django_form__/i, label: "framework_hashing" },
    ],
    violationMessage: "User registration function does not call a secure password hashing function (bcrypt/argon2/scrypt). Passwords may be stored in plaintext or with weak hashing.",
    conceptMissing: ["PasswordHash", "KeyDerivation"],
    conceptExpected: ["bcrypt", "argon2", "scrypt"],
  },
  // Catch SHA256/MD5 specifically
  {
    name: "Password Hashing (Weak)",
    category: "password_hashing",
    trigger: /\b(register|signUp|createUser|createAccount|registerUser|sign_up|create_user|create_account|register_user|register_new_user)\b/i,
    safeguards: [
      { pattern: /\b(bcrypt|argon2|scrypt|pbkdf2)\b/i, label: "strong_hash" },
      // Framework delegation (qualified chains only)
      { pattern: /\.create_user\b|\.(change_password|set_password)\b|__progmune_django_form__/i, label: "framework_hashing" },
    ],
    excludePatterns: [
      /register\.(simple_tag|tag|filter|inclusion_tag)/,  // Django template-tag registration
    ],
    violationMessage: "User registration uses weak or no password hashing. SHA256/MD5 detected — use bcrypt/argon2 instead.",
    conceptMissing: ["StrongHash", "SaltGeneration"],
    conceptExpected: ["bcrypt", "argon2"],
  },
  // ── Authorization / Ownership Check ──
  // v2: narrowed triggers — removed "process" and "set" (too generic for C libraries)
  // v3 (2026-08-15): identity lookups (getUser/validateToken/getCurrentUser...) removed
  // from satisfiers — authentication is NOT ownership. A mutation calling only
  // getUser(token) without comparing ownerId/authorId is the 90-FN class found by
  // the 100-project gold benchmark. Satisfiers are now: explicit ownership
  // comparison names, owner-check helpers, or permission/role gates.
  // Limitation: inline `p.ownerId !== u.id` comparisons are not visible in the
  // call-list interface of this detector (would need AST-level analysis).
  {
    name: "Authorization (Ownership Check)",
    category: "authorization",
    paramGated: true,
    trigger: /\b(delete|remove|toggle|modify|edit|lock|ban|refund|assign|transfer|share|schedule|upload|update)(?:[A-Z]\w*|_\w+)|(?:[A-Z]\w*|_\w+)(Delete|Remove|Toggle|Modify|Edit|Lock|Ban|Refund|Assign|Transfer|Share|Schedule|Upload|Update)\b/i,
    safeguards: [
      { pattern: /\b(checkOwner|isOwner|ownerId\s*[!=]==?|authorId\s*[!=]==?|userId\s*[!=]==?|createdBy\s*[!=]==?|\.owner\s*[!=]==?|\.user\s*[!=]==?)\b/i, label: "ownership_check" },
      { pattern: /\b(hasPermission|checkPermission|checkAccess|isAuthorized|checkRole|requireRole|adminCheck|isAdmin|canModify|canDelete|canEdit)\b/i, label: "authz_check" },
    ],
    violationMessage: "Mutation operation does not verify that the acting user owns the resource or holds the required permission before modifying data.",
    conceptMissing: ["OwnershipCheck", "AuthorizationGuard"],
    conceptExpected: ["ownerId comparison", "authorId check", "permission check"],
    excludePatterns: [
      /_hd_/,                   // HPACK header compression internals
      /_frame_/,                // protocol frame handlers
      /_stream_/,               // stream internals
      /_buf_/,                  // buffer internals
      /_pkt_/,                  // packet internals
      /set_authn_id/,           // internal auth setter
      /add_auth_info/,          // internal auth metadata
      /process_echo_/,          // echo protocol handler
      /Command$/,               // generic command processors
      /InputBuffer/,            // input buffer processors
    ],
  },
  // Functions that serve data without any auth
  // v2: removed "read" (I/O op in C) and "find" (internal search); narrowed to API-oriented patterns
  {
    name: "Authorization (Unauthenticated Access)",
    category: "authorization",
    languages: ["typescript", "javascript", "python"],
    paramGated: true,
    trigger: /\b(list|download|view|fetch)(?:[A-Z]\w*|_\w+)|get(?:[A-Z]\w+|_\w+)/i,
    safeguards: [
      { pattern: /\b(getUser|validateToken|verifySession|getSessionUser|getCurrentUser|token\w*(Check|Verify|Valid)|session\w*(Check|Verify|Valid)|auth\w*(Check|Verify|Valid|Guard|Middleware|Required)|requireAuth|withAuth|authenticate\w*(User|Request|Token)?|checkAuth|isAuth|hasAuth|checkAccess|hasAccess|get_user|get_session_user|get_current_user|validate_session|verify_token|require_auth|with_auth|check_auth|auth_required|authenticate_user|authenticate_request|authenticate_token|token_check|token_verify|token_valid|session_check|session_verify|session_valid|auth_check|auth_guard|auth_middleware|get_current_user_authorizer|current_user_authorizer|login_required|permission_required|user_passes_test|check_authorization|check_permission|jwt\.decode|decode_token|__progmune_auth_checked__|__progmune_credential_check__)\b/i, label: "auth_check" },
    ],
    violationMessage: "Data access function does not check authentication. Anyone can access data without credentials.",
    conceptMissing: ["AuthenticationCheck", "AccessControl"],
    conceptExpected: ["token validation", "session check", "auth middleware"],
    excludePatterns: [
      /get_client_cert/,        // TLS certificate retrieval
      /get_ssl_/,               // SSL config retrieval
      /get_config/,             // configuration retrieval
      /get_option/,             // option retrieval
      /get_env/,                // environment variable
      /getpid|getuid|geteuid/,  // OS-level getters
      /listpack/,               // Redis internal data structure
      /readSync|readQuery/,     // internal I/O
      /findBig|findKey|findPk/, // internal search (not API)
    ],
  },
  // Mutations without any authentication. The Unauthenticated Access rule above
  // only covers read verbs (list/get/download/view/fetch); create/add/post/update/
  // set verbs had no auth coverage (3 gold FNs: addProduct, addCategory, setMilestone).
  // v3 (2026-08-15)
  {
    name: "Authorization (Unauthenticated Mutation)",
    category: "authorization",
    languages: ["typescript", "javascript", "python"],
    paramGated: true,
    // Note: "post" deliberately excluded — it collides with the Post entity name
    // (listPosts/getPost/deletePost fire via identifier-parsed words).
    trigger: /\b(add|create|update|set|publish|insert|submit)(?:[A-Z]\w*|_\w+)|(?:[A-Z]\w*|_\w+)(Add|Create|Update|Set|Publish|Insert|Submit)\b/i,
    safeguards: [
      { pattern: /\b(getUser|validateToken|verifyToken|verifySession|validateSession|getSessionUser|getSession\b|getCurrentUser|token\w*(Check|Verify|Valid)|session\w*(Check|Verify|Valid)|auth\w*(Check|Verify|Valid|Guard|Middleware|Required)|requireAuth|withAuth|authenticate\w*(User|Request|Token)?|checkAuth|isAuth|hasAuth|checkAccess|hasAccess|get_user|get_session_user|get_current_user|validate_session|verify_token|require_auth|with_auth|check_auth|auth_required|authenticate_user|authenticate_request|authenticate_token|token_check|token_verify|token_valid|session_check|session_verify|session_valid|auth_check|auth_guard|auth_middleware|get_current_user_authorizer|current_user_authorizer|login_required|permission_required|user_passes_test|check_authorization|check_permission|create_access_token|create_refresh_token|create_jwt_token|__progmune_auth_checked__|__progmune_credential_check__)\b/i, label: "auth_check" },
    ],
    violationMessage: "Mutation function does not check authentication. Anyone can create or modify data without credentials.",
    conceptMissing: ["AuthenticationCheck", "AccessControl"],
    conceptExpected: ["token validation", "session check", "auth middleware"],
    excludePatterns: [
      /set_authn_id/,           // internal auth setter
      /set_ssl_/,               // SSL config setter
      /set_config/,             // configuration setter
      /set_option/,             // option setter
    ],
  },
  // ── Data Integrity (Foreign Key Validation) ──
  // v2: removed "process" and "send" (too generic for C)
  // v3 (2026-08-15): param-aware. The old safeguard counted ANY get*/find* call
  // as a foreign-key check — including getSessionUser/getUser auth lookups, which
  // suppressed the rule on addComment/addNote/createReply (4 gold FNs). When param
  // names are known, the rule only applies to functions taking a parent-reference
  // parameter (…Id / entityType) and requires a NON-auth lookup call.
  {
    name: "Data Integrity (Foreign Key)",
    category: "data_integrity",
    trigger: /\b(add|create|post|refund)(?:[A-Z]\w*|_\w+)|(?:[A-Z]\w*|_\w+)(Add|Create|Post|Refund)\b/i,
    safeguards: [
      { pattern: /\b(get|find|check|exists|lookup|status|validate|verify)(?:[A-Z]\w*|_\w+)\b/i, label: "fk_check" },
    ],
    violationMessage: "Creates a child entity without verifying the parent entity exists. Orphaned references possible.",
    conceptMissing: ["ForeignKeyValidation", "ReferentialIntegrity"],
    conceptExpected: ["checkExists", "getParent", "validateReference"],
    parentRefGated: true,
    strictSafeguards: [
      // Entity lookups only — authentication lookups do NOT verify a parent exists.
      { pattern: /\b(?!get(Session|Current)?User\b|getClient\b|verifyToken\b|validateSession\b)(get|find|check|exists|lookup|status|validate|verify)(?:[A-Z]\w*|_\w+)\b/i, label: "fk_check_strict" },
    ],
    excludePatterns: [
      /_hd_/,                   // HPACK header compression
      /add_auth_info/,          // internal auth metadata
      /add_header/,             // HTTP header addition
      /send_response/,          // HTTP response (not entity creation)
      /create_callback/,        // callback creation
      /create_filter/,          // filter creation
    ],
  },
  // ── Input Validation ──
  // v2: removed "send" (too generic for C); kept create/add/post/upload
  {
    name: "Input Validation",
    category: "input_validation",
    trigger: /\b(create|add|post|upload)(?:[A-Z]\w*|_\w+)|(?:[A-Z]\w*|_\w+)(Create|Add|Post|Upload)\b/i,
    safeguards: [
      { pattern: /\b(validate|sanitize|check|verify)(?:[A-Z]\w*|_\w*)(Content|Input|Length|Title|Body|Type|Size|File|Data|Param|Arg|Field|Value)\b|\b(validateContent|sanitizeInput|checkLength|verifyType|checkSize)\b/i, label: "input_validation" },
    ],
    violationMessage: "Content creation function does not validate or sanitize input. XSS, injection, and oversized content possible.",
    conceptMissing: ["InputSanitization", "ContentValidation", "SizeLimit"],
    conceptExpected: ["validateContent", "sanitizeInput", "checkLength"],
    excludePatterns: [
      /_hd_/,                   // HPACK header compression
      /add_auth_info/,          // internal auth metadata
      /add_header/,             // HTTP header addition
      /send_response/,          // HTTP response
      /send_reply/,             // protocol reply
      /upload_blob/,            // binary blob upload (not content)
    ],
  },
  // ── TLS Enforcement ──
  {
    name: "TLS Enforcement",
    category: "tls_enforcement",
    trigger: /\b(createServer|listen|handleRequest|handle_request|app\.listen|express)\b/i,
    safeguards: [
      { pattern: /\b(https|tls|ssl|cert|key|TLS|SSL|HTTPS|createSecureContext|credentials)\b/i, label: "tls_config" },
    ],
    violationMessage: "Server created without TLS configuration. Connections will be unencrypted HTTP.",
    conceptMissing: ["TLSConfiguration", "HTTPSEnforcement", "CertificateSetup"],
    conceptExpected: ["https.createServer", "TLS cert", "SSL configuration"],
  },
  // ── Token Security ──
  {
    name: "Token Security (Weak Generation)",
    category: "token_security",
    languages: ["typescript", "javascript", "python"],
    trigger: /\b(authenticate|login|signIn|logIn|createSession|generateToken|do_login|sign_in|log_in|generate_token|create_session|reset_password|password_reset|forgot_password|reset_token|create_reset_token|generate_reset_token)\b/i,
    // Semantic precondition: only fire when the function actually issues
    // token material (set_cookie / token-named assignment — extractor marker).
    // Login-named page renderers (login_otp) no longer fire.
    requireMarker: "__progmune_token_issued__",
    safeguards: [
      { pattern: /\b(crypto\.randomUUID|jwt\.sign|jsonwebtoken|nanoid|randomBytes|cryptoRandomString|secrets\.token_urlsafe|secrets\.token_hex|token_urlsafe|token_hex|uuid\.uuid4|os\.urandom)\b/i, label: "secure_token" },
      // Framework delegation: calling a token-issuing layer means the session
      // material is handled by that layer, not generated inline. NOTE: bare
      // jwt.encode is deliberately NOT here — a hardcoded secret key makes the
      // JWT layer itself the vulnerability (PyGoat sec_misconfig_lab3).
      { pattern: /\b(create_access_token|create_refresh_token|create_jwt_token|\.check_password\b|get_current_user_authorizer|login_required|permission_required|__progmune_framework_auth__)\b/i, label: "framework_token" },
    ],
    excludePatterns: [
      /login_not_required|login_required/,   // decorators — the auth layer itself
    ],
    violationMessage: "Token/session generated without cryptographically secure random source. Tokens may be predictable or forgeable.",
    conceptMissing: ["SecureRandom", "TokenEntropy", "CryptographicSignature"],
    conceptExpected: ["crypto.randomUUID", "jwt.sign", "nanoid"],
  },
  // ── Stricter Ownership Check (for resource mutation) ──
  {
    name: "Authorization (Resource Ownership)",
    category: "authorization",
    paramGated: true,
    trigger: /\b(toggle|remove)(?:[A-Z]\w*|_\w+)\b/i,
    safeguards: [
      { pattern: /\b(ownerId\s*[!=]==?|authorId\s*[!=]==?|userId\s*[!=]==?|createdBy|\.owner\s*[!=]==?)/i, label: "ownership_comparison" },
    ],
    violationMessage: "Resource mutation checks authentication but does NOT verify the resource belongs to the requesting user. Missing ownerId/authorId comparison.",
    conceptMissing: ["ResourceOwnership", "HorizontalAuthorization"],
    conceptExpected: ["ownerId comparison", "authorId check", "userId === resource.ownerId"],
  },
  // ── Payment Verification ──
  {
    name: "Payment Order Verification",
    category: "data_integrity",
    trigger: /\b(process|create|make|submit)\w*(Payment|Charge|Transaction)\b/i,
    safeguards: [
      { pattern: /\b(getOrder|verifyOrder|checkOrder|findOrder|orderExists|order\b)\b/i, label: "order_verification" },
    ],
    violationMessage: "Payment processed without verifying the associated order exists and belongs to the user.",
    conceptMissing: ["OrderVerification", "PaymentAuthorization"],
    conceptExpected: ["getOrder", "verifyOrder", "checkOrder"],
  },
  // ── Room Membership ──
  {
    name: "Room Membership Check",
    category: "authorization",
    trigger: /\b(send|post|publish)\w*(Message|Msg)\b/i,
    safeguards: [
      { pattern: /\b(joinRoom|roomMember|checkMember|isMember|members\.includes|members\.find|memberOf|inRoom)\b/i, label: "room_membership" },
    ],
    violationMessage: "Message sent to room without verifying the user is a room member.",
    conceptMissing: ["RoomMembership", "ChannelAuthorization"],
    conceptExpected: ["joinRoom", "isMember", "members.includes"],
  },
  // ── Refund Status Check ──
  {
    name: "Refund Status Verification",
    category: "data_integrity",
    trigger: /\b(refund|cancel|void|reverse)\w*(Payment|Order|Charge|Transaction)\b/i,
    safeguards: [
      { pattern: /\b(status|\.status|getStatus|checkStatus|orderStatus|paymentStatus)\b/i, label: "status_check" },
    ],
    violationMessage: "Refund/cancellation processed without verifying the current order/payment status.",
    conceptMissing: ["StatusVerification", "IdempotencyCheck"],
    conceptExpected: ["status check", "orderStatus", "paymentStatus"],
  },
  // ── Rate Limiting ──
  {
    name: "Rate Limiting",
    category: "rate_limiting",
    trigger: /\b(createServer|listen|handleRequest|handle_request|app\.listen|express|router\.(post|get|put|delete|patch))\b/i,
    safeguards: [
      { pattern: /\b(rateLimit|rate_limit|throttle|RateLimiter|expressRateLimit|rateLimiterMiddleware|limiter)\b/i, label: "rate_limit" },
    ],
    violationMessage: "Server/API endpoint created without rate limiting. Vulnerable to brute force and abuse.",
    conceptMissing: ["RateLimiting", "DoSProtection", "AbusePrevention"],
    conceptExpected: ["rateLimit", "throttle", "express-rate-limit"],
  },
  // ── C-Specific Rules ──
  {
    name: "Key Derivation Safety",
    category: "crypto",
    languages: ["c"],
    trigger: /\b(ecdh|curve25519|ssh_dh_|kex_|build_k|do_create_k|derive\w*secret|dh_set_param|ec_key|ecdh_)\b/i,
    safeguards: [
      { pattern: /\b(EC_KEY_get0_group|EC_KEY_check_key|EVP_PKEY_check|DH_check|get0_group|check_key|verify_param|validate_curve|ssh_key_is_private|ssh_key_type)\b/i, label: "key_validation" },
      { pattern: /\b(EC_KEY_free|EVP_PKEY_free|DH_free|BN_free|BN_clear_free|gcry_sexp_release|mbedtls_ecp_group_free|mbedtls_ecp_point_free|mbedtls_mpi_free|ssh_string_free|ssh_string_burn|ssh_buffer_free|OSSL_PARAM_BLD_free|OSSL_PARAM_free|explicit_bzero)\b/i, label: "crypto_cleanup" },
    ],
    violationMessage: "Key derivation function does not validate generated keys or properly clean up cryptographic material.",
    conceptMissing: ["KeyValidation", "CryptoCleanup"],
    conceptExpected: ["EC_KEY_check_key", "EVP_PKEY_check", "explicit_bzero"],
  },
  {
    name: "Certificate Pinning Validation",
    category: "certificate",
    languages: ["c"],
    trigger: /(pin_peer_pubkey|pin_cert|pin_pubkey|pubkey_pin|cert_pin|ssl_pin|pkpin)\b/i,
    safeguards: [
      { pattern: /\b(X509_verify_cert|SSL_get_verify_result|X509_STORE_CTX_get_error|verify_certificate|verify_peer|cert_verify|ssl_verify|Curl_ssl_cf_get_config|ossl_verify|gtls_verify|mbedtls_ssl_conf_verify)\b/i, label: "cert_verify" },
      { pattern: /\b(Curl_ssl_cf_get_primary_config|Curl_ssl_cf_get_config|ssl_cf_get_config|ssl_config_get|peer_cert|get_peer_certificate)\b/i, label: "ssl_config" },
    ],
    violationMessage: "Certificate/public key pinning used without proper X.509 certificate verification.",
    conceptMissing: ["CertificateVerification", "TrustChainValidation"],
    conceptExpected: ["X509_verify_cert", "SSL_get_verify_result"],
  },
  // ── Python-Specific Rules ──
  {
    name: "Unsafe Deserialization (Pickle)",
    category: "input_validation",
    languages: ["python"],
    trigger: /\b(pickle\.loads|pickle\.load|cPickle\.loads|cPickle\.load|yaml\.load(?!_safe)|yaml_load(?!_safe))\b/i,
    safeguards: [
      { pattern: /\b(pickle\.Unpickler|yaml\.safe_load|yaml_safe_load|json\.loads|ast\.literal_eval)\b/i, label: "safe_deserialize" },
    ],
    violationMessage: "Unsafe deserialization of pickle/YAML can execute arbitrary code during deserialization.",
    conceptMissing: ["SafeDeserialization", "InputSanitization"],
    conceptExpected: ["yaml.safe_load", "json.loads"],
  },
  {
    name: "Command Injection",
    category: "input_validation",
    languages: ["python"],
    // Marker-driven: the extractor emits __progmune_command_dynamic__ only
    // when a subprocess/os command receives a NON-static argument (static
    // string/list invocations like installers stay silent), and
    // __progmune_command_taint_flow__ when a tainted value flows to a
    // command-named helper.
    trigger: /\b(__progmune_command_dynamic__|__progmune_command_taint_flow__)\b/,
    safeguards: [
      { pattern: /\b(shlex\.quote|shlex\.split|pipes\.quote)\b/i, label: "safe_command" },
    ],
    violationMessage: "Shell command execution without input quoting. Vulnerable to command injection.",
    conceptMissing: ["CommandInjectionPrevention", "InputSanitization"],
    conceptExpected: ["shlex.quote", "shell=False"],
  },
  {
    name: "Hardcoded Secrets",
    category: "token_security",
    languages: ["python"],
    trigger: /\b(password|secret|api_key|API_KEY|token|\w*TOKEN\w*)\s*=\s*["'][^"']+["']|__progmune_hardcoded_secret__/i,
    // Empty safeguards: the extractor marker is the complete evidence. (The old
    // env-secret safeguard suppressed the marker itself — identifierParse of
    // __progmune_hardcoded_secret__ yields the word "secret", matching the
    // safeguard's "Secret" alternative.)
    safeguards: [],
    violationMessage: "Sensitive credentials hardcoded in source code. Use environment variables or a secrets manager.",
    conceptMissing: ["SecretManagement", "ConfigurationSecurity"],
    conceptExpected: ["os.environ", "os.getenv", "dotenv"],
  },
  {
    name: "Dynamic Code Execution",
    category: "input_validation",
    languages: ["python"],
    trigger: /\b(eval|exec|compile|__import__)\s*\(|__progmune_eval_user_input__/i,
    safeguards: [
      { pattern: /\b(ast\.literal_eval|json\.loads|safe_eval)\b/i, label: "safe_eval" },
    ],
    violationMessage: "Dynamic code execution from string input. Attacker-controlled input can execute arbitrary code.",
    conceptMissing: ["SafeCodeExecution", "InputValidation"],
    conceptExpected: ["ast.literal_eval"],
  },
  {
    name: "Context Manager Usage",
    category: "resource_lifecycle",
    languages: ["python"],
    trigger: /\b(sqlite3\.connect|psycopg2\.connect|open|io\.open|socket\.socket|redis\.Redis)\b/i,
    safeguards: [
      { pattern: /\b(with\s+\w|contextmanager|contextlib|closing|__enter__|\.close\(\))\b/i, label: "context_manager" },
    ],
    violationMessage: "Resource opened outside a context manager — may leak on exception paths.",
    conceptMissing: ["ResourceCleanup", "ExceptionSafety"],
    conceptExpected: ["with statement", "contextmanager", ".close()"],
  },
  {
    name: "SQL Injection (Python)",
    category: "input_validation",
    languages: ["python"],
    // Source-level detection: the Python extractor emits a synthetic marker
    // call when a SQL-executing call (execute/executemany/raw/...) builds its
    // SQL text with dynamic formatting (f-string / % / .format / concatenation).
    // Parameterized calls (execute("... %s", (args,))) produce no marker and
    // are correctly NOT flagged. No satisfier possible — the marker IS the
    // violation evidence.
    trigger: /\b(__progmune_sql_unparameterized__)\b/,
    safeguards: [],
    violationMessage: "SQL built with string formatting (f-string / % / .format / concatenation) instead of parameterized queries. Vulnerable to SQL injection.",
    conceptMissing: ["SQLInjectionPrevention", "ParameterizedQueries"],
    conceptExpected: ["parameterized query", "%s placeholder"],
  },
  {
    name: "SSRF (User-Controlled URL Fetch)",
    category: "ssrf",
    languages: ["python"],
    // Source-level detection: the Python extractor emits a synthetic marker
    // call when an HTTP fetch (requests.*/urllib.*/httpx.*/aiohttp.*/urlopen)
    // receives a URL tainted by request-derived user input (directly or via
    // single-hop assignment). No satisfier possible — the marker IS the
    // violation evidence.
    trigger: /\b(__progmune_ssrf_user_url__)\b/,
    safeguards: [],
    violationMessage: "HTTP fetch whose URL derives from user-controlled request input — server-side request forgery.",
    conceptMissing: ["SSRFPrevention", "URLValidation"],
    conceptExpected: ["URL allowlist", "scheme validation"],
  },
  {
    name: "Path Traversal (User-Controlled File Path)",
    category: "path_traversal",
    languages: ["python"],
    // Source-level detection: the Python extractor emits a synthetic marker
    // call when a file sink (open / io.open / os.open / Path(...).read_text)
    // receives a path tainted by request-derived user input (directly or via
    // single-hop assignment — os.path.join chains resolve through assignment
    // tracking). No satisfier possible — the marker IS the violation evidence.
    trigger: /\b(__progmune_path_traversal__)\b/,
    safeguards: [],
    violationMessage: "File opened with a path derived from user-controlled request input — path traversal / arbitrary file access.",
    conceptMissing: ["PathTraversalPrevention", "InputPathValidation"],
    conceptExpected: ["path allowlist", "basename normalization", "path sanitization"],
  },
  {
    name: "XSS (Unsafe Template Rendering)",
    category: "xss",
    languages: ["python"],
    // Cross-file detection: the Python extractor scans templates for variables
    // rendered without escaping ({{ var|safe }}, {% autoescape off %}) and emits
    // a synthetic marker when a render/render_to_string call binds tainted
    // request-derived values to those variables — or when mark_safe() is
    // applied to tainted input.
    trigger: /\b(__progmune_xss_unsafe_render__)\b/,
    safeguards: [],
    violationMessage: "User-controlled input rendered in a template without escaping (|safe / autoescape off / mark_safe) — stored or reflected XSS.",
    conceptMissing: ["XSSPrevention", "OutputEncoding"],
    conceptExpected: ["template autoescape", "output escaping"],
  },
  {
    name: "SSTI (Template Injection)",
    category: "ssti",
    languages: ["python"],
    // Source-level detection: the Python extractor emits a synthetic marker
    // when (S1) a template-string sink (render_template_string / Template /
    // from_string) receives tainted input, or (S2) tainted content is written
    // to a file opened under a template path — the Django dynamic-template
    // pattern where user input becomes template source.
    trigger: /\b(__progmune_ssti_template_injection__)\b/,
    safeguards: [],
    violationMessage: "User-controlled input used as template source — server-side template injection.",
    conceptMissing: ["SSTIPrevention", "TemplateSandbox"],
    conceptExpected: ["static template files", "no user template syntax"],
  },
  {
    name: "XXE (External Entity Processing)",
    category: "xxe",
    languages: ["python"],
    // Source-level detection: the Python extractor emits a synthetic marker
    // when BOTH signals co-occur — an explicitly unsafe parser configuration
    // (setFeature(feature_external_*, True) / XMLParser(resolve_entities=True))
    // AND parsing of tainted request-derived XML (parse/parseString/fromstring).
    // Config-only or taint-only alone is not flagged.
    trigger: /\b(__progmune_xxe_external_entities__)\b/,
    safeguards: [],
    violationMessage: "XML parsed from user-controlled input with external entity processing explicitly enabled — XXE.",
    conceptMissing: ["XXEPrevention", "EntityExpansionControl"],
    conceptExpected: ["disable external entities", "secure parser config"],
  },
  {
    name: "CSRF Protection Disabled",
    category: "csrf",
    languages: ["python"],
    // Source-level detection: the Python extractor emits a synthetic marker
    // when a function carries the @csrf_exempt decorator — Django CSRF
    // protection explicitly disabled on the view.
    trigger: /\b(__progmune_csrf_disabled__)\b/,
    safeguards: [],
    violationMessage: "View decorated with @csrf_exempt — CSRF protection explicitly disabled.",
    conceptMissing: ["CSRFProtection", "StateChangingRequestValidation"],
    conceptExpected: ["csrf token validation", "SameSite cookies"],
  },
  {
    name: "CSRF Exposed GET State Change",
    category: "csrf",
    languages: ["python"],
    // Source-level detection: the Python extractor emits a synthetic marker
    // when a `request.method == 'GET'` branch performs state-changing calls
    // (.save/.update/.delete/.create) — state change on GET, CSRF-exposed
    // even without @csrf_exempt.
    trigger: /\b(__progmune_get_state_change__)\b/,
    safeguards: [],
    violationMessage: "State-changing operation executed in a GET branch — CSRF-exposed without token validation.",
    conceptMissing: ["CSRFProtection", "SafeMethodEnforcement"],
    conceptExpected: ["POST for state changes", "csrf token validation"],
  },

  // ═══════════════════════════════════════════════════════════════
  // P0 Injection: Payment + Session safeguard rules
  // ═══════════════════════════════════════════════════════════════

  // ── Payment: Webhook without signature verification ──
  {
    name: "Payment Webhook (No Signature Check)",
    category: "payment",
    trigger: /\b(\w*webhook|\w*payment\w*callback|\w*stripe\w*webhook|\w*paypal\w*ipn|\w*ipn\w*handler|\w*payment\w*notify)\b/i,
    safeguards: [
      { pattern: /\b(\w*sign|\w*verify\w*sign|\w*check\w*sign|\w*validate\w*sign|\w*hmac\b|\w*webhook\w*secret|\w*signature\w*check|\w*signature\w*valid|\w*raw\w*body|\w*payload\w*raw)\b/i, label: "sig_check" },
    ],
    violationMessage: "Payment webhook/callback handler does not verify the request signature. Accepts unauthenticated payment confirmations — trivial to forge.",
    conceptMissing: ["WebhookSignatureVerification", "HMACValidation"],
    conceptExpected: ["verifySignature", "stripe.webhooks.constructEvent", "hmac check"],
  },
  // ── Payment: Payment without order verification ──
  {
    name: "Payment Without Order Verification",
    category: "payment",
    trigger: /\b(process\w*payment|payment\w*process|create\w*payment|payment\w*create|processPayment|createPayment|handlePayment|payment\w*handle|complete\w*payment|payment\w*complete|charge\w*payment|payment\w*charge)\b/i,
    safeguards: [
      { pattern: /\b(getOrder|checkOrder|verifyOrder|findOrder|orderExists|get_order|check_order|verify_order|find_order|order\w*find|order\w*get|order\w*check|order\w*verify|order\w*valid)\b/i, label: "order_check" },
    ],
    violationMessage: "Payment processed without verifying the associated order exists and belongs to the user. Payments can be made against nonexistent or unauthorized orders.",
    conceptMissing: ["OrderVerification", "PaymentAuthorization", "OrderOwnership"],
    conceptExpected: ["getOrder", "checkOrder", "verifyOrder"],
  },
  // ── Payment: Refund without auth check ──
  {
    name: "Payment Refund (No Authorization)",
    category: "payment",
    trigger: /\b(refund|void|reverse|cancel\w*payment|\w*refund|\w*void\w*payment)\b/i,
    safeguards: [
      { pattern: /\b(\w*auth|\w*admin|\w*role|\w*permission|\w*approve|\w*confirm|\w*verify\w*user|\w*check\w*owner|\w*validate\w*admin|\w*authorize\b)/i, label: "auth_check" },
    ],
    violationMessage: "Refund/void function does not check authorization. Any user could initiate refunds without permission.",
    conceptMissing: ["RefundAuthorization", "AdminCheck"],
    conceptExpected: ["admin", "role check", "approve refund"],
  },
  // ── Session: Missing session timeout/expiry ──
  {
    name: "Session No Timeout",
    category: "session",
    trigger: /\b(\w*session\w*create|\w*create\w*session|\w*session\w*new|\w*session\w*start|\w*login\w*session|\w*session\w*init|signIn|signin|login\b|authenticate\b|createSession|create_session|do_login|sign_in|log_in)\b/i,
    safeguards: [
      { pattern: /\b(\w*expir|\w*ttl|\w*timeout|\w*max\w*age|\w*maxAge|\w*max_age|\w*lifetime|\w*duration|\w*expires|\w*deadline|\w*valid\w*for|\w*valid\w*until)/i, label: "timeout_set" },
    ],
    violationMessage: "Session created without setting an expiry/TTL. Session tokens could be valid indefinitely.",
    conceptMissing: ["SessionTimeout", "TTLConfiguration"],
    conceptExpected: ["expiresIn", "maxAge", "session TTL"],
    /** Library functions where timeout is configured via separate API (not in constructor) */
    excludePatterns: [
      /^session_new$/,           // nghttp2 constructor (timeout via callbacks_set_send_timeout)
      /_frame_/,                 // internal frame handlers
      /_internal_/,              // internal machinery
      /CheckPAMAuth/,            // PostgreSQL PAM — timeout via /etc/pam.d/
      /pam_/,                    // PAM library functions (timeout external)
      /CheckBSDAuth/,            // BSD auth — timeout via login.conf
    ],
  },
  // ── Session: Missing token rotation on sensitive action ──
  {
    name: "No Token Rotation After Privilege Change",
    category: "session",
    trigger: /\b(\w*password\w*change|\w*password\w*reset|\w*change\w*password|\w*reset\w*password|\w*update\w*password|\w*privilege|\w*role\w*change|\w*escalat|\w*enable\w*2fa|\w*mfa\w*enable|\w*email\w*change)\b/i,
    safeguards: [
      { pattern: /\b(\w*revoke|\w*rotate|\w*invalidate|\w*reissue|\w*regenerate|\w*new\w*token|\w*token\w*refresh|\w*session\w*refresh|\w*renew)/i, label: "token_rotate" },
      // Password-change machinery itself (the material IS rotated/reissued here).
      { pattern: /\.(change_password|set_password|update_password|generate_salt|get_password_hash)\b/i, label: "password_machinery" },
    ],
    violationMessage: "Privilege-changing operation detected without subsequent token rotation or session invalidation. Stolen pre-change tokens remain valid.",
    conceptMissing: ["TokenRotation", "SessionInvalidation", "FixationPrevention"],
    conceptExpected: ["revoke session", "rotate token", "invalidate old sessions"],
  },

  // ═══════════════════════════════════════════════════════════════
  // P0 Round 2: Registration + File Upload + Resource safeguard rules
  // ═══════════════════════════════════════════════════════════════

  // ── Registration: No email verification ──
  {
    name: "Registration Without Email Verification",
    category: "registration",
    trigger: /\b(register|signup|signUp|registerUser|createUser|createAccount|sign_up|create_user|create_account|register_user|register_new_user)\b/i,
    safeguards: [
      { pattern: /\b(send\w*(Code|Otp|Token|Verif|Email|Sms|Link)|(code|otp|token|verif)\w*send|verification|confirmEmail|verifyEmail|sendVerification|verify_user_email)\b/i, label: "email_verify" },
    ],
    violationMessage: "User registration does not send email/SMS verification. Fake accounts can be created without email ownership check.",
    conceptMissing: ["EmailVerification", "OTPValidation", "AccountOwnership"],
    conceptExpected: ["sendVerificationCode", "verifyEmail", "confirmAccount"],
  },
  // ── File Upload: No type/size validation ──
  {
    name: "File Upload Without Validation",
    category: "file_upload",
    trigger: /\b(upload|receive\w*file|handle\w*upload|file\w*upload|multipart|form\w*data|write\w*file|save\w*file|store\w*file)\b/i,
    safeguards: [
      { pattern: /\b(valid\w*(type|size|ext|mime|file)|check\w*(type|size|ext|mime|file)|file\w*(type|size|ext|mime)|mime\w*check|max\w*size|max\w*file|allow\w*(ext|type)|file\w*filter|content\w*type|scan\w*file|virus\w*scan)\b/i, label: "file_validate" },
    ],
    violationMessage: "File upload does not validate file type, size, or content. Vulnerable to malicious file uploads (webshells, oversized files, malware).",
    conceptMissing: ["FileTypeValidation", "FileSizeLimit", "MalwareScanning"],
    conceptExpected: ["validateFileType", "checkFileSize", "virus scan"],
    excludePatterns: [
      /file_upload/,                     // generic variable name, not upload handler
      /ossl_do_file_type/,               // OpenSSL file type detection
      /ngx_file_(size|fs_size)/,         // nginx file metadata
      /nghttp2_max_size/,                // nghttp2 size limit
      /ngtcp2_conn_get_max_tx/,          // ngtcp2 packet size
    ],
  },
  // ── Resource: Input sanitization missing ──
  {
    name: "No Input Sanitization",
    category: "resource",
    trigger: /\b(render|display|write|output|append|insert|innerHTML|dangerouslySetInnerHTML|document\.write|echo|printf|sprintf)\b/i,
    safeguards: [
      { pattern: /\b(sanitize|escape|encode|html\w*entities|htmlspecialchars|encodeURI|stripTags|purify|DOMPurify|clean|filter\w*html|escape\w*html)\b/i, label: "sanitize" },
    ],
    violationMessage: "User-controlled content rendered/displayed without sanitization. Vulnerable to XSS attacks.",
    conceptMissing: ["XSSPrevention", "OutputEncoding", "ContentSanitization"],
    conceptExpected: ["sanitize", "escapeHtml", "encodeURI"],
    excludePatterns: [
      /ssl_read|ssl_write|ssl_free/,      // OpenSSL BIO I/O wrappers
      /BIO_read|BIO_write|BIO_puts/,      // OpenSSL BIO layer
      /printf|sprintf|fprintf/,           // C stdio — internal logging, not web rendering
      /expect_quic_with_stream_lock/,     // QUIC internal lock helper
      /quic_write/,                        // QUIC internal I/O
      /quic_read/,                         // QUIC internal I/O
      /composite_end/,                    // JSON encoder internal
      /qlog_event/,                       // QUIC qlog internal
      /trace_frame/,                      // QUIC trace internal
      /port_init|port_rx_pre/,           // QUIC port internal
      /echo$/,                             // shell echo, not web echo
      /ldap_/,                            // LDAP connection/search — not web rendering
      /FormatSearchFilter/,              // LDAP search filter formatting
      /InitializeLDAP/,                  // LDAP initialization
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // P0 Round 3: Remaining namespace safeguard rules
  // ═══════════════════════════════════════════════════════════════

  // ── API Gateway: No rate limiting ──
  {
    name: "API Without Rate Limiting",
    category: "api_gateway",
    trigger: /\b(createServer|listen|handleRequest|router|endpoint|api\w*handler|request\w*handler|handle\w*request)\b/i,
    safeguards: [
      { pattern: /\b(rate\w*limit|throttle|quota|concurrency|max\w*request|request\w*limit|token\w*bucket|leaky\w*bucket|circuit\w*break|redis\w*rate|limit\w*check)\b/i, label: "rate_limit" },
    ],
    violationMessage: "API endpoint created without rate limiting. Vulnerable to DoS and brute-force attacks.",
    conceptMissing: ["RateLimiting", "DoSProtection", "QuotaManagement"],
    conceptExpected: ["rateLimit", "throttle", "maxRequests"],
    excludePatterns: [
      /ap_(get|setup)_client_block/,     // Apache HTTP body reading
      /connBlock/,                        // Redis connection blocking
      /curlx_nonblock/,                   // curl non-blocking I/O
      /inflate_header_block/,             // HPACK header compression
      /emit_\w*_block/,                   // HPACK emit
      /DTLSv1_listen/,                   // DTLS protocol listener, not API endpoint
      /BIO_dgram/,                        // BIO datagram
      /recvfrom|sendto/,                 // socket I/O
    ],
  },
  // ── Notification: No retry on failure ──
  {
    name: "Notification Without Retry",
    category: "notification",
    trigger: /\b(send\w*email|send\w*sms|send\w*push|send\w*notif|dispatch|deliver\w*message|post\w*message)\b/i,
    safeguards: [
      { pattern: /\b(retry|reconnect|fallback|resilience|circuit\w*break|exponential\w*backoff|dead\w*letter|dlq|queue\w*retry|backoff)\b/i, label: "retry" },
    ],
    violationMessage: "Notification sent without retry/fallback mechanism. Transient network failures will cause silent message loss.",
    conceptMissing: ["RetryLogic", "Resilience", "DeadLetterQueue"],
    conceptExpected: ["retry", "exponential backoff", "dead letter queue"],
    excludePatterns: [
      /Curl_auth_create_\w+_message/,    // auth message construction, not notification
      /nghttp2_submit_\w+/,              // HTTP/2 frame submission
    ],
  },
  // ── TLS: Certificate without renewal ──
  {
    name: "TLS Certificate Without Renewal",
    category: "tls",
    trigger: /\b(load\w*cert|load\w*ssl|ssl\w*config|tls\w*config|cert\w*load|ssl\w*ctx|certificate\w*load)\b/i,
    safeguards: [
      { pattern: /\b(renew|rotate|expir|notAfter|notBefore|validity|check\w*expir|auto\w*renew|cert\w*watch|watch\w*cert)\b/i, label: "cert_renew" },
    ],
    violationMessage: "TLS certificate loaded without expiry check or renewal mechanism. Will cause production outage when certificate expires.",
    conceptMissing: ["CertificateRenewal", "ExpiryMonitoring", "AutoRotation"],
    conceptExpected: ["checkExpiry", "autoRenew", "certificate watch"],
  },
  // ── Data Integrity: Mutation without audit ──
  {
    name: "Data Mutation Without Audit Trail",
    category: "data_integrity",
    trigger: /\b(update|delete|modify|change|mutate|set\w*field|edit|remove|drop)\b/i,
    safeguards: [
      { pattern: /\b(audit|log\w*change|change\w*log|track\w*change|record\w*mutation|mutation\w*log|history|version|revision|snapshot|write\w*ahead|wal\b)/i, label: "audit_trail" },
    ],
    violationMessage: "Data mutation without audit trail. Cannot track who changed what or recover from accidental data corruption.",
    conceptMissing: ["AuditTrail", "ChangeTracking", "DataLineage"],
    conceptExpected: ["auditLog", "changeHistory", "write-ahead log"],
  },
  // ═══════════════════════════════════════════════════════════════
  // Governance meta-rule: Framework Version Convention Check
  // Lesson from proxy.ts incident (2026-08-03)
  // ═══════════════════════════════════════════════════════════════
  {
    name: "Framework Convention Override (Anti-Pattern)",
    category: "governance",
    languages: ["typescript", "javascript"],
    trigger: /\b(middleware\.ts|middleware\.js|proxy\.ts|proxy\.js)\b/i,
    safeguards: [
      { pattern: /\b(next@|next\s+16|next\s+17|next\s+18)\b/i, label: "next_version_check" },
    ],
    violationMessage:
      "Framework convention file detected without version verification. " +
      "If this project uses Next.js 16+, 'proxy.ts' is the correct convention (not 'middleware.ts'). " +
      "Do not rename framework-generated files based on training data defaults. " +
      "Check node_modules/<framework>/dist/docs/ for the current version's conventions. " +
      "See: docs/proxy-ts-lesson.md",
    conceptMissing: ["FrameworkVersionAwareness", "ConventionVerification"],
    conceptExpected: ["version-specific convention", "framework docs check"],
  },

  // ═══════════════════════════════════════════════════════════════
  // P0 Round 4: PLSB coverage safeguards — Session Fixation,
  //              Privilege Escalation, API Contract
  // ═══════════════════════════════════════════════════════════════

  // ── PLS-005: Session Fixation — session not invalidated on logout ──
  // v2 (2026-08-15): recognize store-based invalidation — splicing/filtering the
  // session store IS invalidation (144 FPs on the 100-project benchmark came from
  // logouts that do `sessions.splice(idx, 1)`). Also, a function that delegates to
  // a logout-named function is not itself failing to invalidate — the logout
  // function's own body is where the check belongs (callsOnly guard).
  {
    name: "Session Fixation (Logout without Invalidation)",
    category: "session_fixation",
    languages: ["typescript", "javascript", "python"],
    trigger: /\b(logout|signOut|logOut|signout|doLogout|handleLogout|endSession|clearSession|do_logout|sign_out|log_out|handle_logout|end_session|clear_session|invalidate_session)\b/i,
    safeguards: [
      { pattern: /\b(session\w*destroy|destroy\w*session|session\w*invalidate|invalidate\w*session|session\w*revoke|revoke\w*session|session\w*clear|clear\w*session|session\w*end|end\w*session|session\w*expire|expire\w*session|token\w*revoke|revoke\w*token|token\w*blacklist|blacklist\w*token|invalidate\w*token)\b/i, label: "session_invalidate" },
      // Store-based invalidation: remove the session entry from the store.
      { pattern: /\b(splice|filter|pop|shift|clear|delete_cookie|delete_cookies)\b/i, label: "store_invalidate" },
      // Delegation: calling a logout-named function hands invalidation to that
      // function (its own body is checked separately).
      { pattern: /\b(logout|signOut|logOut|signout|doLogout|handleLogout|endSession|clearSession|do_logout|sign_out|log_out|handle_logout|end_session|clear_session|invalidate_session)\b/i, label: "delegated_logout", callsOnly: true },
    ],
    violationMessage: "Logout function does not destroy/invalidate the session. Old session tokens remain valid, enabling session hijacking (session fixation).",
    conceptMissing: ["SessionInvalidation", "SessionRevocation"],
    conceptExpected: ["session.destroy", "session.invalidate", "session.revoke"],
  },

  // ── PLS-006: Privilege Escalation — admin action without role check ──
  {
    name: "Privilege Escalation (Admin without Role Check)",
    category: "privilege_escalation",
    trigger: /\b(deleteAll|deleteUser|deleteAccount|banUser|modifyRole|assignRole|grantPermission|manageSystem|systemConfig|adminDelete|adminRemove|adminBan|bulkDelete|massDelete)\b/i,
    safeguards: [
      { pattern: /\b(checkRole|verifyAdmin|requireAdmin|isAdmin|hasRole|checkPermission|hasPermission|requireRole|adminOnly|authorize|checkAccess|verifyRole|isAuthorized|canDelete|canModify|canManage)\b/i, label: "admin_check" },
    ],
    violationMessage: "Privileged/admin action does not verify the user's role or permissions before executing. An attacker with a lower-privilege account could perform this action.",
    conceptMissing: ["RoleVerification", "PermissionCheck"],
    conceptExpected: ["checkRole", "isAdmin", "hasPermission"],
  },

  // ── PLS-013: API Contract — Express/tRPC handler without input validation ──
  {
    name: "API Contract (Handler without Input Validation)",
    category: "missing_validation",
    languages: ["typescript", "javascript"],
    trigger: /\b(router\.(get|post|put|delete|patch)|app\.(get|post|put|delete|patch)|publicProcedure|protectedProcedure|adminProcedure|\.query\(|\.mutation\()\b/i,
    safeguards: [
      { pattern: /\b(z\.(string|number|object|array|boolean|enum|union|record)|zodSchema|validateRequest|validateBody|validateQuery|validateParams|parseAsync|\.parse\(|\.safeParse\(|checkSchema|body\(|param\(|query\(|expressValidator|celebrate)\b/i, label: "input_validation" },
    ],
    violationMessage: "API endpoint handler does not validate input. Missing Zod schema, express-validator, or parameter validation. This allows malformed/injection payloads to reach business logic.",
    conceptMissing: ["InputValidation", "SchemaValidation"],
    conceptExpected: ["z.object", "zod", "express-validator", "validate"],
  },

  // ── API Contract — DB write without input sanitization ──
  {
    name: "API Contract (DB Write without Sanitization)",
    category: "missing_validation",
    languages: ["typescript", "javascript"],
    trigger: /\b(db\.(insert|update|delete)|\w*\.(insert|update|delete)\(|database\w*\.(insert|update|delete)|db\.(execute|run|query)\(.*INSERT|UPDATE.*SET)\b/i,
    safeguards: [
      { pattern: /\b(validate|sanitize|escape|strip|clean|filter|z\.|\.safeParse|\.parse\(|checkPermission|verifyAuth|hasRole|isAdmin|authorize)\b/i, label: "data_sanitize_or_auth" },
    ],
    violationMessage: "Database write operation does not validate/sanitize input or check authorization. Risk of SQL injection, data corruption, or unauthorized data modification.",
    conceptMissing: ["InputSanitization", "WriteAuthorization"],
    conceptExpected: ["validate", "sanitize", "checkPermission", "zod"],
  },
];

// ── Safeguard Detection ──

export interface SafeguardViolation {
  rule: string;
  category: string;
  type: "missing_safeguard";
  detail: string;
  conceptDetail?: string;
  missingConcepts?: string[];
  expectedConcepts?: string[];
}

/**
 * Identifier Parser: splits camelCase/PascalCase/snake_case into words.
 * registerNewUser → ["register", "New", "User"]
 * doLogin         → ["do", "Login"]
 * verifyToken     → ["verify", "Token"]
 * Not AST. Just smarter string splitting.
 */
export function identifierParse(name: string): string[] {
  // Split on snake_case, kebab-case, dots
  const parts = name.split(/[_\-\.]/);
  const words: string[] = [];
  for (const part of parts) {
    // Split camelCase/PascalCase: "registerNewUser" → ["register", "New", "User"]
    const camelWords = part.replace(/([a-z])([A-Z])/g, "$1 $2").split(" ");
    for (const w of camelWords) {
      if (w.length > 0) words.push(w);
    }
  }
  return words;
}

/**
 * Detect missing safeguards in function call sequences.
 * Uses identifier parsing to match compound names (registerNewUser → register).
 */
export function detectSafeguardViolations(calls: string[], enclosingFuncName?: string, language?: string, params?: string[], exposed?: boolean): SafeguardViolation[] {
  const violations: SafeguardViolation[] = [];

  // Build effective calls: raw names + identifier-parsed words.
  // Class-qualified names (Class.method) contribute only their METHOD name —
  // a class name like SetCommands/ListCommands must not leak "Set"/"List"
  // words into trigger matching (real-world collision class found in redis-py).
  const ownName = enclosingFuncName ? (enclosingFuncName.split(".").pop() || enclosingFuncName) : undefined;
  const rawCalls = ownName ? [ownName, ...calls] : [...calls];
  const parsedWords: string[] = [];
  for (const c of rawCalls) {
    parsedWords.push(...identifierParse(c));
  }
  const effectiveCalls = [...new Set([...rawCalls, ...parsedWords])];

  // Skip authorization rules for auth functions — check both raw lowercased name and parsed words
  const rawLower = enclosingFuncName?.toLowerCase() || "";
  const AUTH_PATTERN = /\b(register|signup|signin|login|authenticate|createuser|createaccount|registeruser|registernewuser|dologin|verifytoken|validatesession|getuser|getsessionuser|getcurrentuser|endsession|logout|signout|dologout|destroysession|invalidatesession|invalidate|signout|create_account|register_new_user|register_user|sign_up|create_user|do_login|sign_in|log_in|verify_token|validate_session|get_user|get_session_user|get_current_user|do_logout|sign_out|log_out|end_session|invalidate_session|clear_session)\b/i;
  const isAuthFunction = enclosingFuncName != null && (
    AUTH_PATTERN.test(rawLower) ||
    identifierParse(enclosingFuncName).some(w => AUTH_PATTERN.test(w))
  );

  // Filter rules by language
  const activeRules = language
    ? SAFEGUARD_RULES.filter(r => !r.languages || r.languages.includes(language))
    : SAFEGUARD_RULES;

  for (const rule of activeRules) {
    // Check if trigger matches
    const triggerCalls = rule.triggerCallsOnly ? rawCalls : effectiveCalls;
    const triggerMatch = triggerCalls.some(c => rule.trigger.test(c));
    if (!triggerMatch) continue;

    // Semantic precondition marker (extractor-emitted)
    if (rule.requireMarker && !effectiveCalls.includes(rule.requireMarker)) continue;

    // Skip authorization rules for auth functions — they ARE the auth
    if (isAuthFunction && rule.category === "authorization") continue;

    // Param-gated rules (parentRefGated): only apply when the function takes a
    // parent-reference parameter. Requires the caller to pass param names.
    if (rule.parentRefGated && params) {
      const hasParentRef = params.some(p => /Id$/i.test(p) || /^entityType$/i.test(p));
      if (!hasParentRef) continue;
    }

    // Surface gate (paramGated): only apply to functions that can plausibly
    // authenticate — routed by a web handler (exposed) or taking an
    // identity-ish parameter. Requires the caller to pass param names.
    if (rule.paramGated && params) {
      const hasIdentity = params.some(p =>
        /\b(token|session|user|auth|request|scope|cookie|credential|permission|role|identity)\b/i.test(p));
      if (!hasIdentity && !exposed) continue;
    }

    // Check if at least one safeguard matches
    const guards = (params && rule.strictSafeguards) ? rule.strictSafeguards : rule.safeguards;
    const matchedSafeguard = guards.find(s => {
      const testCalls = s.callsOnly ? (calls || []) : effectiveCalls;
      return testCalls.some(c => s.pattern.test(c));
    });
    if (matchedSafeguard) continue;

    // Check excludePatterns (library functions where safeguard is deferred to separate API)
    if (rule.excludePatterns) {
      const excluded = effectiveCalls.some(c => rule.excludePatterns!.some(ep => ep.test(c)));
      if (excluded) continue;
    }

    // No safeguard matched → violation
    violations.push({
      rule: rule.name,
      category: rule.category,
      type: "missing_safeguard",
      detail: rule.violationMessage,
      conceptDetail: `Missing: ${rule.conceptMissing.join(", ")}. Expected at least one of: ${rule.conceptExpected.join(", ")}`,
      missingConcepts: rule.conceptMissing,
      expectedConcepts: rule.conceptExpected,
    });
  }

  return violations;
}

// ═══════════════════════════════════════════════════════════════
// v7: Call Graph — Function-level Context
// ═══════════════════════════════════════════════════════════════

/**
 * Build a reverse call graph: function name → list of caller function names.
 * From IR FunctionInfo[].calls[], computes the inverse: who calls each function.
 */
export function buildCallerMap(funcs: Array<{ name: string; calls?: string[] }>): Map<string, string[]> {
  const callerMap = new Map<string, string[]>();
  for (const f of funcs) {
    if (!f.calls) continue;
    for (const callee of f.calls) {
      if (!callerMap.has(callee)) callerMap.set(callee, []);
      callerMap.get(callee)!.push(f.name);
    }
  }
  return callerMap;
}

/**
 * v7: Build safeguard context — own → same-file → caller chain.
 *
 * Hierarchy:
 *   1. Function's own calls + identifier-parsed words
 *   2. Same-file functions' calls (file-level, as v6)
 *   3. Transitive caller chain calls (new in v7)
 */
function buildSafeguardContext(
  funcName: string,
  callerMap: Map<string, string[]>,
  funcCalls: Map<string, Set<string>>,
  fileCalls: Map<string, Set<string>>,
  funcFile: Map<string, string>,
  visited: Set<string> = new Set()
): Set<string> {
  if (visited.has(funcName)) return new Set();
  visited.add(funcName);

  const context = new Set<string>(funcCalls.get(funcName) || []);
  // Parse identifier words from funcName itself
  for (const w of identifierParse(funcName)) context.add(w);

  // ▸ Same-file context (inherited from v6)
  const file = funcFile.get(funcName);
  if (file && fileCalls.has(file)) {
    for (const c of fileCalls.get(file)!) context.add(c);
  }

  // ▸ Caller chain context (new in v7)
  const callers = callerMap.get(funcName) || [];
  for (const caller of callers) {
    const callerContext = buildSafeguardContext(caller, callerMap, funcCalls, fileCalls, funcFile, visited);
    for (const c of callerContext) context.add(c);
  }

  return context;
}

/**
 * v7: Detect missing safeguards — Function Context + Call Graph.
 *
 * Trigger check: function's own body + file-level calls (same scope as v6).
 * Safeguard check: own → same-file → transitive caller chain (superset of v6).
 *
 * Rationale: narrow triggers (own-body only) break Recall on C projects where
 * function names don't carry trigger keywords. Keeping v6's file-level trigger
 * while expanding safeguard context to include caller chain preserves Recall
 * and improves Precision.
 */
export function detectSafeguardViolationsV7(
  calls: string[],
  enclosingFuncName: string | undefined,
  callerMap: Map<string, string[]>,
  funcCalls: Map<string, Set<string>>,
  fileCalls: Map<string, Set<string>>,
  funcFile: Map<string, string>,
  language?: string
): SafeguardViolation[] {
  const violations: SafeguardViolation[] = [];

  // Build effective calls for trigger scope: own body + file-level (same as v6)
  const rawCalls = enclosingFuncName ? [enclosingFuncName, ...calls] : [...calls];

  // Add file-level calls to trigger scope (preserves v6 Recall)
  const file = enclosingFuncName ? funcFile.get(enclosingFuncName) : undefined;
  const fileLevelCalls = file && fileCalls.has(file) ? [...fileCalls.get(file)!] : [];
  const triggerRawCalls = [...new Set([...rawCalls, ...fileLevelCalls])];

  const triggerParsedWords: string[] = [];
  for (const c of triggerRawCalls) {
    triggerParsedWords.push(...identifierParse(c));
  }
  const triggerEffectiveCalls = [...new Set([...triggerRawCalls, ...triggerParsedWords])];

  // Build safeguard context: own + file + all transitive callers
  const safeContext: Set<string> = enclosingFuncName
    ? buildSafeguardContext(enclosingFuncName, callerMap, funcCalls, fileCalls, funcFile)
    : new Set(triggerEffectiveCalls);

  for (const c of triggerEffectiveCalls) safeContext.add(c);

  // Skip authorization rules for auth functions
  const rawLower = enclosingFuncName?.toLowerCase() || "";
  const AUTH_PATTERN = /\b(register|signup|signin|login|authenticate|createuser|createaccount|registeruser|registernewuser|dologin|verifytoken|validatesession|getuser|getsessionuser|getcurrentuser|endsession|logout|signout|dologout|destroysession|invalidatesession|invalidate|signout|create_account|register_new_user|register_user|sign_up|create_user|do_login|sign_in|log_in|verify_token|validate_session|get_user|get_session_user|get_current_user|do_logout|sign_out|log_out|end_session|invalidate_session|clear_session)\b/i;
  const isAuthFunction = enclosingFuncName != null && (
    AUTH_PATTERN.test(rawLower) ||
    identifierParse(enclosingFuncName).some(w => AUTH_PATTERN.test(w))
  );

  // Filter rules by language
  const activeRulesV7 = language
    ? SAFEGUARD_RULES.filter(r => !r.languages || r.languages.includes(language))
    : SAFEGUARD_RULES;

  for (const rule of activeRulesV7) {
    // v7b: trigger check against own body + file-level (same scope as v6)
    const triggerMatch = triggerEffectiveCalls.some(c => rule.trigger.test(c));
    if (!triggerMatch) continue;

    if (isAuthFunction && rule.category === "authorization") continue;

    // v7: safeguard check against FULL context (own + file + callers)
    const matchedSafeguard = rule.safeguards.find(s =>
      [...safeContext].some(c => s.pattern.test(c))
    );
    if (matchedSafeguard) continue;

    // Check excludePatterns (library functions where safeguard is deferred to separate API)
    if (rule.excludePatterns) {
      const excluded = triggerEffectiveCalls.some(c => rule.excludePatterns!.some(ep => ep.test(c)));
      if (excluded) continue;
    }

    violations.push({
      rule: rule.name,
      category: rule.category,
      type: "missing_safeguard",
      detail: rule.violationMessage,
      conceptDetail: `Missing: ${rule.conceptMissing.join(", ")}. Expected at least one of: ${rule.conceptExpected.join(", ")}`,
      missingConcepts: rule.conceptMissing,
      expectedConcepts: rule.conceptExpected,
    });
  }

  return violations;
}

// ═══════════════════════════════════════════════════════════════
// Detection
// ═══════════════════════════════════════════════════════════════

export interface ProtocolViolation {
  protocol: string; category: string;
  type: "missing_step" | "wrong_order" | "incomplete";
  missing: string[]; detail: string;
  /** Concept-level explanation: which specific protocol concepts are missing */
  conceptDetail?: string;
  missingConcepts?: string[];
  foundConcepts?: string[];
}

// ── Concept Mapping (Ontology → Detector) ──

const CONCEPT_MAP: Record<string, Record<string, string[]>> = {
  "TLS Handshake": { "tls_init": ["ClientHello"], "tls_connect": ["ServerHello", "Certificate"], "tls_free": ["Finished"] },
  "SSH Connection": { "ssh_init": ["Connection"], "ssh_auth": ["Authentication"], "ssh_done": ["Channel"] },
  "HTTP Request": { "http_init": ["Request"], "http_send": ["Response"], "http_cleanup": ["Cleanup"] },
  "HTTP/2 Session": { "h2_init": ["Session Init"], "h2_send": ["Stream Submit"], "h2_close": ["Session Close"] },
};

function enrichWithConcepts(v: ProtocolViolation, matchedLabels: string[]): ProtocolViolation {
  const m = CONCEPT_MAP[v.protocol]; if (!m) return v;
  const mc: string[] = [], fc: string[] = [];
  for (const l of v.missing) { const c = m[l] || [l]; mc.push(...c); }
  for (const l of matchedLabels) { const c = m[l] || [l]; fc.push(...c); }
  v.missingConcepts = [...new Set(mc)]; v.foundConcepts = [...new Set(fc)];
  v.conceptDetail = `Missing: ${v.missingConcepts.join(", ")}. Found: ${v.foundConcepts.join(", ")}`;
  return v;
}

export function detectProtocolViolations(calls: string[]): ProtocolViolation[] {
  const violations: ProtocolViolation[] = [];
  for (const proto of ALL_PROTOCOLS) {
    const matched: Array<{ label: string; index: number; required: boolean }> = [];
    for (let ci = 0; ci < calls.length; ci++) {
      for (const step of proto.steps) {
        if (step.pattern.test(calls[ci])) {
          if (!matched.some(m => m.label === step.label)) matched.push({ label: step.label, index: ci, required: step.required });
          break;
        }
      }
    }
    if (matched.length < 2) continue;
    const requiredSteps = proto.steps.filter(s => s.required);
    const matchedRequired = matched.filter(m => m.required);
    const completeness = matchedRequired.length / requiredSteps.length;
    const missing: string[] = [];
    for (const rs of requiredSteps) {
      if (!matchedRequired.some(m => m.label === rs.label)) missing.push(rs.label);
    }
    const labels = matched.map(m => m.label);
    if (missing.length > 0) {
      violations.push(enrichWithConcepts({ protocol: proto.name, category: proto.category, type: "missing_step", missing, detail: `${proto.name} missing: ${missing.join(", ")}. Found: ${labels.join(" → ")}` }, labels));
      continue;
    }
    if (completeness < proto.minCompleteness) {
      violations.push(enrichWithConcepts({ protocol: proto.name, category: proto.category, type: "incomplete", missing: proto.steps.filter(s => s.required && !labels.includes(s.label)).map(s => s.label), detail: `${proto.name}: ${(completeness * 100).toFixed(0)}% complete. Found: ${labels.join(" → ")}` }, labels));
    }
  }
  return violations;
}

export function validateProtocolState(calls: string[]): { valid: boolean; violations: ProtocolViolation[]; matchedProtocols: string[]; detail: string } {
  const violations = detectProtocolViolations(calls);
  const matchedProtocols = [...new Set(violations.map(v => v.protocol))];
  const detail = violations.length === 0 ? "Protocol state complete" : violations.map(v => v.conceptDetail || v.detail).join("; ");
  return { valid: violations.length === 0, violations, matchedProtocols, detail };
}

export function validateCombined(calls: string[], enclosingFuncName?: string): { valid: boolean; resourceViolations: any[]; protocolViolations: ProtocolViolation[]; safeguardViolations: SafeguardViolation[]; detail: string } {
  const { validateResourceLifecycle } = require("./resource-detector");
  const res = validateResourceLifecycle(calls, enclosingFuncName);
  const proto = validateProtocolState(calls);
  const safe = detectSafeguardViolations(calls, enclosingFuncName);
  const all = [...res.violations, ...proto.violations, ...safe];
  return { valid: all.length === 0, resourceViolations: res.violations, protocolViolations: proto.violations, safeguardViolations: safe, detail: all.map((v: any) => v.detail || "").join("; ") || "All checks passed" };
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  const fs = require("fs"); const path = require("path");
  const args = process.argv.slice(2);
  const repoPath = path.resolve(args.find((a: string) => !a.startsWith("--")) || ".");
  const baseDir = path.dirname(repoPath); const repoName = path.basename(repoPath);
  const seqFile = path.join(baseDir, `${repoName}-sequences.json`);
  const labelFile = path.join(baseDir, `${repoName}-labels.json`);
  const mode = args.includes("--protocol") ? "protocol" : args.includes("--resource") ? "resource" : "combined";
  if (!fs.existsSync(seqFile) || !fs.existsSync(labelFile)) { console.error("Files not found"); process.exit(1); }
  const seqData = JSON.parse(fs.readFileSync(seqFile, "utf-8"));
  const labelData = JSON.parse(fs.readFileSync(labelFile, "utf-8"));
  const sequences = seqData.sequences || seqData; const labels = labelData.labels || labelData;
  let tp = 0, fp = 0, tn = 0, fn = 0; const mismatches: any[] = [];
  for (const seq of sequences) {
    const idx = sequences.indexOf(seq); const expected = labels[idx];
    if (!expected || expected === "s" || expected === "skip") continue;
    const funcName = seq.function || "";
    let detected: "clean" | "violation"; let detail = "";
    if (mode === "resource") { const r = require("./resource-detector").validateResourceLifecycle(seq.calls || [], funcName); detected = r.valid ? "clean" : "violation"; detail = r.detail; }
    else if (mode === "protocol") { const r = validateProtocolState(seq.calls || []); detected = r.valid ? "clean" : "violation"; detail = r.detail; }
    else { const r = validateCombined(seq.calls || [], funcName); detected = r.valid ? "clean" : "violation"; detail = r.detail; }
    if (expected === "violation" && detected === "violation") tp++; else if (expected === "clean" && detected === "violation") fp++; else if (expected === "clean" && detected === "clean") tn++; else if (expected === "violation" && detected === "clean") fn++;
    if (expected !== detected) mismatches.push({ idx, fn: funcName, expected, detected, calls: (seq.calls || []).slice(0, 5), detail });
  }
  const total = tp + fp + tn + fn;
  const P = tp + fp > 0 ? tp / (tp + fp) : 0; const R = tp + fn > 0 ? tp / (tp + fn) : 0;
  const F1 = P + R > 0 ? 2 * P * R / (P + R) : 0;
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  const C = { r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", r2: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m" };
  const clr = (v: number) => v >= 0.7 ? C.g : v >= 0.5 ? C.y : C.r2;
  const label = mode === "resource" ? "Resource Lifecycle" : mode === "protocol" ? "Protocol State Machine" : "Combined (Resource + Protocol)";
  console.log(`\n${C.b}${C.c}╔══════════════════════════════════════════════╗${C.r}`);
  console.log(`${C.b}${C.c}║${C.r}  ${C.b}${label} — ${repoName}${C.r}${" ".repeat(Math.max(0, 30 - label.length - repoName.length))}${C.b}${C.c}║${C.r}`);
  console.log(`${C.b}${C.c}╚══════════════════════════════════════════════╝${C.r}\n`);
  console.log(`  Samples:    ${total}\n  TP: ${C.g}${tp}${C.r}  FP: ${C.r2}${fp}${C.r}  TN: ${C.g}${tn}${C.r}  FN: ${C.r2}${fn}${C.r}\n`);
  console.log(`  Precision:  ${clr(P)}${pct(P)}${C.r}\n  Recall:     ${clr(R)}${pct(R)}${C.r}\n  F1:         ${clr(F1)}${pct(F1)}${C.r}\n`);
  if (mismatches.length > 0) { console.log(`  ${C.y}Details:${C.r}`); for (const m of mismatches.slice(0, 12)) console.log(`    ${m.expected === "violation" ? C.r2 + "FN" : C.y + "FP"}${C.r} [${m.idx}] ${m.expected}→${m.detected}  ${(m.calls || []).join(" → ")}` + (m.detail ? `\n       ${C.d}${m.detail.slice(0, 100)}${C.r}` : "")); }
  console.log(`\n  Rating: ${F1 >= 0.7 ? C.g + "GOOD" : F1 >= 0.5 ? C.y + "FAIR" : C.r2 + "NEEDS IMPROVEMENT"}${C.r}\n`);
}
