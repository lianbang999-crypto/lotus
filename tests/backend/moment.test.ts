import { describe, expect, it } from "vitest";
import { moment } from "../../src/components/chat/Chat";

// 问候语和起手句顺序按北京时段变化：这是“知道现在几点”的陪伴感，而不是固定欢迎语。
describe("moment", () => {
  it.each([
    ["2026-09-14T17:30:00Z", "夜深了"], // 北京 01:30
    ["2026-09-14T23:00:00Z", "早安"], // 北京 07:00
    ["2026-09-15T04:00:00Z", "午安"], // 北京 12:00
    ["2026-09-15T07:00:00Z", "下午好"], // 北京 15:00
    ["2026-09-15T12:30:00Z", "晚上好"], // 北京 20:30
    ["2026-09-15T15:30:00Z", "夜深了"], // 北京 23:30
  ])("greets %s as %s", (iso, word) => {
    expect(moment(new Date(iso)).word).toBe(word);
  });
  it("leads with practice in the morning and with mood at night", () => {
    expect(moment(new Date("2026-09-14T23:00:00Z")).starters[0].title).toBe("记下今日功课");
    expect(moment(new Date("2026-09-15T13:00:00Z")).starters[0].title).toBe("说说今天的心情");
    expect(moment(new Date("2026-09-15T13:00:00Z")).starters).toHaveLength(4);
  });
});
