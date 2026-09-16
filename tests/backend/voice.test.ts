import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const gateway = vi.hoisted(() => ({ resolveSession: vi.fn(), getAgentByName: vi.fn() }));
vi.mock("agents", () => ({ getAgentByName: gateway.getAgentByName }));
vi.mock("@cloudflare/ai-chat", () => ({ AIChatAgent: class { constructor(public ctx: unknown, public env: unknown) {} onMessage = vi.fn(); } }));
vi.mock("../../src/agent/auth", async (original) => ({ ...await original<typeof import("../../src/agent/auth")>(), resolveSession: gateway.resolveSession }));
import worker, { wavDurationMs } from "../../src/server";

// 客户端只会上传 44 字节标准头的 16 kHz 单声道 16-bit WAV；这里按同样布局造样本。
function wav(seconds: number): Uint8Array<ArrayBuffer> {
  const data = 16000 * 2 * seconds;
  const bytes = new Uint8Array(new ArrayBuffer(44 + data));
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
  tag(0, "RIFF"); view.setUint32(4, 36 + data, true); tag(8, "WAVE");
  tag(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, "data"); view.setUint32(40, data, true);
  return bytes;
}
const origin = "https://lotus.foyue.org";
const post = (bytes: Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}) =>
  new Request(`${origin}/api/voice/transcribe`, { method: "POST", headers: { Origin: origin, "Content-Type": "audio/wav", ...headers }, body: bytes });
const ai = { run: vi.fn() };
const r2 = { put: vi.fn(), get: vi.fn() };
const env = { LotusAgent: {}, OPENAI_API_KEY: "fixture-model-key", OPENAI_BASE_URL: "https://api.siliconflow.cn/v1", MODEL_NAME: "test", DEV_LOCAL: "false", AI: ai, VOICE_AUDIO: r2 } as never;
const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
const without = (key: "AI" | "VOICE_AUDIO") => ({ ...(env as Record<string, unknown>), [key]: undefined }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  gateway.resolveSession.mockResolvedValue({ accountId: "trusted-account", name: "佛友", isAnonymous: false, mode: "cloud" });
  ai.run.mockResolvedValue({ text: " 今天念佛五百声 " });
});
afterEach(() => vi.unstubAllGlobals());

describe("wavDurationMs", () => {
  it("derives duration from the canonical header and rejects anything else", () => {
    expect(wavDurationMs(wav(2))).toBe(2000);
    expect(wavDurationMs(new Uint8Array(10))).toBeNull();
    expect(wavDurationMs(new TextEncoder().encode("x".repeat(60)))).toBeNull();
  });
});

describe("voice transcribe", () => {
  it("advertises voice only for writable sessions with Workers AI bound", async () => {
    type Caps = { capabilities: { voice: boolean; speech: boolean } };
    const withAI = await (await worker.fetch(new Request(`${origin}/api/session`), env)).json() as Caps;
    expect(withAI.capabilities).toMatchObject({ voice: true, speech: true });
    const noAI = await (await worker.fetch(new Request(`${origin}/api/session`), without("AI"))).json() as Caps;
    expect(noAI.capabilities).toMatchObject({ voice: false, speech: true }); // 朗读走 SiliconFlow，不依赖 Workers AI
    const noTTS = await (await worker.fetch(new Request(`${origin}/api/session`), { ...(env as object), OPENAI_BASE_URL: undefined } as never)).json() as Caps;
    expect(noTTS.capabilities).toMatchObject({ voice: true, speech: false });
  });
  it("requires a real session and the same origin before touching the model", async () => {
    gateway.resolveSession.mockResolvedValueOnce(null);
    expect((await worker.fetch(post(wav(1)), env)).status).toBe(401);
    expect((await worker.fetch(post(wav(1), { Origin: "https://evil.example" }), env)).status).toBe(403);
    gateway.resolveSession.mockResolvedValueOnce({ accountId: "anon", name: "", isAnonymous: true, mode: "cloud" });
    expect((await worker.fetch(post(wav(1)), env)).status).toBe(403);
    expect(ai.run).not.toHaveBeenCalled();
  });
  it("rejects wrong format, malformed, oversized and overlong clips before calling the model", async () => {
    expect((await worker.fetch(post(wav(1), { "Content-Type": "audio/webm" }), env)).status).toBe(415);
    expect((await worker.fetch(post(new Uint8Array(60)), env)).status).toBe(400);
    expect((await worker.fetch(post(wav(91)), env)).status).toBe(413);
    expect((await worker.fetch(post(wav(160)), env)).status).toBe(413);
    expect(ai.run).not.toHaveBeenCalled();
    expect(r2.put).not.toHaveBeenCalled();
  });
  it("transcribes in Chinese, stores audio under the account prefix and measures duration from bytes", async () => {
    const response = await worker.fetch(post(wav(3)), env);
    expect(response.status).toBe(200);
    const body = await response.json() as { text: string; audioId: string; durationMs: number };
    expect(body).toMatchObject({ text: "今天念佛五百声", durationMs: 3000 });
    expect(body.audioId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ai.run).toHaveBeenCalledWith("@cf/openai/whisper-large-v3-turbo", expect.objectContaining({ language: "zh", task: "transcribe", audio: expect.any(String) }));
    expect(r2.put).toHaveBeenCalledWith(`voice/trusted-account/${body.audioId}.wav`, expect.any(Uint8Array), expect.objectContaining({ httpMetadata: { contentType: "audio/wav" } }));
  });
  it("still transcribes without R2 and honestly reports nothing to replay", async () => {
    const body = await (await worker.fetch(post(wav(1)), without("VOICE_AUDIO"))).json() as { audioId: string | null; text: string };
    expect(body.audioId).toBeNull();
    expect(body.text).toBe("今天念佛五百声");
  });
  it("refuses when Workers AI is not bound", async () => {
    expect((await worker.fetch(post(wav(1)), without("AI"))).status).toBe(503);
    expect(ai.run).not.toHaveBeenCalled();
  });
});

