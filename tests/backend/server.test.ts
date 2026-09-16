import { beforeEach, describe, expect, it, vi } from "vitest";
const gateway = vi.hoisted(() => ({
  resolveSession: vi.fn(),
  getAgentByName: vi.fn(),
  bindOwner: vi.fn(),
  personalAPI: vi.fn(),
  fetch: vi.fn(),
  sdkOnMessage: vi.fn(),
}));
vi.mock("agents", () => ({getAgentByName: gateway.getAgentByName}));
vi.mock("@cloudflare/ai-chat", () => ({AIChatAgent: class {
  env: unknown;
  ctx: unknown;
  onMessage = gateway.sdkOnMessage;
  constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; }
  // 原型方法而不是实例字段：LotusAgent.onConnect 里 super.onConnect 走的是原型链
  onConnect() {}
}}));
vi.mock("../../src/agent/auth", async (original) => ({ ...await original<typeof import("../../src/agent/auth")>(), resolveSession: gateway.resolveSession }));
import worker, { LotusAgent, RECONNECT_CODE } from "../../src/server";
import { sqliteStore } from "./sqlite";
const env = { LotusAgent: {}, OPENAI_API_KEY: "fixture-model-key", MODEL_NAME: "test", DEV_LOCAL: "false" } as never;
const request = (path: string, init?: RequestInit) => new Request(`https://lotus.foyue.org${path}`, init);
beforeEach(() => {
  vi.clearAllMocks();
  gateway.resolveSession.mockResolvedValue({accountId: "trusted-account", name: "佛友", isAnonymous: false, mode: "cloud"});
  gateway.getAgentByName.mockResolvedValue({bindOwner: gateway.bindOwner, personalAPI: gateway.personalAPI, fetch: gateway.fetch});
  gateway.personalAPI.mockResolvedValue(Response.json({entries: []}));
  gateway.fetch.mockResolvedValue(new Response("chat"));
});
describe("authenticated routing boundary", () => {
  it("routes exclusively by verified accountId despite forged query and identity headers", async () => {
    expect((await worker.fetch(request("/api/entries?accountId=other&name=other", {headers: {"X-User-Id": "other"}}), env)).status).toBe(200);
    expect(gateway.getAgentByName).toHaveBeenCalledWith(expect.anything(), "account:trusted-account");
    expect(gateway.bindOwner).toHaveBeenCalledWith("trusted-account");
    expect(gateway.personalAPI).toHaveBeenCalledWith(expect.any(Request), "trusted-account");
  });
  it.each(["/agents/lotus-agent/victim", "/agents", "/api/agent/victim", "/api/agent/subagent/victim"])("refuses an arbitrary instance route %s", async (path) => {
    expect((await worker.fetch(request(path), env)).status).toBe(404);
    expect(gateway.getAgentByName).not.toHaveBeenCalled();
  });
  it("unauthenticated and anonymous users cannot open personal storage", async () => {
    gateway.resolveSession.mockResolvedValueOnce(null).mockResolvedValueOnce({accountId: "anon", isAnonymous: true, mode: "cloud"});
    expect((await worker.fetch(request("/api/entries"), env)).status).toBe(401);
    expect((await worker.fetch(request("/api/entries"), env)).status).toBe(403);
    expect(gateway.getAgentByName).not.toHaveBeenCalled();
  });
  it.each([undefined, "https://evil.example", "null"])("rejects missing or cross-origin mutation origin %s", async (origin) => {
    const headers = new Headers({"Content-Type": "application/json"});
    if (origin) headers.set("Origin", origin);
    expect((await worker.fetch(request("/api/proposals", {method: "POST", headers, body: "{}"}), env)).status).toBe(403);
    expect(gateway.getAgentByName).not.toHaveBeenCalled();
  });
  it("requires same origin on a WebSocket upgrade", async () => {
    expect((await worker.fetch(request("/api/agent", {headers: {Upgrade: "websocket", Origin: "https://evil.example"}}), env)).status).toBe(403);
    expect(gateway.fetch).not.toHaveBeenCalled();
    expect((await worker.fetch(request("/api/agent", {headers: {Upgrade: "websocket", Origin: "https://lotus.foyue.org"}}), env)).status).toBe(200);
    expect(gateway.fetch).toHaveBeenCalledOnce();
  });
  it("exposes no arbitrary agent route and no personal storage before a valid session", async () => {
    gateway.resolveSession.mockResolvedValue(null);
    const response = await worker.fetch(request("/api/session"), env);
    expect(await response.json()).toMatchObject({authenticated: false, user: null, capabilities: {chat: false, entries: false, write: false}});
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(gateway.getAgentByName).not.toHaveBeenCalled();
  });
  it("honestly disables model chat while preserving authenticated manual records", async () => {
    const missingModelEnv = {LotusAgent: {}, DEV_LOCAL: "false"} as never;
    const session = await worker.fetch(request("/api/session"), missingModelEnv);
    expect(await session.json()).toMatchObject({authenticated: true, mode: "unconfigured", capabilities: {chat: false, entries: true, write: true}});
    expect((await worker.fetch(request("/api/agent"), missingModelEnv)).status).toBe(503);
  });
});


