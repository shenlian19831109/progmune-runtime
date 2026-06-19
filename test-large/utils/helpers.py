from typing import List, Dict
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
