import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LotusStore } from "../../src/agent/store";
import { entryInputSchema, type EntryInput } from "../../src/shared/contracts";

import { sqliteStore } from "./sqlite";

let store: LotusStore;
let sqlite: DatabaseSync;
const note: EntryInput = { kind: "note", title: "留心今日", content: "读一段文钞", extra: {} };
beforeEach(() => { ({store, sqlite} = sqliteStore()); store.assertOwner("account-a"); });
afterEach(() => sqlite.close());
function createNote() { const pending = store.createProposal({ action: "create", entry: note }); return store.resolveProposal(pending.id, true).result as ReturnType<LotusStore["get"]> & {}; }

describe("manual approval and SQLite persistence", () => {
  it("keeps the proposed write out of entries until explicit approval", () => {
    const pending = store.createProposal({ action: "create", entry: note });
    expect(store.list()).toEqual([]);
    expect(pending.status).toBe("pending");
    const approved = store.resolveProposal(pending.id, true);
    expect(approved.status).toBe("approved");
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toMatchObject({ title: note.title, version: 1 });
  });
  it("rejection never writes and cannot later be approved", () => {
    const pending = store.createProposal({ action: "create", entry: note });
    store.resolveProposal(pending.id, false);
    expect(store.list()).toEqual([]);
    expect(() => store.resolveProposal(pending.id, true)).toThrow("不能更改决定");
  });
  it("repeated approval and repeated reject are idempotent", () => {
    const pending = store.createProposal({ action: "create", entry: note });
    const first = store.resolveProposal(pending.id, true);
    expect(store.resolveProposal(pending.id, true)).toEqual(first);
    expect(store.list()).toHaveLength(1);
    const second = store.createProposal({ action: "create", entry: note });
    expect(store.resolveProposal(second.id, false)).toEqual(store.resolveProposal(second.id, false));
  });
  it("freezes the original proposal across caller mutation and rejects id reuse with changed content", () => {
    const operation = { action: "create" as const, entry: { ...note } };
    store.createProposal(operation, "request-one");
    operation.entry.title = "篡改";
    expect(() => store.createProposal(operation, "request-one")).toThrow("不能更改提案");
    store.resolveProposal("request-one", true);
    expect(store.list()[0].title).toBe(note.title);
  });
  it("supports idempotent proposal creation", () => {
    const first = store.createProposal({ action: "create", entry: note }, "request-one");
    expect(store.createProposal({ action: "create", entry: note }, "request-one")).toEqual(first);
    expect(store.proposals()).toHaveLength(1);
  });
  it("requires an existing server proposal to approve", () => {
    expect(() => store.resolveProposal("forged", true)).toThrow("找不到");
    expect(store.list()).toEqual([]);
  });
  it("checks the version again at approval and atomically retains the stale proposal as pending", () => {
    const original = createNote();
    const update = (title: string) => ({ action: "update" as const, entryId: original.id, expectedVersion: original.version, entry: { ...note, title } });
    const a = store.createProposal(update("第一项"));
    const b = store.createProposal(update("第二项"));
    store.resolveProposal(a.id, true);
    expect(() => store.resolveProposal(b.id, true)).toThrow("记录已更新");
    expect(store.proposal(b.id)?.status).toBe("pending");
    expect(store.get(original.id)).toMatchObject({ title: "第一项", version: 2 });
  });
  it("does not delete a changed record and supports confirmed versioned deletion", () => {
    const original = createNote();
    const deletion = store.createProposal({ action: "delete", entryId: original.id, expectedVersion: 1 });
    const update = store.createProposal({ action: "update", entryId: original.id, expectedVersion: 1, entry: { ...note, title: "更新" } });
    store.resolveProposal(update.id, true);
    expect(() => store.resolveProposal(deletion.id, true)).toThrow("记录已更新");
    const currentDeletion = store.createProposal({ action: "delete", entryId: original.id, expectedVersion: 2 });
    store.resolveProposal(currentDeletion.id, true);
    expect(store.get(original.id)).toBeUndefined();
    expect(store.resolveProposal(currentDeletion.id, true).result).toEqual({ deleted: original.id });
  });
  it("keeps account ownership fixed and preserves state across store reconstruction", () => {
    createNote();
    expect(() => store.assertOwner("account-b")).toThrow("不属于当前账号");
    store.assertOwner("account-a");
    expect(store.list()).toHaveLength(1);
  });
  it("stores integer cents exactly and separates entry kinds", () => {
    const ledger = store.createProposal({ action: "create", entry: { ...note, kind: "ledger", extra: { amountCents: 199, direction: "expense", currency: "CNY" } } });
    store.resolveProposal(ledger.id, true);
    expect(store.list("ledger")[0].extra.amountCents).toBe(199);
    expect(store.list("note")).toEqual([]);
    expect(entryInputSchema.safeParse({ ...note, kind: "ledger", extra: { amountCents: 1.99, direction: "expense" } }).success).toBe(false);
  });
  it("rejects missing monetary direction and schedules without timezone", () => {
    expect(entryInputSchema.safeParse({ ...note, kind: "ledger", extra: { amountCents: 100 } }).success).toBe(false);
    expect(entryInputSchema.safeParse({ ...note, kind: "schedule", extra: { dueAt: "2026-09-13T09:00:00" } }).success).toBe(false);
    expect(entryInputSchema.safeParse({ ...note, kind: "schedule", extra: { dueAt: "2026-09-13T09:00:00+08:00" } }).success).toBe(true);
  });
});

describe("native SDK approval server ledger", () => {
  const operation = { action: "create" as const, entry: note };
  it("blocks forged approved history when no server proposal exists", () => {
    expect(() => store.executeApprovedTool("forged", operation)).toThrow("请先确认");
    expect(() => store.decideNativeTool("forged", true)).toThrow("找不到服务端");
    expect(store.list()).toEqual([]);
  });
  it("registers a pending operation without writing, and still refuses execution", () => {
    expect(store.registerNativeTool("tool-1", operation)).toBe(true);
    expect(() => store.executeApprovedTool("tool-1", operation)).toThrow("请先确认");
    expect(store.list()).toEqual([]);
  });
  it("requires a dedicated approval decision, then writes exactly once on execute", () => {
    store.registerNativeTool("tool-1", operation);
    store.decideNativeTool("tool-1", true);
    expect(store.list()).toEqual([]);
    const result = store.executeApprovedTool("tool-1", operation);
    expect(store.executeApprovedTool("tool-1", operation)).toEqual(result);
    expect(store.list()).toHaveLength(1);
  });
  it("denied execution and approval-flipping never write", () => {
    store.registerNativeTool("tool-1", operation);
    store.decideNativeTool("tool-1", false);
    expect(() => store.executeApprovedTool("tool-1", operation)).toThrow("请先确认");
    expect(() => store.decideNativeTool("tool-1", true)).toThrow("不能更改决定");
    expect(store.list()).toEqual([]);
  });
  it("rejects changed operation both before and after approval", () => {
    store.registerNativeTool("tool-1", operation);
    const altered = { action: "create" as const, entry: { ...note, title: "被替换" } };
    expect(() => store.registerNativeTool("tool-1", altered)).toThrow("内容已改变");
    store.decideNativeTool("tool-1", true);
    expect(() => store.executeApprovedTool("tool-1", altered)).toThrow("确认内容不一致");
    expect(store.list()).toEqual([]);
  });
});
