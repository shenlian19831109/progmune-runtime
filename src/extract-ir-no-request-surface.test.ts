import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { extractIR } from "./extract-ir";

/**
 * 修冤枉第六刀（2026-10-10）：队列/定时/事件处理器 → 无请求面标记锁定。
 *
 * 数据：docmost 补标注 111 条授权族 FP 里 10 条是队列作业/定时任务——
 * 鉴权发生在入队侧，处理器函数不面向 HTTP 请求，授权族规则按「请求面
 * 缺鉴权」提问时结论不适用。
 *
 * 注入形态：@Processor(队列名) 类级（BullMQ，全方法）；
 * @Interval/@Cron/@Timeout/@OnEvent 方法级（须带实参）。
 * 反例（是请求面，不注入）：@Sse / @SubscribeMessage / @MessagePattern。
 */

const MARK = "__progmune_no_request_surface__";
const TSCONFIG = JSON.stringify({
  compilerOptions: { target: "ES2020", module: "commonjs", strict: false, skipLibCheck: true, noEmit: true },
  include: ["**/*.ts"],
});

function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-nosurface-"));
  fs.writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0", private: true }));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

function callsOf(dir: string, fnName: string): string[] {
  const fns = extractIR(dir);
  const f = fns.find((x) => x.name === fnName);
  return f ? (f.calls ?? []) : [];
}

describe("extractIR：无请求面标记（修冤枉第六刀）", () => {
  it("@Processor(队列名) 类级 ⇒ 全部方法注入", () => {
    const dir = makeProject({
      "a.ts": `
declare const Processor: any;
@Processor("notification-queue")
export class NotificationProcessor {
  process() { this.markAsEmailed(); }
  onCompleted() {}
}
`,
    });
    expect(callsOf(dir, "NotificationProcessor.process")).toContain(MARK);
    expect(callsOf(dir, "NotificationProcessor.onCompleted")).toContain(MARK);
  });

  it("@Interval/@Cron/@Timeout/@OnEvent 方法级 ⇒ 仅该方法注入", () => {
    const dir = makeProject({
      "a.ts": `
declare const Interval: any; declare const Cron: any; declare const Timeout: any; declare const OnEvent: any;
export class SessionService {
  @Interval("session-cleanup", 86400000)
  cleanupSessions() {}
  @Cron("0 0 * * *")
  dailyJob() {}
  @Timeout(5000)
  delayedJob() {}
  @OnEvent("user.created")
  onUserCreated() {}
  normalMethod() {}
}
`,
    });
    for (const fn of ["SessionService.cleanupSessions", "SessionService.dailyJob", "SessionService.delayedJob", "SessionService.onUserCreated"]) {
      expect(callsOf(dir, fn)).toContain(MARK);
    }
    expect(callsOf(dir, "SessionService.normalMethod")).not.toContain(MARK);
  });

  it("反例：@Sse/@SubscribeMessage/@MessagePattern/@EventPattern 是请求面，不注入", () => {
    const dir = makeProject({
      "a.ts": `
declare const Sse: any; declare const SubscribeMessage: any; declare const MessagePattern: any; declare const EventPattern: any;
export class Gateway {
  @Sse("events")
  events() {}
  @SubscribeMessage("chat")
  onMessage() {}
  @MessagePattern("orders.get")
  getOrder() {}
  @EventPattern("orders.created")
  onOrderCreated() {}
}
`,
    });
    for (const fn of ["Gateway.events", "Gateway.onMessage", "Gateway.getOrder", "Gateway.onOrderCreated"]) {
      expect(callsOf(dir, fn)).not.toContain(MARK);
    }
  });

  it("边界：@Processor() 空实参不注入（非 BullMQ 形态）", () => {
    const dir = makeProject({
      "a.ts": `
declare const Processor: any;
@Processor()
export class Odd {
  run() {}
}
`,
    });
    expect(callsOf(dir, "Odd.run")).not.toContain(MARK);
  });
});
