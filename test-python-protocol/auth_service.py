"""
Python protocol example — auth service with @progmune decorators.

Demonstrates Python IR protocol extraction integrated with SSG validator.
"""

from typing import Optional, Dict

class PasswordHash:
    def verify(self, plain: str) -> bool: ...

class UserPayload:
    id: str
    role: str

class Token:
    value: str
    expires_at: int

# ── Auth protocol ──

@progmune(namespace="auth", pre=["UNAUTHENTICATED"], post=["PASSWORD_VERIFIED"])
def verify_password(plain: str, hash: PasswordHash) -> bool:
    """@purpose verify user credentials
    @requires plain password and stored hash
    @produces verification result"""
    return hash.verify(plain)

@progmune(namespace="auth", pre=["PASSWORD_VERIFIED"], post=["TOKEN_ISSUED"], inv=["PASSWORD_VERIFIED"])
def generate_jwt(payload: UserPayload) -> Token:
    """@purpose issue authentication token
    @requires verified password
    @produces JWT token"""
    return Token(value="jwt_xxx", expires_at=9999999)

@progmune(namespace="auth", pre=["TOKEN_ISSUED"], post=["SESSION_ACTIVE"], inv=["TOKEN_ISSUED"])
def create_session(user: UserPayload, token: Token) -> dict:
    """@purpose establish active session
    @requires issued token
    @produces active session"""
    return {"user": user.id, "token": token.value, "active": True}

@progmune(namespace="auth", pre=["SESSION_ACTIVE"], post=["UNAUTHENTICATED"], inv=["SESSION_ACTIVE"])
def logout(session: dict) -> None:
    """@purpose terminate user session
    @requires active session"""
    pass

# ── Stateless helpers ──

def compute_hash(data: str) -> str:
    """@purpose compute hash digest
    @tags stateless, crypto"""
    import hashlib
    return hashlib.sha256(data.encode()).hexdigest()

def validate_input(data: str) -> bool:
    """@purpose validate input format
    @tags stateless, validation"""
    return len(data) > 0 and not data.startswith("<script>")

# ── File protocol ──

@progmune(namespace="file", pre=[], post=["FILE_OPEN"])
def open_config(path: str) -> object:
    """@purpose open configuration file
    @produces file handle"""
    return open(path, "r")

@progmune(namespace="file", pre=["FILE_OPEN"], post=[])
def read_config(fh: object) -> dict:
    """@purpose read configuration from file handle
    @requires open file handle"""
    return {}

@progmune(namespace="file", pre=["FILE_OPEN"], post=[], inv=["FILE_OPEN"])
def close_config(fh: object) -> None:
    """@purpose close configuration file handle"""
    fh.close()

# ── Cross-protocol ──

@progmune(namespace="cross", pre=["UNAUTHENTICATED"], post=["AUTH_READY"])
def authenticate_and_open(filename: str) -> dict:
    """@purpose authenticate and open file in one step
    @tags cross-protocol"""
    verify_password("admin", PasswordHash())
    create_session(UserPayload(), Token())
    fh = open_config(filename)
    data = read_config(fh)
    close_config(fh)
    logout({})
    return data
