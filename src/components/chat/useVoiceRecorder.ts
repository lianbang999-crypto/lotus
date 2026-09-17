import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceMeta } from "../../shared/contracts";

export type VoiceRecorderState = "idle" | "recording" | "processing";
export type VoiceClip = { wav: Blob; durationMs: number };

const MAX_MS = 90_000;
const MIN_MS = 500;
const TARGET_RATE = 16_000;
// 各浏览器 MediaRecorder 的原生容器不同（Chrome/安卓 webm，iOS/微信 mp4），按支持顺序挑一个。
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

function pickMime() {
  if (typeof MediaRecorder === "undefined") return "";
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

/**
 * 把录到的任意容器/采样率音频解码后重采样为 16 kHz 单声道 16-bit PCM WAV。
 * 服务端转写与 R2 回放都只认这一种格式，省掉对 webm/mp4 兼容性的赌博。
 */
export async function toWav16k(blob: Blob): Promise<VoiceClip> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
    const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const pcm = rendered.getChannelData(0);
    const buffer = new ArrayBuffer(44 + pcm.length * 2);
    const view = new DataView(buffer);
    const ascii = (offset: number, text: string) => {
      for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    ascii(0, "RIFF");
    view.setUint32(4, 36 + pcm.length * 2, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // 单声道
    view.setUint32(24, TARGET_RATE, true);
    view.setUint32(28, TARGET_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, pcm.length * 2, true);
    for (let i = 0, offset = 44; i < pcm.length; i++, offset += 2) {
      const sample = Math.max(-1, Math.min(1, pcm[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return { wav: new Blob([buffer], { type: "audio/wav" }), durationMs: Math.round(rendered.duration * 1000) };
  } finally {
    await ctx.close();
  }
}

/** 上传 WAV 取回转写；错误信息沿用 api() 的口径，但这里是二进制体不是 JSON。 */
export async function transcribeVoice(wav: Blob): Promise<{ text: string } & VoiceMeta> {
  const response = await fetch("/api/voice/transcribe", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "audio/wav" },
    body: wav,
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof data.message === "string" ? data.message : "语音识别未完成，请再试一次");
  }
  return data as { text: string } & VoiceMeta;
}

/**
 * 按住说话的录音机：start 开始、stop 结束并交出 16 kHz WAV、cancel 丢弃。
 * 超过 90 秒自动结束；不足 0.5 秒视为误触。回调放在 ref 里，避免录音中途因重渲染丢失。
 * 首次使用会弹麦克风授权：授权期间松手也要算数，否则授权后录音机会自己跑到 90 秒。
 */
export function useVoiceRecorder(
  onClip: (clip: VoiceClip) => Promise<void> | void,
  onError: (message: string) => void,
) {
  const [state, setState] = useState<VoiceRecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  // 录音期间把麦克风流借给波形组件做可视化，省掉它再申请一次授权。
  const [stream, setStream] = useState<MediaStream | null>(null);
  const stateRef = useRef<VoiceRecorderState>("idle");
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const cancelled = useRef(false);
  const starting = useRef(false);
  const abortStart = useRef(false);
  const ticker = useRef<number | null>(null);
  const callbacks = useRef({ onClip, onError });
  callbacks.current = { onClip, onError };

  const setPhase = (next: VoiceRecorderState) => {
    stateRef.current = next;
    setState(next);
  };
  const clearTicker = () => {
    if (ticker.current !== null) {
      window.clearInterval(ticker.current);
      ticker.current = null;
    }
  };

  const stop = useCallback(() => {
    if (starting.current) abortStart.current = true;
    const active = recorder.current;
    if (active && active.state !== "inactive") active.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    stop();
  }, [stop]);

  const finish = useCallback(async () => {
    clearTicker();
    const active = recorder.current;
    recorder.current = null;
    setStream(null); // 先撤掉可视化的引用，再关轨道
    active?.stream.getTracks().forEach((track) => track.stop());
    const parts = chunks.current;
    chunks.current = [];
    const elapsed = Date.now() - startedAt.current;
    const blob = new Blob(parts, { type: active?.mimeType || parts[0]?.type || "audio/webm" });
    if (cancelled.current || blob.size === 0 || elapsed < MIN_MS) {
      setPhase("idle");
      if (!cancelled.current && elapsed < MIN_MS) callbacks.current.onError("说话时间太短，再试一次");
      return;
    }
    setPhase("processing");
    try {
      await callbacks.current.onClip(await toWav16k(blob));
    } catch (error) {
      callbacks.current.onError(error instanceof Error ? error.message : "这段录音没能处理，请再试一次");
    } finally {
      setPhase("idle");
    }
  }, []);

  const start = useCallback(async () => {
    if (stateRef.current !== "idle" || starting.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      callbacks.current.onError("这个浏览器不支持录音");
      return;
    }
    starting.current = true;
    abortStart.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (abortStart.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mime = pickMime();
      const active = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      cancelled.current = false;
      active.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      active.onstop = () => void finish();
      recorder.current = active;
      startedAt.current = Date.now();
      active.start(250);
      setPhase("recording");
      setStream(stream);
      setElapsedMs(0);
      ticker.current = window.setInterval(() => {
        const elapsed = Date.now() - startedAt.current;
        setElapsedMs(elapsed);
        if (elapsed >= MAX_MS) stop();
      }, 200);
    } catch (error) {
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      callbacks.current.onError(denied ? "需要允许小莲使用麦克风" : "无法开始录音，请检查麦克风");
    } finally {
      starting.current = false;
    }
  }, [finish, stop]);

  useEffect(
    () => () => {
      cancelled.current = true;
      abortStart.current = true;
      clearTicker();
      const active = recorder.current;
      if (active && active.state !== "inactive") active.stop();
      active?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  return { state, elapsedMs, stream, start, stop, cancel };
}
