/**
 * fr-001 定向回归：身份映射查找用 JSON.contains 子串匹配
 * （REALWORLD_FIX_REGRESSION_V1 fr-001，open-webui CVE-2026-87016）
 *
 * 判据在 tools/extract_ir.py 的 has_identity_substring_match：
 * ① 函数名身份查找形态（oauth/scim/sso/saml + sub/subject/external_id/identity）
 * ② 体内有 <对象>.contains( 调用
 * ③ contains 对象链含 oauth/scim 字段
 * 三条件同时成立才注入 __progmune_identity_substring_match__ 标记。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { extractIRPython } from "./extract-ir-python";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr001-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, content: string) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const MARKER = "__progmune_identity_substring_match__";

describe("fr-001 identity substring match（提取器标记）", () => {
  it("修复前形态：oauth JSON 列 contains() 做身份映射 → 注入标记", () => {
    write("users.py", `
class User:
    oauth = None
    scim = None

async def get_user_by_oauth_sub(provider, sub, db=None):
    query = select(User)
    if dialect == 'sqlite':
        oauth_match = User.oauth.contains({provider: {'sub': sub}})
        query = query.where(oauth_match)
    row = await session.execute(query)
    return row

async def get_user_by_scim_external_id(provider, external_id, db=None):
    query = select(User)
    if dialect == 'sqlite':
        scim_match = User.scim.contains({provider: {'external_id': external_id}})
        query = query.where(scim_match)
    return (await session.execute(query)).scalars().first()
`);
    const ir = extractIRPython(dir);
    const oauthFn = ir.find((f) => f.name === "get_user_by_oauth_sub");
    const scimFn = ir.find((f) => f.name === "get_user_by_scim_external_id");
    expect(oauthFn).toBeDefined();
    expect(scimFn).toBeDefined();
    expect(oauthFn!.calls).toContain(MARKER);
    expect(scimFn!.calls).toContain(MARKER);
  });

  it("修复后形态：下标提取 + 精确等值 → 无标记", () => {
    write("users.py", `
async def get_user_by_oauth_sub(provider, sub, db=None):
    # Subscript, never contains(): on a JSON column contains() degrades to a substring LIKE.
    query = select(User).where(User.oauth[provider]['sub'].as_string() == sub)
    row = (await session.execute(query)).scalars().first()
    return row

async def get_user_by_scim_external_id(provider, external_id, db=None):
    query = select(User).where(User.scim[provider]['external_id'].as_string() == external_id)
    return (await session.execute(query)).scalars().first()
`);
    const ir = extractIRPython(dir);
    for (const f of ir) {
      expect(f.calls).not.toContain(MARKER);
    }
  });

  it("负例：非身份查找函数用 .contains → 无标记（函数名不含 oauth/scim 词形）", () => {
    write("utils.py", `
def has_feature(config, name):
    return config.features.contains({'name': name})

async def get_user_by_id(user_id, db=None):
    query = select(User).where(User.id == user_id)
    return (await session.execute(query)).scalars().first()
`);
    const ir = extractIRPython(dir);
    for (const f of ir) {
      expect(f.calls).not.toContain(MARKER);
    }
  });

  it("负例：身份词形函数但 contains 对象不是 oauth/scim 字段 → 无标记", () => {
    write("utils.py", `
async def get_oauth_subject_from_claim(claim, db=None):
    # 函数名含 oauth+subject，但 contains 的对象是普通 dict，不是模型 JSON 列
    payload = {'claims': {'sub': claim}}
    if payload.contains({'provider': 'x'}):
        return claim
    return None
`);
    const ir = extractIRPython(dir);
    for (const f of ir) {
      expect(f.calls).not.toContain(MARKER);
    }
  });
});

describe("fr-002/003 token exchange missing guard（提取器标记）", () => {
  const TK_MARKER = "__progmune_token_exchange_unguarded__";

  it("修复前形态：token_exchange 缺角色判定 → 注入标记（fr-002）", () => {
    write("auths.py", `
async def token_exchange(request, provider, token_data, db=None):
    email = token_data.get('email', '').lower()
    user = await Users.get_user_by_oauth_sub(provider, token_data.get('sub'), db)
    return await create_session_response(request, user, db, source='oauth')
`);
    const ir = extractIRPython(dir);
    const fn = ir.find((f) => f.name === "token_exchange");
    expect(fn).toBeDefined();
    expect(fn!.calls).toContain(TK_MARKER);
  });

  it("修复前形态：token_exchange 缺域检查 → 注入标记（fr-003）", () => {
    write("auths.py", `
async def token_exchange(request, provider, token_data, db=None):
    email = token_data.get('email', '').lower()
    user = await Users.get_user_by_oauth_sub(provider, token_data.get('sub'), db)
    role = await oauth_manager.get_user_role(user, user_data)
    return await create_session_response(request, user, db, source='oauth')
`);
    const ir = extractIRPython(dir);
    const fn = ir.find((f) => f.name === "token_exchange");
    expect(fn!.calls).toContain(TK_MARKER);
  });

  it("修复后形态：角色判定 + 域检查都有 → 无标记", () => {
    write("auths.py", `
async def token_exchange(request, provider, token_data, db=None):
    email = token_data.get('email', '').lower()
    if '*' not in auth_manager_config.OAUTH_ALLOWED_DOMAINS and email.split('@')[-1] not in auth_manager_config.OAUTH_ALLOWED_DOMAINS:
        raise HTTPException(status_code=403)
    user = await Users.get_user_by_oauth_sub(provider, token_data.get('sub'), db)
    user = await oauth_manager.update_user_from_oauth(request=request, user=user, user_data=user_data, provider=provider, token=token_data, db=db)
    return await create_session_response(request, user, db, source='oauth')
`);
    const ir = extractIRPython(dir);
    const fn = ir.find((f) => f.name === "token_exchange");
    expect(fn).toBeDefined();
    expect(fn!.calls).not.toContain(TK_MARKER);
  });

  it("负例：非 token exchange 函数 → 无标记", () => {
    write("utils.py", `
async def refresh_token(request, db=None):
    return await create_session_response(request, None, db)
`);
    const ir = extractIRPython(dir);
    for (const f of ir) {
      expect(f.calls).not.toContain(TK_MARKER);
    }
  });
});
