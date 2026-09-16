import { afterEach, describe, expect, it, vi } from "vitest";
import { SiliconFlowTTS, audioMime, createChineseTTS } from "../../src/agent/tts";

afterEach(() => vi.unstubAllGlobals());
const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);

// 中文 TTS 走 SiliconFlow CosyVoice2（melotts 的 spike 结果见 src/agent/tts.ts 顶部注释）。
describe("SiliconFlowTTS", () => {
  it("asks CosyVoice2 for Mandarin mp3 with the server-side key and returns the bytes", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(mp3, { headers: { "content-type": "audio/mpeg" } })); vi.stubGlobal("fetch", fetcher);
    const audio = await new SiliconFlowTTS({ apiKey: "fixture-tts-key", baseUrl: "https://api.siliconflow.cn/v1/" }).synthesize("  阿弥陀佛  ");
    expect(new Uint8Array(audio!)).toEqual(mp3);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://api.siliconflow.cn/v1/audio/speech");
    expect(init.headers.Authorization).toBe("Bearer fixture-tts-key");
    expect(init.redirect).toBe("manual");
    expect(JSON.parse(init.body)).toEqual({ model: "FunAudioLLM/CosyVoice2-0.5B", input: "阿弥陀佛", voice: "FunAudioLLM/CosyVoice2-0.5B:claire", response_format: "mp3" });
  });
  it("returns null for empty text, upstream failures and empty bodies, never throwing into the call", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("sensitive upstream error", { status: 500 })).mockResolvedValueOnce(new Response(new Uint8Array(0))); vi.stubGlobal("fetch", fetcher);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tts = new SiliconFlowTTS({ apiKey: "k" });
    expect(await tts.synthesize("   ")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await tts.synthesize("你好")).toBeNull();
    expect(await tts.synthesize("你好")).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
  it("only exists when the OpenAI-compatible endpoint is SiliconFlow, and tells wav from mp3 by header", () => {
    expect(createChineseTTS({})).toBeNull();
    expect(createChineseTTS({ OPENAI_API_KEY: "k" })).toBeNull();
    expect(createChineseTTS({ OPENAI_API_KEY: "k", OPENAI_BASE_URL: "https://api.openai.com/v1" })).toBeNull();
    expect(createChineseTTS({ OPENAI_API_KEY: "k", OPENAI_BASE_URL: "not a url" })).toBeNull();
    expect(createChineseTTS({ OPENAI_API_KEY: "k", OPENAI_BASE_URL: "https://api.siliconflow.cn/v1" })).toBeInstanceOf(SiliconFlowTTS);
    expect(audioMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2]).buffer)).toBe("audio/wav");
    expect(audioMime(mp3.buffer)).toBe("audio/mpeg");
  });
});
