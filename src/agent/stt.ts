import { WorkersAINova3STT, type Transcriber, type TranscriberSession, type TranscriberSessionOptions } from "agents/voice";

const WHISPER = "@cf/openai/whisper-large-v3-turbo";
const SAMPLE_RATE = 16000;

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** 16 kHz 单声道 PCM16 → 44 字节标准头 WAV（与语音条走的是同一格式）。 */
export function pcmToWav(parts: Int16Array[]): Uint8Array<ArrayBuffer> {
  const samples = parts.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(new ArrayBuffer(44 + samples * 2));
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
  tag(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); tag(8, "WAVE");
  tag(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, "data"); view.setUint32(40, samples * 2, true);
  let offset = 44;
  for (const p of parts) { for (let i = 0; i < p.length; i++, offset += 2) view.setInt16(offset, p[i], true); }
  return bytes;
}

export type WhisperVADOptions = {
  /** 能量阈值（PCM16 RMS）。 */
  threshold?: number;
  /** 说话后静音多久算一句结束。 */
  silenceMs?: number;
  /** 短于这个时长的响动不送识别（咳嗽、碰麦）。 */
  minSpeechMs?: number;
  /** 一句最长多久强制切段。 */
  maxUtteranceMs?: number;
};

/**
 * 能量 VAD + Whisper 分段识别：没有流式接口，说完一句才出字，没有中间结果。
 * 用途：① 本地 dev 的远程 AI 绑定不走 WebSocket，Nova-3 起不来；② 线上 Nova-3 万一不可用时的退路。
 */
export class WhisperTranscriber implements Transcriber {
  constructor(
    private readonly ai: Ai,
    private readonly options: WhisperVADOptions = {},
  ) {}

  createSession(options: TranscriberSessionOptions = {}): TranscriberSession {
    return new WhisperSession(this.ai, options, this.options);
  }
}

class WhisperSession implements TranscriberSession {
  private chunks: Int16Array[] = [];
  private preRoll: Int16Array[] = [];
  private speaking = false;
  private silentMs = 0;
  private speechMs = 0;
  private closed = false;
  private queue: Promise<void> = Promise.resolve();
  private readonly threshold: number;
  private readonly silenceMs: number;
  private readonly minSpeechMs: number;
  private readonly maxUtteranceMs: number;

  constructor(
    private readonly ai: Ai,
    private readonly session: TranscriberSessionOptions,
    vad: WhisperVADOptions,
  ) {
    this.threshold = vad.threshold ?? 500;
    this.silenceMs = vad.silenceMs ?? 800;
    this.minSpeechMs = vad.minSpeechMs ?? 250;
    this.maxUtteranceMs = vad.maxUtteranceMs ?? 20_000;
  }

  feed(chunk: ArrayBuffer) {
    if (this.closed || chunk.byteLength < 2) return;
    const pcm = new Int16Array(chunk.slice(0, chunk.byteLength & ~1));
    const ms = pcm.length / (SAMPLE_RATE / 1000);
    let energy = 0;
    for (let i = 0; i < pcm.length; i++) energy += pcm[i] * pcm[i];
    const loud = Math.sqrt(energy / pcm.length) > this.threshold;
    if (loud) {
      if (!this.speaking) {
        this.speaking = true;
        this.speechMs = 0;
        this.chunks = [...this.preRoll];
        this.session.onSpeechStart?.();
      }
      this.silentMs = 0;
      this.speechMs += ms;
    } else if (this.speaking) {
      this.silentMs += ms;
    }
    if (this.speaking) {
      this.chunks.push(pcm);
      if (this.silentMs >= this.silenceMs || this.speechMs >= this.maxUtteranceMs) this.flush();
    } else {
      // 句首前 ~300 ms 也带上，免得第一个字被切掉
      this.preRoll.push(pcm);
      while (this.preRoll.reduce((n, p) => n + p.length, 0) > SAMPLE_RATE * 0.3) this.preRoll.shift();
    }
  }

  private flush() {
    const utterance = this.chunks;
    const speechMs = this.speechMs;
    this.chunks = [];
    this.preRoll = [];
    this.speaking = false;
    this.silentMs = 0;
    this.speechMs = 0;
    if (speechMs < this.minSpeechMs) return;
    this.queue = this.queue.then(() => this.transcribe(utterance)).catch((error) => {
      console.warn(`whisper 分段识别失败: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private async transcribe(parts: Int16Array[]) {
    const result = (await this.ai.run(WHISPER, { audio: toBase64(pcmToWav(parts)), language: this.session.language ?? "zh", task: "transcribe", vad_filter: true })) as { text?: string };
    const text = (result.text ?? "").trim();
    if (text && !this.closed) this.session.onUtterance?.(text);
  }

  close() {
    this.closed = true;
    this.chunks = [];
    this.preRoll = [];
  }
}

/**
 * 通话识别：优先 Nova-3 流式（普通话、有中间结果），起不来就退到 Whisper 分段。
 * Nova-3 在会话建立阶段失败时会同时 reject waitUntilReady 和回调 onFatalError；
 * 后者被这里拦下，不让混入把通话直接挂掉。
 */
export class LotusTranscriber implements Transcriber {
  constructor(private readonly ai: Ai) {}

  createSession(options: TranscriberSessionOptions = {}): TranscriberSession {
    return new FallbackSession(
      (fatal) => new WorkersAINova3STT(this.ai, { language: "zh", endpointingMs: 400, utteranceEndMs: 1200 }).createSession({ ...options, onFatalError: fatal }),
      () => new WhisperTranscriber(this.ai).createSession(options),
      options,
    );
  }
}

class FallbackSession implements TranscriberSession {
  private active: TranscriberSession;
  private settled = false;
  /** 流式会话还没定下来时收到的音频；Nova-3 建立要一两秒，用户可能已经开口，退到 Whisper 时把这段补喂进去。 */
  private pending: ArrayBuffer[] = [];
  private pendingBytes = 0;
  private readonly ready: Promise<void>;

  constructor(
    createStreaming: (onFatalError: (error: Error) => void) => TranscriberSession,
    createFallback: () => TranscriberSession,
    private readonly session: TranscriberSessionOptions,
  ) {
    const streaming = createStreaming((error) => {
      // 建立阶段的失败由下面的 catch 接管；通话中途断线才真的算致命
      if (this.settled && this.active === streaming) this.session.onFatalError?.(error);
    });
    this.active = streaming;
    this.ready = (streaming.waitUntilReady?.() ?? Promise.resolve())
      .catch(async (error) => {
        console.warn(`Nova-3 流式识别不可用，改用 Whisper 分段识别: ${error instanceof Error ? error.message : String(error)}`);
        streaming.close();
        this.active = createFallback();
        await this.active.waitUntilReady?.();
        for (const chunk of this.pending) this.active.feed(chunk);
      })
      .finally(() => {
        this.settled = true;
        this.pending = [];
        this.pendingBytes = 0;
      });
  }

  feed(chunk: ArrayBuffer) {
    if (!this.settled) {
      this.pending.push(chunk);
      this.pendingBytes += chunk.byteLength;
      // 最多留 30 秒（16 kHz PCM16 = 32 000 B/s）
      while (this.pendingBytes > 960_000 && this.pending.length > 1) this.pendingBytes -= this.pending.shift()!.byteLength;
    }
    this.active.feed(chunk);
  }
  waitUntilReady() { return this.ready; }
  updateAgentContext(text: string) { this.active.updateAgentContext?.(text); }
  close() { this.active.close(); }
}
