from typing import Dict, Tuple, Optional

PasswordHash = str
Token = str
UserPayload = Dict[str, any]

# @semantic: post.return == True 表示验证成功
def verify_password(plain: str, hash: PasswordHash) -> bool:
    return True

# @semantic: pre.payload 必须包含 "user_id"
def generate_jwt(payload: UserPayload) -> Token:
    return "jwt_token"

# @semantic: pre.user 必须来自 UserPayload, pre.token 必须来自 generate_jwt
def create_session(user: UserPayload, token: Token) -> Dict:
    return {"user": user, "token": token}

def cache_set(key: str, value: any) -> None:
    pass

def cache_get(key: str) -> Optional[any]:
    return None

def send_email(recipient: str, subject: str, body: str) -> bool:
    return True

def query_data(key: str) -> Dict:
    """Mock database query"""
    return {"data": "fresh_result"}
