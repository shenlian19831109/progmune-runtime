import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { extractIR } from "./extract-ir";

/**
 * /migrations/ 目录跳过（2026-10-08 §49.19 补标注的产物）。
 *
 * 数据：docmost 补标注队列 174 条里，迁移脚本 up()/down() 被多族规则报
 * （Authorization 族 + Data Mutation 族——addColumn/createTable 词撞），
 * 全部人工核实为 FP：迁移只在部署时跑一次，不暴露请求面，与
 * node_modules/benchmarks 同属「无应用面」判定。
 *
 * 锁定行为：migrations 目录下的源文件整体不参与提取；
 * 同项目其他目录正常提取（防误伤）。
 */

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2020",
    module: "commonjs",
    moduleResolution: "node",
    strict: false,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ["**/*.ts"],
});

function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-migrations-"));
  fs.writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.0.0", private: true })
  );
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

describe("extractIR：/migrations/ 目录跳过（无应用面判定）", () => {
  it("迁移脚本不提取，同项目其他目录正常提取", () => {
    const dir = makeProject({
      "src/app.ts": `export function handleCreatePage(): void {
  console.log("app surface");
}`,
      "src/database/migrations/20260101T000000-init.ts": `import { Kysely } from "kysely";
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createTable("page").addColumn("id", "text").execute();
}
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("page").execute();
}`,
    });

    const fns = extractIR(dir).map((f) => f.name).sort();

    // 应用面函数保留
    expect(fns).toContain("handleCreatePage");
    // 迁移脚本 up/down 不参与提取
    expect(fns).not.toContain("up");
    expect(fns).not.toContain("down");
  });

  it("路径含 migrations 字样但不属于 /migrations/ 目录的文件不误伤", () => {
    const dir = makeProject({
      "src/migrations-service.ts": `export function runMigrations(): void {
  console.log("service, not a migration dir");
}`,
    });

    const fns = extractIR(dir).map((f) => f.name);

    expect(fns).toContain("runMigrations");
  });
});
