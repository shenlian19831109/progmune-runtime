#!/bin/bash
set -e
echo "📦 生成 200+ 函数大型测试项目..."

PROJECT="test-xlarge"
rm -rf $PROJECT
mkdir -p $PROJECT/services $PROJECT/utils $PROJECT/models $PROJECT/api $PROJECT/tasks

# 生成大量函数（总计 220+）
cat > $PROJECT/models/data.py << 'EOF'
from typing import Dict, List, Optional, Any
def validate_user(u: Dict) -> bool: return True
def extract_id(p: Dict) -> int: return p.get("id",0)
def merge_data(a: Dict, b: Dict) -> Dict: return {**a,**b}
def filter_active(items: List[Dict]) -> List[Dict]: return [i for i in items if i.get("active")]
def paginate(items: List, page: int, size: int) -> List: return items[(page-1)*size:page*size]
def sort_by_key(items: List[Dict], key: str) -> List[Dict]: return sorted(items, key=lambda x: x.get(key,""))
def group_by_category(items: List[Dict]) -> Dict[str,List]: 
    g={}
    for i in items: g.setdefault(i.get("category"),[]).append(i)
    return g
def validate_email(e: str) -> bool: return "@" in e
def validate_phone(p: str) -> bool: return len(p)>=10
def hash_password(pwd: str) -> str: return "hashed_"+pwd
def verify_password_hash(p: str, h: str) -> bool: return h=="hashed_"+p
def encode_jwt(c: Dict) -> str: return "jwt_"+str(c)
def decode_jwt(t: str) -> Optional[Dict]: return {"user_id":1} if t.startswith("jwt_") else None
def format_date(ts: int) -> str: return "2025-01-01"
def parse_date(d: str) -> int: return 1700000000
def unique_ids(ids: List[int]) -> List[int]: return list(set(ids))
def intersection(a: List, b: List) -> List: return list(set(a)&set(b))
def union(a: List, b: List) -> List: return list(set(a)|set(b))
def safe_get(d: Dict, k: str, default: Any = None) -> Any: return d.get(k, default)
def deep_copy(d: Dict) -> Dict: return {**d}
def filter_by_status(items: List[Dict], status: str) -> List[Dict]: return [i for i in items if i.get("status")==status]
def count_items(items: List) -> int: return len(items)
def sum_field(items: List[Dict], field: str) -> float: return sum(i.get(field,0) for i in items)
def avg_field(items: List[Dict], field: str) -> float: return sum_field(items,field)/max(1,len(items))
def max_field(items: List[Dict], field: str) -> float: return max(i.get(field,0) for i in items)
def min_field(items: List[Dict], field: str) -> float: return min(i.get(field,0) for i in items)
def transform_items(items: List[Dict], func: callable) -> List: return list(map(func, items))
def filter_by_range(items: List[Dict], field: str, lo: float, hi: float) -> List[Dict]:
    return [i for i in items if lo <= i.get(field,0) <= hi]
def flatten_dict(d: Dict, prefix: str="") -> Dict:
    items={}
    for k,v in d.items():
        new_key=f"{prefix}.{k}" if prefix else k
        if isinstance(v,dict): items.update(flatten_dict(v, new_key))
        else: items[new_key]=v
    return items
def rename_key(d: Dict, old: str, new: str) -> Dict:
    if old in d: d[new]=d.pop(old)
    return d
def omit_keys(d: Dict, keys: List[str]) -> Dict: return {k:v for k,v in d.items() if k not in keys}
def pick_keys(d: Dict, keys: List[str]) -> Dict: return {k:v for k,v in d.items() if k in keys}
EOF

cat > $PROJECT/utils/helpers.py << 'EOF'
from typing import List, Dict, Any
import time, random, math
def current_timestamp() -> int: return int(time.time())
def random_id() -> str: return "id_"+str(random.randint(1000,9999))
def retry(func, max_tries: int=3): 
    for i in range(max_tries):
        try: return func()
        except: pass
    raise Exception("max retries")
def cache_result(key: str, value: str, ttl: int=60): pass
def get_cached(key: str) -> Optional[str]: return None
def log_info(msg: str): print(f"[INFO] {msg}")
def log_error(msg: str): print(f"[ERROR] {msg}")
def measure_time(func):
    start=time.time(); r=func(); print(f"time: {time.time()-start}"); return r
