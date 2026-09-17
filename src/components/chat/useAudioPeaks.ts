import { useCallback, useRef, useState } from "react";

/**
 * 语音气泡的真波形：把一段音频解码成 0–1 的振幅数组，喂给 AudioScrubber。
 *
 * 只在用户第一次点播放时才解码——语音气泡原本是 preload="none" 的懒加载，
 * 若为了画波形提前把整段音频拉下来，一屏几十条语音就会把流量和内存一起吃掉。
 * 解码结果按 audioId 进程内缓存，重复播放不再算第二次。
 */
const cache = new Map<string, number[]>();
const inflight = new Map<string, Promise<number[]>>();

/** 峰值柱子数：够看出说话节奏，又不会在窄气泡里糊成一片。 */
const BUCKETS = 48;

async function decodePeaks(url: string, signal: AbortSignal): Promise<number[]> {
  const response = await fetch(url, { credentials: "include", signal });
  if (!response.ok) throw new Error("音频读取失败");
  const bytes = await response.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(bytes);
    const samples = decoded.getChannelData(0);
    const per = Math.max(1, Math.floor(samples.length / BUCKETS));
    const peaks: number[] = [];
    for (let i = 0; i < BUCKETS; i++) {
      // 取每段的均方根而不是最大值：最大值会被一次咳嗽顶满，整条波形就废了。
      let sum = 0;
      const from = i * per;
      const to = Math.min(from + per, samples.length);
      for (let j = from; j < to; j++) sum += samples[j] * samples[j];
      peaks.push(Math.sqrt(sum / Math.max(1, to - from)));
    }
    const loudest = Math.max(...peaks);
    // 整段归一化到 0–1；全程静音时给一条低平线，不要除以 0。
    return loudest > 0.001 ? peaks.map((p) => Math.min(1, p / loudest)) : peaks.map(() => 0.05);
  } finally {
    await ctx.close();
  }
}

export function useAudioPeaks(audioId: string | null) {
  const [peaks, setPeaks] = useState<number[] | null>(() => (audioId ? (cache.get(audioId) ?? null) : null));
  const aborter = useRef<AbortController | null>(null);

  /** 幂等：已解码或正在解码时直接复用，不会重复拉流。 */
  const load = useCallback(() => {
    if (!audioId || cache.has(audioId)) return;
    const running = inflight.get(audioId);
    if (running) {
      void running.then(setPeaks).catch(() => {});
      return;
    }
    const controller = new AbortController();
    aborter.current = controller;
    const task = decodePeaks(`/api/voice/audio/${audioId}`, controller.signal)
      .then((result) => {
        cache.set(audioId, result);
        inflight.delete(audioId);
        return result;
      })
      .catch((error) => {
        inflight.delete(audioId);
        throw error;
      });
    inflight.set(audioId, task);
    // 波形只是装饰：解码失败就继续用占位条，不打断播放，也不弹错给用户。
    void task.then(setPeaks).catch(() => {});
  }, [audioId]);

  return { peaks, load };
}
