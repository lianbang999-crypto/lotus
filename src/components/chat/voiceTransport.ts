import type { VoiceTransport, VoiceTransportCloseInfo } from "agents/voice";

/**
 * 语音客户端默认把路径写死成 /agents/<class>/<name>，而小莲只开 /api/agent：
 * 服务端按登录会话选 Durable Object 实例，浏览器无权指定。这里用一条普通 WebSocket
 * 连同一条鉴权门（握手与聊天连接完全一样，同源 Cookie 自动带上）。通话不做自动重连——断了就是断了。
 */
export class LotusVoiceTransport implements VoiceTransport {
  #socket: WebSocket | null = null;
  #connected = false;
  onopen: (() => void) | null = null;
  onclose: ((info?: VoiceTransportCloseInfo) => void) | null = null;
  onerror: ((error?: unknown) => void) | null = null;
  onmessage: ((data: string | ArrayBuffer | Blob) => void) | null = null;

  get connected() {
    return this.#connected;
  }

  connect() {
    if (this.#socket) return;
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${location.host}/api/agent`);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      this.#connected = true;
      this.onopen?.();
    };
    socket.onclose = (event) => {
      this.#connected = false;
      this.#socket = null;
      this.onclose?.({ code: event.code, reason: event.reason, wasClean: event.wasClean });
    };
    socket.onerror = (event) => this.onerror?.(event);
    socket.onmessage = (event) => this.onmessage?.(event.data as string | ArrayBuffer | Blob);
    this.#socket = socket;
  }

  disconnect() {
    const socket = this.#socket;
    this.#socket = null;
    this.#connected = false;
    socket?.close();
  }

  sendJSON(data: Record<string, unknown>) {
    this.#socket?.send(JSON.stringify(data));
  }

  sendBinary(data: ArrayBuffer) {
    this.#socket?.send(data);
  }
}