def chunk_list(lst: List, size: int) -> List[List]: return [lst[i:i+size] for i in range(0,len(lst),size)]
def flatten(lst: List[List]) -> List: return [i for s in lst for i in s]
def dict_to_list(d: Dict) -> List: return list(d.items())
def unique_values(d: Dict) -> List: return list(set(d.values()))
def safe_divide(a: float, b: float) -> float: return a/b if b else 0.0
def percentage(p: float, t: float) -> float: return (p/t)*100 if t else 0
def clamp(v: float, lo: float, hi: float) -> float: return max(lo, min(v, hi))
def format_bytes(size: int) -> str:
    for unit in ['B','KB','MB','GB']:
        if size<1024: return f"{size:.1f} {unit}"
        size/=1024
    return f"{size:.1f} TB"
def levenshtein(a: str, b: str) -> int:
    m,n=len(a),len(b); dp=[[0]*(n+1) for _ in range(m+1)]
    for i in range(m+1): dp[i][0]=i
    for j in range(n+1): dp[0][j]=j
    for i in range(1,m+1):
        for j in range(1,n+1):
            cost=0 if a[i-1]==b[j-1] else 1
            dp[i][j]=min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost)
    return dp[m][n]
def generate_uuid() -> str: return str(random.randint(100000,999999))
def strip_html(text: str) -> str:
    import re
    return re.sub(r'<[^>]+>','',text)
def slugify(text: str) -> str:
    return re.sub(r'[^a-z0-9]+','-',text.lower()).strip('-')
def tokenize(text: str) -> List[str]: return text.split()
def ngrams(text: str, n: int=2) -> List[str]:
    words=text.split()
    return [' '.join(words[i:i+n]) for i in range(len(words)-n+1)]
EOF

cat > $PROJECT/services/auth.py << 'EOF'
from typing import Dict, Tuple, Optional
def authenticate(u: str, p: str) -> Tuple[bool, str]:
    if u=="admin" and p=="secret": return True, "token_admin"
    return False, ""
def refresh_token(old: str) -> str: return old+"_refreshed"
def check_permission(user: Dict, action: str) -> bool: return user.get("role")=="admin"
def create_session(uid: int, ip: str) -> Dict: return {"user_id":uid, "ip":ip, "timestamp":0}
def destroy_session(sid: str) -> bool: return True
def verify_captcha(resp: str) -> bool: return resp!=""
def rate_limit(key: str, max_calls: int, window: int) -> bool: return True
def audit_log(action: str, user: str): print(f"[AUDIT] {user}: {action}")
def login_2fa(uid: int, code: str) -> bool: return code=="123456"
def encrypt_aes(data: str, key: str) -> str: return "enc_"+data
def decrypt_aes(enc: str, key: str) -> str: return enc[4:]
def generate_csrf() -> str: return "csrf_token"
def validate_csrf(tok: str) -> bool: return tok=="csrf_token"
def logout_user(sid: str): pass
def lock_account(uid: int): pass
def unlock_account(uid: int): pass
def reset_password(uid: int, new_pw: str) -> bool: return True
def send_password_reset(email: str): pass
def verify_reset_token(tok: str) -> Optional[int]: return 1
def two_factor_enabled(uid: int) -> bool: return False
def generate_backup_codes(uid: int) -> List[str]: return ["code1","code2"]
def invalidate_sessions(uid: int): pass
def get_user_roles(uid: int) -> List[str]: return ["user"]
def set_user_role(uid: int, role: str): pass
def check_sso(token: str) -> bool: return False
def sso_callback(payload: Dict) -> Dict: return {"user_id":1}
EOF

cat > $PROJECT/services/payment.py << 'EOF'
from typing import Dict, List, Optional
def charge(amount: float, method: str) -> bool: return True
def refund(txn_id: str) -> bool: return True
def get_transactions(uid: int) -> List: return []
def validate_card(card: str) -> bool: return len(card)==16
def encrypt_card(card: str) -> str: return "enc_"+card
def decrypt_card(enc: str) -> str: return enc[4:]
def process_batch(payments: List) -> List: return [True]*len(payments)
def convert_currency(amount: float, from_cur: str, to_cur: str) -> float: return amount*1.1
def send_invoice(uid: int, amount: float): pass
def generate_receipt(txn_id: str) -> str: return "receipt_"+txn_id
def schedule_payment(uid: int, amount: float, due: str): pass
def cancel_scheduled(schedule_id: str) -> bool: return True
def get_payment_methods(uid: int) -> List[Dict]: return [{"type":"card","last4":"1234"}]
def add_payment_method(uid: int, card: str): pass
def remove_payment_method(uid: int, method_id: str): pass
def set_default_method(uid: int, method_id: str): pass
def calculate_tax(amount: float, region: str) -> float: return amount*0.1
def apply_coupon(code: str, amount: float) -> float: return amount*0.9
def validate_coupon(code: str) -> bool: return True
def issue_partial_refund(txn_id: str, amount: float) -> bool: return True
def get_refund_status(refund_id: str) -> str: return "completed"
def void_transaction(txn_id: str) -> bool: return True
def capture_hold(txn_id: str) -> bool: return True
def create_hold(amount: float, method: str) -> str: return "hold_1"
def dispute_transaction(txn_id: str, reason: str): pass
def resolve_dispute(dispute_id: str, outcome: str): pass
def get_subscriptions(uid: int) -> List: return []
def create_subscription(uid: int, plan: str): pass
def cancel_subscription(sub_id: str): pass
def pause_subscription(sub_id: str): pass
def resume_subscription(sub_id: str): pass
EOF

