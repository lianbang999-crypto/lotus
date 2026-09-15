import { afterEach, describe, expect, it, vi } from "vitest";
import { createLotusTools, searchDharma } from "../../src/agent/tools";
import { sqliteStore } from "./sqlite";
const note = { kind: "note" as const, title: "随记", content: "正文", extra: {} };
const options = { toolCallId: "native-call", messages: [] };
afterEach(() => vi.unstubAllGlobals());
it("every personal mutation unconditionally asks approval, and note execution is guarded", async () => {
  const {store, sqlite} = sqliteStore();
  try {
    const tools = createLotusTools(store, {});
    for (const name of ["saveNote", "writeDiary", "recordMerit", "recordLedger", "recordPractice", "createSchedule", "updateEntry", "deleteEntry"] as const) expect(typeof tools[name].needsApproval).toBe("function");
    expect(await tools.saveNote.execute!(note, options)).toMatchObject({ok: false});
    expect(await (tools.saveNote.needsApproval as Function)(note, options)).toBe(true);
    expect(store.list()).toEqual([]);
    store.decideNativeTool(options.toolCallId, true);
    expect(await tools.saveNote.execute!(note, options)).toMatchObject({ok: true});
    expect(await tools.saveNote.execute!(note, options)).toMatchObject({ok: true});
    expect(store.list()).toHaveLength(1);
  } finally { sqlite.close(); }
});
const passage = { n: 1, id: "yg#1", aid: "yg", title: "文钞", text: "测试夹具原文", context: "", url: "https://wenchao.foyue.org/?id=yg", vol: "", volName: "", sourceType: "letter", corpus: "yinguang", role: "basis", score: 0.5 };
const response = () => ({ok: true, query: "信愿", passages: [{...passage}], sources: [{ id: "yg", title: "文钞", url: passage.url, corpus: "yinguang", role: "basis" }], retrieval: { version: "lotus-r1", mode: "hybrid", corpora: ["yinguang", "daan"], warnings: [], unavailableCorpora: [], rewritten: false } });
const env = { WENCHAO_API_URL: "https://wenchao.foyue.org/api/retrieve", WENCHAO_API_KEY: "fixture-test-key" };
const input = { query: "信愿", corpora: ["yinguang", "daan"] as ("yinguang" | "daan")[], topK: 5 };
describe("real retrieval adapter response boundary", () => {
  it("reports unconfigured retrieval without fabricating passages or fetching", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(await searchDharma({}, input)).toMatchObject({ok: false, error: {code: "RETRIEVAL_NOT_CONFIGURED"}});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the fixed server-configured URL, auth header, and validates source structure", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(response())); vi.stubGlobal("fetch", fetcher);
    expect(await searchDharma(env, input)).toMatchObject({ok: true, basisAvailable: true, passages: [passage]});
    const [url, request] = fetcher.mock.calls[0];
    expect(String(url)).toBe(env.WENCHAO_API_URL);
    expect(request.redirect).toBe("error");
    expect(request.headers.Authorization).toBe("Bearer fixture-test-key");
    expect(JSON.parse(request.body)).toEqual({...input, rewrite: false});
  });
  it.each(["invalid URL", "http://localhost/private"])("handles invalid configuration safely: %s", async (url) => {
    expect(await searchDharma({...env, WENCHAO_API_URL: url}, input)).toMatchObject({ok: false});
  });
  it("rejects swapped source roles and unsafe citation URLs instead of silently filtering", async () => {
    const wrongRole = response(); wrongRole.passages[0].role = "guide";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(wrongRole)).mockResolvedValueOnce(Response.json({...response(), passages: [{...passage, url: "https://evil.example/exfil"}]})));
    expect(await searchDharma(env, input)).toMatchObject({ok: false, error: {code: "RETRIEVAL_INVALID_RESPONSE"}});
    expect(await searchDharma(env, input)).toMatchObject({ok: false, error: {code: "RETRIEVAL_INVALID_RESPONSE"}});
  });
  it("surfaces missing primary corpus when only guidance material is available", async () => {
    const partial = {...response(), passages: [{...passage, corpus: "daan", role: "guide", url: "https://foyue.org/daan/1"}], sources: [], retrieval: {...response().retrieval, unavailableCorpora: ["yinguang"]}};
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(partial)));
    expect(await searchDharma(env, input)).toMatchObject({ok: true, basisAvailable: false, guidance: expect.stringContaining("不可用")});
  });
  it("does not expose upstream failure bodies or pretend to have evidence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("sensitive provider error", {status: 503})));
    expect(await searchDharma(env, input)).toEqual({ok: false, error: {code: "RETRIEVAL_UNAVAILABLE", message: "原文检索服务暂不可用，请稍后重试。"}});
  });
});
