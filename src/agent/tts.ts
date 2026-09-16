import type { TTSProvider } from "agents/voice";

export type TTSEnv = { OPENAI_API_KEY?: string; OPENAI_BASE_URL?: string };
export type SiliconFlowTTSOptions = { apiKey: string; baseUrl?: string; model?: string; voice?: string; format?: "mp3" | "wav" };
const SILICONFLOW = "https://api.siliconflow.cn/v1";
const MODEL = "FunAudioLLM/CosyVoice2-0.5B";

/** 上游给的是 wav 还是 mp3 按字节头判断，不信 Content-Type。 */
export function audioMime(audio: ArrayBuffer): "audio/wav" | "audio/mpeg" {
  const head = new Uint8Array(audio, 0, Math.min(4, audio.byteLength));
  return head.length === 4 && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 ? "audio/wav" : "audio/mpeg";
}

/**
 * 中文 TTS：SiliconFlow 的 CosyVoice2-0.5B（OpenAI 兼容 /audio/speech）。
 * 2026-09-16 spike：Workers AI 的 melotts 传 lang "zh" 能返回 44.1 kHz WAV，但喂回 Whisper，
 * 在 8 种采样率/声道解释下都听不出一个字（"安康安康…"），判定不可用；CosyVoice2 的输出 Whisper 逐字还原，
 * 延迟约 1 秒，采用。SDK 自带的 WorkersAITTS 走 Deepgram aura，只有英/西语。接口只有一个 synthesize。
 */
export class SiliconFlowTTS implements TTSProvider {
  constructor(private readonly options: SiliconFlowTTSOptions) {}

  async synthesize(text: string, signal?: AbortSignal): Promise<ArrayBuffer | null> {
    const input = text.replace(/\s+/g, " ").trim();
    if (!input) return null;
    const model = this.options.model ?? MODEL;
    const response = await fetch(`${(this.options.baseUrl ?? SILICONFLOW).replace(/\/$/, "")}/audio/speech`, {
      // 同 auth.ts：Workers 不支持 redirect: "error"，3xx 由 !response.ok 拦下。
      method: "POST",
      redirect: "manual",
      signal: signal ?? AbortSignal.timeout(40_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.options.apiKey}` },
      body: JSON.stringify({ model, input, voice: `${model}:${this.options.voice ?? "claire"}`, response_format: this.options.format ?? "mp3" }),
    });
    if (!response.ok) {
      // 上游失败只记日志不外泄。
      console.warn(`cosyvoice ${response.status}: ${(await response.text().catch(() => "")).slice(0, 300)}`);
      return null;
    }
    const buffer = await response.arrayBuffer();
    return buffer.byteLength > 0 ? buffer : null;
  }
}

/** 只有 OPENAI_BASE_URL 指向 SiliconFlow 时才有中文 TTS；否则朗读与通话如实报"未配置"，不拿听不懂的音频凑数。 */
export function createChineseTTS(env: TTSEnv): TTSProvider | null {
  if (!env.OPENAI_API_KEY || !env.OPENAI_BASE_URL) return null;
  try {
    if (new URL(env.OPENAI_BASE_URL).host !== "api.siliconflow.cn") return null;
  } catch {
    return null;
  }
  return new SiliconFlowTTS({ apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL });
}