cat > $PROJECT/api/endpoints.py << 'EOF'
from typing import Dict, List, Optional
def api_login(username: str, password: str) -> Dict: return {"token":"x"}
def api_logout(token: str) -> bool: return True
def api_get_user(user_id: int) -> Dict: return {"id":user_id}
def api_update_user(user_id: int, data: Dict) -> Dict: return {**data, "id":user_id}
def api_list_users(page: int=1, size: int=20) -> List: return []
def api_delete_user(user_id: int) -> bool: return True
def api_create_order(items: List[Dict]) -> Dict: return {"order_id":1}
def api_get_order(order_id: int) -> Dict: return {"id":order_id}
def api_list_orders(user_id: int) -> List: return []
def api_cancel_order(order_id: int) -> bool: return True
def api_process_return(order_id: int, reason: str) -> bool: return True
def api_search_products(q: str) -> List: return []
def api_get_product(pid: int) -> Dict: return {"id":pid}
def api_add_to_cart(user_id: int, pid: int, qty: int): pass
def api_checkout(user_id: int) -> Dict: return {"invoice_id":1}
def api_get_cart(user_id: int) -> Dict: return {"items":[]}
def api_apply_discount(code: str) -> float: return 0.1
def api_create_review(pid: int, rating: int, text: str): pass
def api_get_reviews(pid: int) -> List: return []
def api_upload_file(file: bytes) -> str: return "url"
def api_send_message(from_id: int, to_id: int, text: str): pass
def api_get_messages(user_id: int) -> List: return []
def api_mark_read(msg_id: int): pass
def api_create_group(name: str) -> Dict: return {"id":1}
def api_join_group(user_id: int, group_id: int): pass
def api_post_feed(user_id: int, content: str): pass
def api_get_feed(user_id: int) -> List: return []
def api_like_post(post_id: int): pass
def api_follow_user(follower: int, followee: int): pass
def api_get_followers(user_id: int) -> List: return []
def api_get_following(user_id: int) -> List: return []
def api_block_user(user_id: int, blocked_id: int): pass
def api_report_user(user_id: int, reason: str): pass
def api_get_notifications(user_id: int) -> List: return []
def api_mark_notification_read(notif_id: int): pass
def api_update_settings(user_id: int, settings: Dict): pass
def api_get_settings(user_id: int) -> Dict: return {}
def api_request_verification(user_id: int, doc: str): pass
def api_verify_account(token: str) -> bool: return True
def api_resend_verification(user_id: int): pass
EOF

cat > $PROJECT/tasks/jobs.py << 'EOF'
from typing import List, Dict, Callable
def enqueue(task: Callable, *args): pass
def dequeue() -> Optional[Callable]: return None
def schedule_daily(hour: int, func: Callable): pass
def run_scheduled(): pass
def retry_failed(): pass
def clear_cache(): pass
def rebuild_index(): pass
def generate_report(rpt_type: str) -> Dict: return {}
def send_emails(recipients: List[str], template: str): pass
def process_webhooks(payload: Dict): pass
def sync_database(): pass
def backup_to_s3(): pass
def restore_from_s3(backup_id: str): pass
def rotate_logs(): pass
def check_health() -> Dict: return {"status":"ok"}
def collect_metrics() -> Dict: return {}
def alert_on_metric(name: str, threshold: float): pass
def check_ssl_expiry(domain: str) -> int: return 30
def renew_certificates(): pass
def optimize_tables(): pass
def purge_old_records(days: int): pass
def validate_data_integrity(): pass
def run_migrations(version: str): pass
def rollback_migration(version: str): pass
def seed_database(): pass
def export_data(format: str) -> str: return "data."+format
def import_data(filepath: str): pass
def compress_files(directory: str): pass
def decompress_archive(filepath: str): pass
def calculate_statistics() -> Dict: return {}
def update_leaderboards(): pass
def expire_sessions(): pass
def revoke_tokens(): pass
def flag_inactive_users(): pass
def archive_old_logs(): pass
def generate_invoice_pdfs(): pass
EOF

