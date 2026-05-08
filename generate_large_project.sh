#!/bin/bash
set -e
PROJECT="test-large"
rm -rf $PROJECT
mkdir -p $PROJECT/services $PROJECT/utils $PROJECT/models

# 生成 models/data.py (20个函数)
cat > $PROJECT/models/data.py << 'EOF'
from typing import Dict, List, Optional, Any
def validate_user(user: Dict) -> bool: return True
def extract_id(payload: Dict) -> int: return payload.get("id", 0)
def merge_data(a: Dict, b: Dict) -> Dict: return {**a, **b}
def filter_active(items: List[Dict]) -> List[Dict]: return [i for i in items if i.get("active")]
def paginate(items: List, page: int, size: int) -> List: return items[(page-1)*size:page*size]
def sort_by_key(items: List[Dict], key: str) -> List[Dict]: return sorted(items, key=lambda x: x.get(key, ""))
def group_by_category(items: List[Dict]) -> Dict[str, List]: 
    groups = {}
    for i in items: groups.setdefault(i.get("category"), []).append(i)
    return groups
def validate_email(email: str) -> bool: return "@" in email
def validate_phone(phone: str) -> bool: return len(phone) >= 10
def hash_password(pwd: str) -> str: return "hashed_" + pwd
def verify_password_hash(plain: str, hashed: str) -> bool: return hashed == "hashed_" + plain
def encode_jwt(claims: Dict) -> str: return "jwt_" + str(claims)
def decode_jwt(token: str) -> Optional[Dict]: return {"user_id": 1} if token.startswith("jwt_") else None
def format_date(timestamp: int) -> str: return "2025-01-01"
def parse_date(date_str: str) -> int: return 1700000000
def unique_ids(ids: List[int]) -> List[int]: return list(set(ids))
def intersection(a: List, b: List) -> List: return list(set(a) & set(b))
def union(a: List, b: List) -> List: return list(set(a) | set(b))
def safe_get(d: Dict, key: str, default: Any = None) -> Any: return d.get(key, default)
def deep_copy(d: Dict) -> Dict: return {**d}
EOF

# 生成 utils/helpers.py (15个函数)
cat > $PROJECT/utils/helpers.py << 'EOF'
import time, random
def current_timestamp() -> int: return int(time.time())
def random_id() -> str: return "id_" + str(random.randint(1000,9999))
def retry(func, max_tries=3): 
    for i in range(max_tries):
        try: return func()
        except: pass
    raise Exception("max retries")
def cache_result(key: str, value: str, ttl: int = 60): pass
def get_cached(key: str) -> str: return ""
def log_info(msg: str): print(f"[INFO] {msg}")
def log_error(msg: str): print(f"[ERROR] {msg}")
def measure_time(func): 
    start = time.time(); result = func(); print(f"time: {time.time()-start}"); return result
def chunk_list(lst: List, size: int) -> List[List]: return [lst[i:i+size] for i in range(0, len(lst), size)]
def flatten(list_of_lists: List[List]) -> List: return [item for sub in list_of_lists for item in sub]
def dict_to_list(d: Dict) -> List: return list(d.items())
def unique_values(d: Dict) -> List: return list(set(d.values()))
def safe_divide(a: float, b: float) -> float: return a/b if b else 0.0
def percentage(part: float, total: float) -> float: return (part/total)*100 if total else 0
def clamp(value: float, min_val: float, max_val: float) -> float: return max(min_val, min(value, max_val))
EOF

# 生成 services/auth.py (15个函数)
cat > $PROJECT/services/auth.py << 'EOF'
from typing import Dict, Tuple
def authenticate(username: str, password: str) -> Tuple[bool, str]:
    if username == "admin" and password == "secret": return True, "token_admin"
    return False, ""
def refresh_token(old: str) -> str: return old + "_refreshed"
def check_permission(user: Dict, action: str) -> bool: return user.get("role") == "admin"
def create_session(user_id: int, ip: str) -> Dict: return {"user_id": user_id, "ip": ip, "timestamp": 0}
def destroy_session(session_id: str) -> bool: return True
def verify_captcha(response: str) -> bool: return response != ""
def rate_limit(key: str, max_calls: int, window: int) -> bool: return True
def audit_log(action: str, user: str): print(f"[AUDIT] {user}: {action}")
def login_2fa(user_id: int, code: str) -> bool: return code == "123456"
def encrypt_aes(data: str, key: str) -> str: return "enc_" + data
def decrypt_aes(enc_data: str, key: str) -> str: return enc_data[4:]
def generate_csrf_token() -> str: return "csrf_token"
def validate_csrf(token: str) -> bool: return token == "csrf_token"
def logout_user(session_id: str): pass
def lock_account(user_id: int): pass
EOF

# 生成 services/payment.py (10个函数)
cat > $PROJECT/services/payment.py << 'EOF'
from typing import Dict
def charge(amount: float, method: str) -> bool: return True
def refund(transaction_id: str) -> bool: return True
def get_transactions(user_id: int) -> list: return []
def validate_card(card_number: str) -> bool: return len(card_number) == 16
def encrypt_card(card: str) -> str: return "enc_" + card
def process_batch(payments: list) -> list: return [True] * len(payments)
def convert_currency(amount: float, from_cur: str, to_cur: str) -> float: return amount * 1.1
def send_invoice(user_id: int, amount: float): pass
def generate_receipt(transaction_id: str) -> str: return "receipt_" + transaction_id
def schedule_payment(user_id: int, amount: float, due_date: str): pass
EOF

echo "✅ 测试项目 $PROJECT 已创建，包含 60 个函数"
