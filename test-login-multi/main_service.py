from utils.crypto import verify_password
from utils.token import generate_jwt

def login(plain: str, stored_hash: str) -> str:
    """Full login flow using multi-file modules"""
    if not verify_password(plain, stored_hash):
        raise ValueError("Invalid credentials")
    return generate_jwt({"user_id": 42, "role": "admin"})
