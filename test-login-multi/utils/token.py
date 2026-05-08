from typing import Dict
Token = str

def generate_jwt(payload: Dict) -> Token:
    """Mock JWT generation"""
    return f"tok_{payload.get('user_id', 'unknown')}"
