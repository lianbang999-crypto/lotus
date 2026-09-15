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
}}));
vi.mock("../../src/agent/auth", async (original) => ({ ...await original<typeof import("../../src/agent/auth")>(), resolveSession: gateway.resolveSession }));
import worker, { LotusAgent } from "../../src/server";
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


describe("connected socket authorization and native decision boundary", () => {
  async function connected() {
    const agent = new LotusAgent({} as never, env);
    const {store, sqlite} = sqliteStore();
    store.assertOwner("trusted-account");
    Object.assign(agent, {_lotusStore: store});
    const connection = {id: "socket-1", close: vi.fn(), send: vi.fn()} as unknown as Parameters<LotusAgent["onConnect"]>[0];
    await agent.onConnect(connection, {request: request("/api/agent", {headers: {Cookie: "session=fixture"}})} as never);
    return {agent, connection, store, sqlite};
  }
  it("revalidates the session before handling an approval and forwards only a first decision", async () => {
    const {agent, connection, store, sqlite} = await connected();
    try {
      store.registerNativeTool("native-1", {action: "create", entry: {kind: "note", title: "审批", content: "", extra: {}}});
      const frame = JSON.stringify({type: "cf_agent_tool_approval", toolCallId: "native-1", approved: true, autoContinue: true});
      await agent.onMessage(connection, frame);
      await agent.onMessage(connection, frame);
      expect(gateway.resolveSession).toHaveBeenCalledTimes(2);
      expect(gateway.sdkOnMessage).toHaveBeenCalledOnce();
      expect(store.list()).toEqual([]);
    } finally { sqlite.close(); }
  });
  it("blocks a revoked session and a different account before the SDK sees the frame", async () => {
    const {agent, connection, sqlite} = await connected();
    try {
      gateway.resolveSession.mockResolvedValueOnce(null).mockResolvedValueOnce({accountId: "other-account", isAnonymous: false, mode: "cloud"});
      await agent.onMessage(connection, JSON.stringify({type: "cf_agent_chat_clear"}));
      await agent.onMessage(connection, JSON.stringify({type: "cf_agent_chat_clear"}));
      expect(connection.close).toHaveBeenCalledTimes(2);
      expect(gateway.sdkOnMessage).not.toHaveBeenCalled();
    } finally { sqlite.close(); }
  });
  it("requires a new authenticated handshake after memory authentication context is absent", async () => {
    const {agent, connection, sqlite} = await connected();
    try {
      await agent.onClose(connection);
      await agent.onMessage(connection, JSON.stringify({type: "cf_agent_tool_approval", toolCallId: "old", approved: true}));
      expect(connection.close).toHaveBeenCalledWith(4401, expect.any(String));
      expect(gateway.sdkOnMessage).not.toHaveBeenCalled();
    } finally { sqlite.close(); }
  });
});
