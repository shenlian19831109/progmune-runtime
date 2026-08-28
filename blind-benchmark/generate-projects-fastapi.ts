/**
 * FastAPI 合成金标生成器（M1）——镜像 generate-projects-python.ts 方法论
 *
 * 网格：3 结构风格 × 4 违规变体 = 12 项目。
 *   S1 直连路由（@app.* + 签名 Depends(authenticate)）
 *   S2 路由分组（APIRouter + include_router + 签名 Depends）
 *   S3 认证方案（OAuth2PasswordBearer + Depends(oauth2_scheme)）
 * 变体：clean / V1 无认证写操作路由 / V2 死认证方案（写路由改 GET，隔离 R1）/
 *       V1V2 两者都有。
 * 金标 = 每个项目预期的 (rule, handler) 清单（gold.json 随项目落盘）。
 *
 * Usage: npx ts-node blind-benchmark/generate-projects-fastapi.ts
 */

import * as fs from "fs";
import * as path from "path";

const GEN_DIR = path.resolve(__dirname, "generated-fastapi");

/** 每风格一套模板；S2 双文件 */
const TEMPLATES: { [style: string]: { [file: string]: string } } = {
  S1: {
    "main.py": `from fastapi import FastAPI, Depends
from pydantic import BaseModel

app = FastAPI()


def authenticate(token: str = "secret") -> bool:
    return token == "secret"


class Item(BaseModel):
    title: str


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/items")
async def create_item(
    item: Item,
    auth: bool = Depends(authenticate),
):
    return {"created": item.title}
`,
  },
  S2: {
    "routes.py": `from fastapi import APIRouter, Depends
from pydantic import BaseModel

router = APIRouter()


def authenticate(token: str = "secret") -> bool:
    return token == "secret"


class Item(BaseModel):
    title: str


@router.get("/health")
async def health():
    return {"ok": True}


@router.post("/items")
async def create_item(
    item: Item,
    auth: bool = Depends(authenticate),
):
    return {"created": item.title}
`,
    "main.py": `from fastapi import FastAPI
from routes import router

app = FastAPI()
app.include_router(router)
`,
  },
  S3: {
    "main.py": `from fastapi import FastAPI, Depends
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel

app = FastAPI()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


class Item(BaseModel):
    title: str


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/items")
async def create_item(
    item: Item,
    token: str = Depends(oauth2_scheme),
):
    return {"created": item.title}
`,
  },
};

const POST_AUTH_LINES = [
  "    auth: bool = Depends(authenticate),\n",
  "    token: str = Depends(oauth2_scheme),\n",
];

interface Variant {
  id: string;
  transform: (s: string) => string;
  /** 金标是风格函数：S3 的 V1 去掉 token 依赖后方案必然变死（R2 连带） */
  gold: (style: string) => Array<{ rule: string; handler: string | null }>;
}

const POST_TO_GET = [
  '@app.post("/items")\nasync def create_item(',
  '@router.post("/items")\nasync def create_item(',
];

/** 追加认证方案声明（S1/S2 模板默认不含方案，V2/V1V2 变体注入） */
function addScheme(s: string): string {
  s = s.replace(
    "from fastapi import FastAPI, Depends\n",
    "from fastapi import FastAPI, Depends\nfrom fastapi.security import OAuth2PasswordBearer\n"
  );
  s = s.replace(
    "from fastapi import APIRouter, Depends\n",
    "from fastapi import APIRouter, Depends\nfrom fastapi.security import OAuth2PasswordBearer\n"
  );
  return s.replace(
    "app = FastAPI()\n",
    'app = FastAPI()\noauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")\n'
  ).replace(
    "router = APIRouter()\n",
    'router = APIRouter()\noauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")\n'
  );
}

const stripAuth = (s: string): string => {
  for (const line of POST_AUTH_LINES) s = s.replace(line, "");
  return s;
};

const VARIANTS: Variant[] = [
  { id: "clean", transform: (s) => s, gold: () => [] },
  {
    id: "V1",
    // 去掉认证依赖行 → 无认证写操作路由
    transform: stripAuth,
    gold: (style) => [
      { rule: "FASTAPI_ROUTE_NO_AUTH", handler: "create_item" },
      // S3 的认证行就是方案引用——去掉后方案必然变死（检测器正确连报 R2）
      ...(style === "S3" ? [{ rule: "FASTAPI_DEAD_AUTH_SCHEME", handler: null }] : []),
    ],
  },
  {
    id: "V2",
    // 写路由改 GET（无 R1）+ 注入无人引用的方案 → 死方案（隔离 R2）
    transform: (s) => {
      s = stripAuth(s);
      for (const marker of POST_TO_GET) {
        s = s.replace(
          `${marker}\n    item: Item,\n):\n    return {"created": item.title}`,
          marker
            .replace('post', 'get')
            .replace('create_item(', 'list_items(') + `\n):\n    return {"items": []}`
        );
      }
      return addScheme(s);
    },
    gold: () => [{ rule: "FASTAPI_DEAD_AUTH_SCHEME", handler: null }],
  },
  {
    id: "V1V2",
    // 去认证行（R1）+ 注入无人引用的方案（R2）
    transform: (s) => addScheme(stripAuth(s)),
    gold: () => [
      { rule: "FASTAPI_DEAD_AUTH_SCHEME", handler: null },
      { rule: "FASTAPI_ROUTE_NO_AUTH", handler: "create_item" },
    ],
  },
];

function main() {
  fs.rmSync(GEN_DIR, { recursive: true, force: true });
  fs.mkdirSync(GEN_DIR, { recursive: true });
  const manifest: any[] = [];

  for (const [styleId, files] of Object.entries(TEMPLATES)) {
    for (const variant of VARIANTS) {
      const id = `fastapi_${styleId}_${variant.id}`;
      const dir = path.join(GEN_DIR, id);
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), variant.transform(content));
      }
      manifest.push({ id, style: styleId, variant: variant.id, gold: variant.gold(styleId) });
    }
  }
  fs.writeFileSync(path.join(GEN_DIR, "gold.json"), JSON.stringify(manifest, null, 2));
  console.log(`生成 ${manifest.length} 项目 → ${GEN_DIR}`);
}

main();
