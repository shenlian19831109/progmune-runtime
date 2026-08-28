/**
 * Flask 合成金标生成器（第 5 个框架适配）——镜像 generate-projects-fastapi.ts
 *
 * 项目规格（4 项目）：
 *   F1 直连路由（@app.route + @login_required）：clean / V1（无保护 mutation 路由）
 *   F2 before_request 全局守卫：clean（有守卫）/ V2（守卫缺失 + 无保护路由）
 * 金标 = 每项目预期 (rule, handler) 清单（gold.json 随项目落盘）。
 *
 * Usage: npx ts-node blind-benchmark/generate-projects-flask.ts
 */

import * as fs from "fs";
import * as path from "path";

const GEN_DIR = path.resolve(__dirname, "generated-flask");

const APP_BASE = `from flask import Flask, request, jsonify

app = Flask(__name__)


def authenticate():
    return request.headers.get("X-Api-Key") == "secret"


@app.route("/health")
def health():
    return jsonify({"ok": True})


@app.route("/login", methods=["POST"])
def login():
    return jsonify({"token": "t"})


@app.route("/transfer", methods=["POST"])
def transfer_money():
    return jsonify({"transferred": True})
`;

const APP_PROTECTED_DECORATOR = APP_BASE.replace(
  '@app.route("/transfer", methods=["POST"])\ndef transfer_money():',
  '@app.route("/transfer", methods=["POST"])\n@login_required\ndef transfer_money():'
).replace(
  "from flask import Flask, request, jsonify",
  "from flask import Flask, request, jsonify\nfrom flask_login import login_required"
);

const APP_GUARDED = `from flask import Flask, request, jsonify

app = Flask(__name__)


def authenticate():
    return request.headers.get("X-Api-Key") == "secret"


@app.route("/health")
def health():
    return jsonify({"ok": True})


@app.route("/transfer", methods=["POST"])
def transfer_money():
    return jsonify({"transferred": True})


app.before_request(authenticate)
`;

interface Spec {
  id: string;
  files: { [file: string]: string };
  gold: Array<{ rule: string; handler: string | null }>;
}

const SPECS: Spec[] = [
  {
    id: "flask_F1_clean",
    files: { "app.py": APP_PROTECTED_DECORATOR },
    gold: [],
  },
  {
    id: "flask_F1_V1",
    files: { "app.py": APP_BASE },
    gold: [{ rule: "FLASK_ROUTE_NO_AUTH", handler: "transfer_money" }],
  },
  {
    id: "flask_F2_clean",
    files: { "app.py": APP_GUARDED },
    gold: [],
  },
  {
    id: "flask_F2_V2",
    // 守卫缺失：before_request 注册被删掉
    files: { "app.py": APP_GUARDED.replace("\n\napp.before_request(authenticate)\n", "") },
    gold: [{ rule: "FLASK_ROUTE_NO_AUTH", handler: "transfer_money" }],
  },
];

function main() {
  fs.rmSync(GEN_DIR, { recursive: true, force: true });
  fs.mkdirSync(GEN_DIR, { recursive: true });
  const manifest: any[] = [];
  for (const spec of SPECS) {
    const dir = path.join(GEN_DIR, spec.id);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(spec.files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    manifest.push({ id: spec.id, gold: spec.gold });
  }
  fs.writeFileSync(path.join(GEN_DIR, "gold.json"), JSON.stringify(manifest, null, 2));
  console.log(`生成 ${manifest.length} 项目 → ${GEN_DIR}`);
}

main();