echo "✅ 项目已生成，函数总数:"
find $PROJECT -name "*.py" -exec grep -E "^def " {} \; | wc -l

# 运行压力测试（为节省时间，减少规划器重试次数）
cat > src/generate.ts << 'NEWGENERATE'
import { extractIR } from "./extract-ir";
import { extractIRPython } from "./extract-ir-python";
import { plan } from "./planner";
import { searchPlan } from "./search-planner";
import { validateAction } from "./validator";
import { emitCode } from "./emitter";
import { emitPython } from "./python-emitter";
import { runAndCheck } from "./runtime";
import { recordRun } from "./feedback";
import { callCount } from "./llm";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

interface TestResult {
  intent: string;
  planner: string;
  duration_ms: number;
  llm_calls: number;
  success: boolean;
  error?: string;
}

async function main() {
  const results: TestResult[] = [];
  const intents = [
    "实现 login 函数，验证密码，成功则生成JWT，否则返回错误信息",
    "实现批量处理支付 transactions，对每笔交易校验卡片并记录日志",
    "实现数据报表函数，分页获取活跃用户，按类别分组并排序"
  ];
  const planners = ["llm", "search"] as const;
  const lang = "python";
  const projectPath = "./test-xlarge";

  const fns = extractIRPython(projectPath);
  fs.writeFileSync("ir.json", JSON.stringify(fns, null, 2));
  console.log(`✅ 项目规模: ${fns.length} 函数\n`);

  for (const intent of intents) {
    for (const planner of planners) {
      const start = Date.now();
      let actions: any[] = [];
      try {
        if (planner === "llm") {
          actions = await plan(intent);
        } else {
          actions = await searchPlan(intent, 2, 4);
        }
      } catch (e) {
        results.push({ intent, planner, duration_ms: Date.now() - start, llm_calls: callCount, success: false, error: String(e) });
        continue;
      }
      const duration = Date.now() - start;

      const validationResults = actions.map((a: any) => validateAction(a));
      const valid = validationResults.every((r: any) => r.valid);
      if (!valid || actions.length === 0) {
        results.push({ intent, planner, duration_ms: duration, llm_calls: callCount, success: false, error: "校验失败" });
        continue;
      }

      const code = emitPython(actions);
      const tmpFile = path.join(path.resolve(projectPath), "__test.py");
      fs.writeFileSync(tmpFile, code);
      let success = false;
      let error: string | undefined;
      try {
        execSync(`python3 ${tmpFile}`, { timeout: 5000, encoding: "utf-8", cwd: path.resolve(projectPath) });
        success = true;
      } catch (e: any) {
        error = e.stderr?.toString() || e.toString();
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }

      recordRun(intent, actions, success, error);
      results.push({ intent, planner, duration_ms: duration, llm_calls: callCount, success, error });
      console.log(`${planner} | ${intent.substring(0,20)}... | ${duration}ms | 调用:${callCount} | ${success ? '✅' : '❌'}`);
    }
  }

  console.log("\n📊 200函数压力测试报告:");
  console.table(results.map(r => ({
    Intent: r.intent.substring(0,30),
    Planner: r.planner,
    Time: r.duration_ms + 'ms',
    LLM: r.llm_calls,
    Success: r.success ? '✅' : '❌'
  })));

  fs.writeFileSync("stress_200_test.json", JSON.stringify(results, null, 2));
  console.log("报告已保存到 stress_200_test.json");

  // 计算统计指标
  const totalLLM = results.reduce((s, r) => s + r.llm_calls, 0);
  const avgTime = results.reduce((s, r) => s + r.duration_ms, 0) / results.length;
  const successRate = results.filter(r => r.success).length / results.length * 100;
  console.log(`\n📈 汇总: 总LLM调用=${totalLLM}, 平均耗时=${avgTime.toFixed(0)}ms, 成功率=${successRate.toFixed(0)}%`);
}

main().catch(console.error);
NEWGENERATE
echo "✅ 压力测试配置完成，开始运行..."