// agents 0.22 起休眠强制：凭据不能留内存。握手验一次，只把 accountId 写进连接状态；每帧读状态，不再逐帧验证。
describe("connected socket authorization and native decision boundary", () => {
  type Auth = {accountId: string; verifiedAt: number} | null;
  function socket() {
    const connection = {id: "socket-1", state: null as Auth, close: vi.fn(), send: vi.fn(), setState: vi.fn()};
    connection.setState.mockImplementation((next: Auth) => { connection.state = next; });
    return connection as unknown as Parameters<LotusAgent["onConnect"]>[0] & {state: Auth};
  }
  async function connected() {
    const agent = new LotusAgent({} as never, env);
    const {store, sqlite} = sqliteStore();
    store.assertOwner("trusted-account");
    Object.assign(agent, {_lotusStore: store});
    const connection = socket();
    await agent.onConnect(connection, {request: request("/api/agent", {headers: {Cookie: "session=fixture"}})} as never);
    return {agent, connection, store, sqlite};
  }
  it("verifies once at handshake, keeps only the account id on the connection, and forwards only a first decision", async () => {
    const {agent, connection, store, sqlite} = await connected();
    try {
      expect(gateway.resolveSession).toHaveBeenCalledTimes(1);
      expect(connection.state).toMatchObject({accountId: "trusted-account"});
      expect(JSON.stringify(connection.state)).not.toContain("fixture"); // 凭据不进附件
      store.registerNativeTool("native-1", {action: "create", entry: {kind: "note", title: "审批", content: "", extra: {}}});
      const frame = JSON.stringify({type: "cf_agent_tool_approval", toolCallId: "native-1", approved: true, autoContinue: true});
      await agent.onMessage(connection, frame);
      await agent.onMessage(connection, frame);
      expect(gateway.resolveSession).toHaveBeenCalledTimes(1); // 不再逐帧去账号服务
      expect(gateway.sdkOnMessage).toHaveBeenCalledOnce();     // 第二次相同决定被吞掉
      expect(store.list()).toEqual([]);
    } finally { sqlite.close(); }
  });
  it("closes the handshake for missing, anonymous or foreign sessions, and no frame reaches the SDK afterwards", async () => {
    const cases = [null, {accountId: "anon", name: "", isAnonymous: true, mode: "cloud"}, {accountId: "other-account", name: "", isAnonymous: false, mode: "cloud"}];
    for (const session of cases) {
      gateway.resolveSession.mockResolvedValueOnce(session);
      const {agent, connection, sqlite} = await connected();
      try {
        expect(connection.close).toHaveBeenCalledWith(4401, expect.any(String));
        expect(connection.state).toBeNull();
        await agent.onMessage(connection, JSON.stringify({type: "cf_agent_chat_clear"}));
        expect(gateway.sdkOnMessage).not.toHaveBeenCalled();
      } finally { sqlite.close(); }
    }
  });
  it("asks for a fresh handshake once the connection is older than the TTL, but lets binary (voice) frames through", async () => {
    const {agent, connection, sqlite} = await connected();
    try {
      connection.state = {accountId: "trusted-account", verifiedAt: Date.now() - 31 * 60 * 1000};
      // 音频帧过门禁后由 withVoice 混入吞掉（进通话缓冲），不会到聊天 SDK，也不会被当成过期连接关掉。
      await agent.onMessage(connection, new ArrayBuffer(8));
      expect(connection.close).not.toHaveBeenCalled();
      expect(gateway.sdkOnMessage).not.toHaveBeenCalled();
      await agent.onMessage(connection, JSON.stringify({type: "cf_agent_chat_clear"}));
      expect(connection.close).toHaveBeenCalledWith(RECONNECT_CODE, expect.any(String));
      expect(gateway.sdkOnMessage).not.toHaveBeenCalled();
    } finally { sqlite.close(); }
  });
  it("refuses to start a call on a connection that never passed the handshake, and only then", async () => {
    const {agent, connection, sqlite} = await connected();
    try {
      (agent as unknown as { env: object }).env = { ...(env as object), AI: {}, OPENAI_BASE_URL: "https://api.siliconflow.cn/v1" }; // 通话需要识别 + 朗读都配好
      expect(agent.beforeCallStart(connection as never)).toBe(true);
      connection.state = null;
      expect(agent.beforeCallStart(connection as never)).toBe(false);
      expect(connection.send).toHaveBeenCalledWith(expect.stringContaining("\"type\":\"error\""));
    } finally { sqlite.close(); }
  });
});