describe("voice speak (朗读)", () => {
  const speak = (body: unknown, target = env) => worker.fetch(new Request(`${origin}/api/voice/speak`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) }), target);
  it("synthesizes Mandarin through CosyVoice2 with the server-side key, sniffs the format and caches under the account prefix", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(mp3, { headers: { "content-type": "audio/mpeg" } })); vi.stubGlobal("fetch", fetcher);
    r2.get.mockResolvedValueOnce(null);
    const response = await speak({ text: "阿弥陀佛" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(mp3);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://api.siliconflow.cn/v1/audio/speech");
    expect(init.headers.Authorization).toBe("Bearer fixture-model-key");
    expect(JSON.parse(init.body)).toMatchObject({ model: "FunAudioLLM/CosyVoice2-0.5B", input: "阿弥陀佛", response_format: "mp3" });
    expect(ai.run).not.toHaveBeenCalled();
    expect(r2.put).toHaveBeenCalledWith(expect.stringMatching(/^voice\/trusted-account\/tts\/[0-9a-f]{64}$/), expect.any(ArrayBuffer), expect.objectContaining({ httpMetadata: { contentType: "audio/mpeg" } }));
  });
  it("serves a cached clip with its stored type without calling upstream", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    r2.get.mockResolvedValueOnce({ body: "cached", httpMetadata: { contentType: "audio/wav" } });
    const response = await speak({ text: "阿弥陀佛" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/wav");
    expect(response.headers.get("X-Voice-Cache")).toBe("hit");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects empty or overlong text, reports missing configuration and upstream failure honestly", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("sensitive upstream error", { status: 500 })); vi.stubGlobal("fetch", fetcher);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await speak({ text: "   " })).status).toBe(400);
    expect((await speak({ text: "阿".repeat(601) })).status).toBe(413);
    expect((await speak({ text: "你好" }, { ...(env as object), OPENAI_BASE_URL: undefined } as never)).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
    r2.get.mockResolvedValueOnce(null);
    const failed = await speak({ text: "你好" });
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain("sensitive");
    expect(r2.put).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("voice playback", () => {
  const get = (id: string, headers: Record<string, string> = {}) => worker.fetch(new Request(`${origin}/api/voice/audio/${id}`, { headers }), env);
  it("only ever reads the caller's own prefix and 404s on missing objects or odd ids", async () => {
    r2.get.mockResolvedValueOnce(null);
    const id = "11111111-1111-4111-8111-111111111111";
    expect((await get(id)).status).toBe(404);
    expect(r2.get).toHaveBeenCalledWith(`voice/trusted-account/${id}.wav`, undefined);
    expect((await get("not-a-uuid")).status).toBe(404);
    expect(r2.get).toHaveBeenCalledTimes(1);
  });
  it("streams wav privately cached and computes Content-Range from the request, not from R2", async () => {
    // 本地 R2 模拟器返回的 range 对象字段是 undefined；服务端必须自己按请求头算，且无 Range 时不能返回 206。
    const object = { body: "bytes", size: 100, range: { offset: undefined, length: undefined, suffix: undefined }, writeHttpMetadata: vi.fn() };
    const id = "22222222-2222-4222-8222-222222222222";
    r2.get.mockResolvedValue(object);
    const full = await get(id);
    expect(full.status).toBe(200);
    expect(full.headers.get("Content-Type")).toBe("audio/wav");
    expect(full.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(full.headers.get("Accept-Ranges")).toBe("bytes");
    expect(r2.get).toHaveBeenLastCalledWith(expect.any(String), undefined);
    const partial = await get(id, { Range: "bytes=10-29" });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("Content-Range")).toBe("bytes 10-29/100");
    expect(r2.get).toHaveBeenLastCalledWith(expect.any(String), { range: expect.any(Headers) });
    expect((await get(id, { Range: "bytes=90-" })).headers.get("Content-Range")).toBe("bytes 90-99/100");
    expect((await get(id, { Range: "bytes=-5" })).headers.get("Content-Range")).toBe("bytes 95-99/100");
    expect((await get(id, { Range: "bytes=10-500" })).headers.get("Content-Range")).toBe("bytes 10-99/100");
  });
});
