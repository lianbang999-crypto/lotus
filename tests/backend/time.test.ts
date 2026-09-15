import { describe, expect, it, vi } from "vitest";
vi.mock("agents", () => ({ getAgentByName: vi.fn() }));
vi.mock("@cloudflare/ai-chat", () => ({ AIChatAgent: class { constructor(public ctx: unknown, public env: unknown) {} onMessage = vi.fn(); } }));
import { beijingNow } from "../../src/server";

// 模型系统提示里的“现在”必须按北京时间；UTC 日期在北京 0–8 点会早一天，用户记录会落错日期。
describe("beijingNow", () => {
  it("crosses the UTC day boundary the way Beijing does", () => {
    const late = beijingNow(new Date("2026-09-14T17:30:00Z")); // 北京 09-15 01:30
    expect(late).toMatchObject({ date: "2026-09-15", time: "01:30", weekday: "星期二", iso: "2026-09-14T17:30:00.000Z" });
    const morning = beijingNow(new Date("2026-09-15T00:05:00Z")); // 北京 09-15 08:05
    expect(morning).toMatchObject({ date: "2026-09-15", time: "08:05" });
  });
  it("uses 24-hour clock without a 24:00 wraparound", () => {
    expect(beijingNow(new Date("2026-09-14T16:00:00Z")).time).toBe("00:00");
    expect(beijingNow(new Date("2026-09-15T11:59:00Z")).time).toBe("19:59");
  });
});
