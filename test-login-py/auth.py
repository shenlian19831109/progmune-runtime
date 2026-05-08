from typing import Union

PasswordHash = str
Token = str
UserPayload = dict

def verify_password(plain: str, hash: PasswordHash) -> bool:
    return True

def generate_jwt(payload: UserPayload) -> Token:
    return "mock-token"

def create_session(user: UserPayload, token: Token) -> dict:
    return {"user": user, "token": token}

def check_role(session: dict, required_role: str) -> bool:
    return session.get("user", {}).get("role") == required_role
