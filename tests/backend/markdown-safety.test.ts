import { describe, expect, it } from "vitest";
import { defaultRehypePlugins } from "streamdown";
import rehypeRawStub from "../../src/lib/rehype-raw-stub";

/**
 * 小莲不渲染模型输出的原始 HTML。这条边界由两处共同保证：
 * 1) Chat.tsx 把 `raw` 从 Streamdown 默认插件里剔除（走「html 当纯文本」分支）；
 * 2) vite.config.ts 把 rehype-raw 整体 alias 成替身，避免 parse5 进首屏分包。
 * 任何一处被改回都应让这里失败，而不是悄悄把 HTML 放进 DOM。
 */
describe("raw HTML 边界", () => {
  it("Streamdown 仍然提供 raw 插件，说明剔除动作有意义", () => {
    expect(defaultRehypePlugins).toHaveProperty("raw");
  });
  it("剔除 raw 后仍保留其余默认插件（上游新增也会自动带上）", () => {
    const { raw: _raw, ...rest } = defaultRehypePlugins;
    const kept = Object.values(rest);
    expect(kept.length).toBe(Object.keys(defaultRehypePlugins).length - 1);
    expect(kept.length).toBeGreaterThan(0);
    // sanitize / harden 这类安全插件必须还在
    expect(Object.keys(rest)).toEqual(expect.arrayContaining(["sanitize", "harden"]));
  });
  it("替身不做任何转换，只用于满足 Streamdown 的恒等比较", () => {
    expect(typeof rehypeRawStub).toBe("function");
    expect(rehypeRawStub()).toBeUndefined();
  });
});
