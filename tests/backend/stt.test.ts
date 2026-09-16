import { describe, expect, it, vi } from "vitest";
import { LotusTranscriber, WhisperTranscriber, pcmToWav } from "../../src/agent/stt";

// 16 kHz PCM16：ms 毫秒的方波（响）或静音
const tone = (ms: number, amplitude = 8000) => { const pcm = new Int16Array(ms * 16); for (let i = 0; i < pcm.length; i++) pcm[i] = i % 32 < 16 ? amplitude : -amplitude; return pcm.buffer; };
const silence = (ms: number) => new Int16Array(ms * 16).buffer;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("WhisperTranscriber (能量 VAD + 分段识别)", () => {
  it("sends one utterance to Whisper after speech followed by silence, with the pre-roll and language", async () => {
    const run = vi.fn().mockResolvedValue({ text: " 今天念佛五百声 " });
    const onUtterance = vi.fn(); const onSpeechStart = vi.fn();
    const session = new WhisperTranscriber({ run } as unknown as Ai).createSession({ language: "zh", onUtterance, onSpeechStart });
    session.feed(silence(200));
    for (let i = 0; i < 6; i++) session.feed(tone(100));
    expect(onSpeechStart).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
    for (let i = 0; i < 9; i++) session.feed(silence(100));
    await flush();
    expect(run).toHaveBeenCalledOnce();
    const [model, input] = run.mock.calls[0];
    expect(model).toBe("@cf/openai/whisper-large-v3-turbo");
    expect(input).toMatchObject({ language: "zh", task: "transcribe", vad_filter: true });
    const wav = Uint8Array.from(atob(input.audio), (c) => c.charCodeAt(0));
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(wav.byteLength).toBe(44 + (200 + 600 + 800) * 16 * 2); // 前置 200 ms 静音（≤300 ms 的 pre-roll）+ 说话 + 到判定句尾的 800 ms 静音
    expect(onUtterance).toHaveBeenCalledWith("今天念佛五百声");
  });
  it("ignores blips shorter than the minimum, drops empty results and stops calling back after close", async () => {
    const run = vi.fn().mockResolvedValue({ text: "" });
    const onUtterance = vi.fn();
    const session = new WhisperTranscriber({ run } as unknown as Ai).createSession({ onUtterance });
    session.feed(tone(100)); for (let i = 0; i < 9; i++) session.feed(silence(100));
    await flush();
    expect(run).not.toHaveBeenCalled();
    for (let i = 0; i < 4; i++) session.feed(tone(100)); for (let i = 0; i < 9; i++) session.feed(silence(100));
    await flush();
    expect(run).toHaveBeenCalledOnce();
    expect(onUtterance).not.toHaveBeenCalled();
    run.mockResolvedValue({ text: "阿弥陀佛" });
    for (let i = 0; i < 4; i++) session.feed(tone(100)); for (let i = 0; i < 9; i++) session.feed(silence(100));
    session.close();
    await flush();
    expect(onUtterance).not.toHaveBeenCalled();
  });
  it("builds a canonical 16 kHz mono WAV", () => {
    const wav = pcmToWav([new Int16Array([1, -1]), new Int16Array([2])]);
    expect(wav.byteLength).toBe(50);
    const view = new DataView(wav.buffer);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getInt16(44, true)).toBe(1);
    expect(view.getInt16(48, true)).toBe(2);
  });
});

describe("LotusTranscriber (Nova-3 流式，起不来退 Whisper)", () => {
  it("falls back to Whisper when the Nova-3 upgrade returns no WebSocket, without reporting a fatal error", async () => {
    const run = vi.fn().mockImplementation(async (model: string) => (model === "@cf/deepgram/nova-3" ? {} : { text: "南无阿弥陀佛" }));
    const onUtterance = vi.fn(); const onFatalError = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => {}); const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const session = new LotusTranscriber({ run } as unknown as Ai).createSession({ language: "zh", onUtterance, onFatalError });
    // 用户在会话建立前就开口：这段音频要在退路上补喂，不能丢
    for (let i = 0; i < 5; i++) session.feed(tone(100));
    await session.waitUntilReady?.();
    expect(run).toHaveBeenCalledWith("@cf/deepgram/nova-3", expect.objectContaining({ language: "zh", encoding: "linear16" }), { websocket: true });
    expect(onFatalError).not.toHaveBeenCalled();
    for (let i = 0; i < 9; i++) session.feed(silence(100));
    await flush();
    expect(onUtterance).toHaveBeenCalledWith("南无阿弥陀佛");
    const whisperCall = run.mock.calls.find(([model]) => model === "@cf/openai/whisper-large-v3-turbo")!;
    expect(atob(whisperCall[1].audio).length).toBe(44 + (500 + 800) * 32); // 建立前的 500 ms 说话也在里面
    session.close();
    error.mockRestore(); warn.mockRestore();
  });
});
