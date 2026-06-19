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
