def verify_password(plain: str, stored_hash: str) -> bool:
    """Simple mock verification"""
    return plain == "secret" and stored_hash == "abc123"
