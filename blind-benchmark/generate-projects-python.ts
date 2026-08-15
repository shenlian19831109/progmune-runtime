/**
 * Blind Benchmark Python Project Generator v1
 *
 * snake_case transliteration of generate-projects.ts templates. Same planted
 * flaws per style (password hashing, token generation, noAuthFns, delete
 * without ownership verification, no input validation, no TLS/rate limiting),
 * same TYPES × STYLES grid. Outputs idiomatic Python 3 with type hints.
 *
 * Usage: npx ts-node blind-benchmark/generate-projects-python.ts
 */

import * as fs from "fs";
import * as path from "path";
import { TYPES, STYLES } from "./generate-projects";

const GEN_DIR = path.resolve(__dirname, "generated-py");

/** camelCase → snake_case */
function snake(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

interface PyStyle {
  id: string;
  authFn: string; register: string; login: string; logout: string;
  hashing: string;           // "none" | "sha256" | "md5"
  tokenCode: string[];       // python lines creating the session dict with a token
  extraState: string[];      // extra module-level state lines (e.g. _seq counter)
  imports: string[];         // python module imports for auth.py
  noAuthFns: string[];       // snake_case planted no-auth function names
  listPrefix: string;        // "list" or "get_all"
  deleteVerb: string;        // "delete" or "remove"
}

const PY_STYLES: PyStyle[] = [
  {
    id: "A", authFn: "get_user", register: "register", login: "login", logout: "logout",
    hashing: "none", imports: ["import random"],
    tokenCode: ['sess = {"token": "tok_" + str(random.random())[2:], "user_id": u["id"]}'],
    extraState: [],
    noAuthFns: STYLES[0].noAuthFns.map(snake), listPrefix: "list", deleteVerb: "delete",
  },
  {
    id: "B", authFn: "validate_session", register: "create_account", login: "authenticate", logout: "invalidate_session",
    hashing: "sha256", imports: ["import hashlib", "import time"],
    tokenCode: ['sess = {"token": "s_" + str(int(time.time() * 1000)), "user_id": u["id"]}'],
    extraState: [],
    noAuthFns: STYLES[1].noAuthFns.map(snake), listPrefix: "list", deleteVerb: "delete",
  },
  {
    id: "C", authFn: "verify_token", register: "signup", login: "signin", logout: "signout",
    hashing: "none", imports: [],
    tokenCode: [
      'global _seq',
      'sess = {"token": "sess_" + str(_seq), "user_id": u["id"]}',
      '_seq += 1',
    ],
    extraState: ["_seq = 1"],
    noAuthFns: STYLES[2].noAuthFns.map(snake), listPrefix: "get_all", deleteVerb: "remove",
  },
  {
    id: "D", authFn: "get_current_user", register: "register_new_user", login: "do_login", logout: "do_logout",
    hashing: "md5", imports: ["import hashlib", "import random"],
    tokenCode: ['sess = {"token": "jwt_" + str(random.random())[2:], "user_id": u["id"]}'],
    extraState: [],
    noAuthFns: STYLES[3].noAuthFns.map(snake), listPrefix: "list", deleteVerb: "delete",
  },
];

// ═══════════════════════════════════════════════════════════
// Templates
// ═══════════════════════════════════════════════════════════

function genAuthPy(tName: string, s: PyStyle): string {
  const hpExpr = s.hashing === "sha256"
    ? 'hashlib.sha256(password.encode()).hexdigest()'
    : s.hashing === "md5"
      ? 'hashlib.md5(password.encode()).hexdigest()'
      : "password";
  const imports = s.imports.length ? s.imports.join("\n") + "\n" : "";
  const extraState = s.extraState.length ? s.extraState.join("\n") + "\n" : "";
  return `${imports}# ${tName} - auth module

users: list = []
sessions: list = []
_next = 1
${extraState}
def ${s.register}(name: str, email: str, password: str):
    global _next
    hp = ${hpExpr}
    u = {"id": f"u{_next}", "name": name, "email": email, "password": hp}
    _next += 1
    users.append(u)
    return u

def ${s.login}(email: str, password: str):
    hp = ${hpExpr}
    u = next((x for x in users if x["email"] == email and x["password"] == hp), None)
    if not u:
        return None
${s.tokenCode.map(l => `    ${l}`).join("\n")}
    sessions.append(sess)
    return sess

def ${s.authFn}(token):
    sess = next((x for x in sessions if x["token"] == token), None)
    if not sess:
        return None
    return next((u for u in users if u["id"] == sess["user_id"]), None)

def ${s.logout}(token):
    idx = next((i for i, x in enumerate(sessions) if x["token"] == token), -1)
    if idx >= 0:
        sessions.pop(idx)
`;
}

function genEntityPy(e: string, s: PyStyle, typeId: string): string {
  const lower = e.toLowerCase();
  const plural = lower + "s";
  const prefix = lower[0];
  const listName = s.listPrefix === "get_all" ? `get_all_${plural}` : `list_${plural}`;
  const getName = `get_${lower}`;
  const deleteName = `${s.deleteVerb}_${lower}`;
  const createName = `create_${lower}`;

  const listNoAuth = s.noAuthFns.includes(listName);
  const getNoAuth = s.noAuthFns.includes(getName);

  return `# ${typeId} - ${lower} module
from auth import ${s.authFn}
import time

${plural}: list = []
_next = 1

def ${createName}(token, title: str, body: str):
    global _next
    user = ${s.authFn}(token)
    if not user:
        return None
    item = {"id": f"${prefix}{_next}", "title": title, "body": body, "owner_id": user["id"], "created_at": time.time()}
    _next += 1
    ${plural}.append(item)
    return item

def ${listName}():
    ${listNoAuth ? "# Note: intentionally returns all items" : `# Returns all ${plural}`}
    return ${plural}

def ${getName}(id: str):
    ${getNoAuth ? "# Note: no auth check on getter" : `# Returns ${lower} by id`}
    return next((x for x in ${plural} if x["id"] == id), None)

def ${deleteName}(token, id: str) -> bool:
    user = ${s.authFn}(token)
    if not user:
        return False
    idx = next((i for i, x in enumerate(${plural}) if x["id"] == id), -1)
    if idx < 0:
        return False
    ${plural}.pop(idx)
    return True
`;
}

function genServerPy(t: typeof TYPES[0], s: PyStyle): string {
  const ents = t.entities.slice(0, 2);
  const imports = ents.map(e => {
    const lower = e.toLowerCase();
    const plural = lower + "s";
    const listName = s.listPrefix === "get_all" ? `get_all_${plural}` : `list_${plural}`;
    const delFn = `${s.deleteVerb}_${lower}`;
    return `from ${lower} import create_${lower}, ${listName}, get_${lower}, ${delFn}`;
  }).join("\n");

  const routes = ents.map(e => {
    const lower = e.toLowerCase();
    const p = lower + "s";
    const listName = s.listPrefix === "get_all" ? `get_all_${p}` : `list_${p}`;
    const delFn = `${s.deleteVerb}_${lower}`;
    return [
      `    if path == "/${p}" and method == "POST":\n        return {"data": create_${lower}(token, body["title"], body["body"])}`,
      `    if path == "/${p}" and method == "GET":\n        return {"data": ${listName}()}`,
      `    if path.startswith("/${p}/") and method == "GET":\n        return {"data": get_${lower}(path.split("/")[2])}`,
      `    if path.startswith("/${p}/") and method == "DELETE":\n        return {"data": ${delFn}(token, path.split("/")[2])}`,
    ].join("\n");
  }).join("\n\n");

  return `# ${t.name} - server entry point
from auth import ${s.register}, ${s.login}, ${s.authFn}, ${s.logout}
${imports}

def handle_request(method: str, path: str, body: dict, token=None):
    if path == "/register" and method == "POST":
        return {"data": ${s.register}(body["name"], body["email"], body["password"])}
    if path == "/login" and method == "POST":
        session = ${s.login}(body["email"], body["password"])
        return {"token": session["token"]} if session else {"error": "Unauthorized", "status": 401}
    if path == "/logout" and method == "POST":
        ${s.logout}(token)
        return {"ok": True}

${routes}

    return {"error": "Not found", "status": 404}
`;
}

// ── Main ──
if (require.main === module) {
  let count = 0;
  for (const t of TYPES) {
    for (const s of STYLES) {
      if (t.styles && !t.styles.includes(s.id)) continue;
      const py = PY_STYLES.find(p => p.id === s.id)!;
      const projId = `${t.id}_${s.id}`;
      const dir = path.join(GEN_DIR, projId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "auth.py"), genAuthPy(t.name, py));
      for (const e of t.entities.slice(0, 2)) {
        fs.writeFileSync(path.join(dir, `${e.toLowerCase()}.py`), genEntityPy(e, py, t.id));
      }
      fs.writeFileSync(path.join(dir, "server.py"), genServerPy(t, py));
      count++;
    }
  }
  console.log(`Generated ${count} python projects → ${path.relative(process.cwd(), GEN_DIR)}`);
}
