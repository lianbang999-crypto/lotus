import { proposalInputSchema, type Entry, type EntryKind, type Proposal, type ProposalInput } from "../shared/contracts";

export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export interface SqlDatabase {
  query<T = Record<string, unknown>>(sql: string, ...bindings: (string | number | null)[]): T[];
  transaction<T>(callback: () => T): T;
}
type EntryRow = { id: string; kind: EntryKind; title: string; content: string; date: string | null; extra: string; version: number; created_at: string; updated_at: string };
type ProposalRow = { id: string; status: Proposal["status"]; operation: string; created_at: string; resolved_at: string | null; result: string | null };
const parseEntry = (row: EntryRow): Entry => ({ id: row.id, kind: row.kind, title: row.title, content: row.content, ...(row.date ? {date: row.date} : {}), extra: JSON.parse(row.extra), version: row.version, createdAt: row.created_at, updatedAt: row.updated_at });
const parseProposal = (row: ProposalRow): Proposal => ({ id: row.id, status: row.status, operation: JSON.parse(row.operation), createdAt: row.created_at, resolvedAt: row.resolved_at, result: row.result ? JSON.parse(row.result) : null });

export class LotusStore {
  constructor(private db: SqlDatabase) {
    db.query("CREATE TABLE IF NOT EXISTS lotus_owner (id INTEGER PRIMARY KEY CHECK(id = 1), account_id TEXT NOT NULL)");
    db.query("CREATE TABLE IF NOT EXISTS lotus_entries (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, date TEXT, extra TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
    db.query("CREATE TABLE IF NOT EXISTS lotus_proposals (id TEXT PRIMARY KEY, status TEXT NOT NULL, operation TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT, result TEXT)");
    db.query("CREATE TABLE IF NOT EXISTS lotus_native_proposals (id TEXT PRIMARY KEY, status TEXT NOT NULL, operation TEXT NOT NULL)");
    db.query("CREATE TABLE IF NOT EXISTS lotus_executions (id TEXT PRIMARY KEY, operation TEXT NOT NULL, result TEXT NOT NULL)");
  }
  assertOwner(accountId: string) {
    this.db.transaction(() => {
      const owner = this.db.query<{ account_id: string }>("SELECT account_id FROM lotus_owner WHERE id = 1")[0];
      if (owner && owner.account_id !== accountId) throw new AppError("ACCOUNT_MISMATCH", "此资料不属于当前账号", 403);
      if (!owner) this.db.query("INSERT INTO lotus_owner (id, account_id) VALUES (1, ?)", accountId);
    });
  }
  list(kind?: EntryKind): Entry[] {
    const rows = kind ? this.db.query<EntryRow>("SELECT * FROM lotus_entries WHERE kind = ? ORDER BY updated_at DESC LIMIT 300", kind) : this.db.query<EntryRow>("SELECT * FROM lotus_entries ORDER BY updated_at DESC LIMIT 300");
    return rows.map(parseEntry);
  }
  get(id: string): Entry | undefined {
    const row = this.db.query<EntryRow>("SELECT * FROM lotus_entries WHERE id = ?", id)[0];
    return row ? parseEntry(row) : undefined;
  }
  proposals(): Proposal[] {
    return this.db.query<ProposalRow>("SELECT * FROM lotus_proposals ORDER BY created_at DESC LIMIT 100").map(parseProposal);
  }
  createProposal(input: ProposalInput, id: string = crypto.randomUUID()): Proposal {
    const operation = proposalInputSchema.parse(input);
    return this.db.transaction(() => {
      const existing = this.proposal(id);
      if (existing) {
        if (JSON.stringify(existing.operation) !== JSON.stringify(operation)) throw new AppError("IDEMPOTENCY_CONFLICT", "相同请求编号不能更改提案", 409);
        return existing;
      }
      this.validateTarget(operation);
      const now = new Date().toISOString();
      this.db.query("INSERT INTO lotus_proposals (id, status, operation, created_at) VALUES (?, 'pending', ?, ?)", id, JSON.stringify(operation), now);
      return this.proposal(id)!;
    });
  }
  proposal(id: string): Proposal | undefined {
    const row = this.db.query<ProposalRow>("SELECT * FROM lotus_proposals WHERE id = ?", id)[0];
    return row ? parseProposal(row) : undefined;
  }
  resolveProposal(id: string, approved: boolean): Proposal {
    return this.db.transaction(() => {
      const proposal = this.proposal(id);
      if (!proposal) throw new AppError("NOT_FOUND", "找不到这项待确认操作", 404);
      const targetStatus = approved ? "approved" : "rejected";
      if (proposal.status !== "pending") {
        if (proposal.status !== targetStatus) throw new AppError("PROPOSAL_RESOLVED", "这项操作已处理，不能更改决定", 409);
        return proposal;
      }
      const result = approved ? this.apply(proposal.operation) : null;
      this.db.query("UPDATE lotus_proposals SET status = ?, resolved_at = ?, result = ? WHERE id = ?", targetStatus, new Date().toISOString(), result ? JSON.stringify(result) : null, id);
      return this.proposal(id)!;
    });
  }
  registerNativeTool(toolCallId: string, input: ProposalInput): true {
    const operation = proposalInputSchema.parse(input);
    if (!toolCallId) throw new AppError("MISSING_TOOL_ID", "操作缺少唯一编号");
    this.db.transaction(() => {
      const previous = this.db.query<{ operation: string }>("SELECT operation FROM lotus_native_proposals WHERE id = ?", toolCallId)[0];
      if (previous && previous.operation !== JSON.stringify(operation)) throw new AppError("IDEMPOTENCY_CONFLICT", "待确认操作内容已改变", 409);
      if (!previous) this.db.query("INSERT INTO lotus_native_proposals (id, status, operation) VALUES (?, 'pending', ?)", toolCallId, JSON.stringify(operation));
    });
    return true;
  }
  decideNativeTool(toolCallId: string, approved: boolean): boolean {
    return this.db.transaction(() => {
      const previous = this.db.query<{ status: string }>("SELECT status FROM lotus_native_proposals WHERE id = ?", toolCallId)[0];
      if (!previous) throw new AppError("UNKNOWN_APPROVAL", "找不到服务端待确认操作", 409);
      const status = approved ? "approved" : "rejected";
      if (previous.status !== "pending" && previous.status !== status) throw new AppError("PROPOSAL_RESOLVED", "操作已处理，不能更改决定", 409);
      if (previous.status === status) return false;
      this.db.query("UPDATE lotus_native_proposals SET status = ? WHERE id = ?", status, toolCallId);
      return true;
    });
  }
  // Both the SDK gate and this immutable server-side approval ledger must agree.
  executeApprovedTool(toolCallId: string, input: ProposalInput): Entry | { deleted: string } {
    const operation = proposalInputSchema.parse(input);
    if (!toolCallId) throw new AppError("MISSING_TOOL_ID", "操作缺少唯一编号");
    return this.db.transaction(() => {
      const pending = this.db.query<{ status: string; operation: string }>("SELECT status, operation FROM lotus_native_proposals WHERE id = ?", toolCallId)[0];
      if (!pending || pending.status !== "approved") throw new AppError("APPROVAL_REQUIRED", "请先确认这项操作", 403);
      if (pending.operation !== JSON.stringify(operation)) throw new AppError("APPROVAL_CONTENT_MISMATCH", "执行内容与确认内容不一致", 409);
      const previous = this.db.query<{ operation: string; result: string }>("SELECT operation, result FROM lotus_executions WHERE id = ?", toolCallId)[0];
      if (previous) {
        if (previous.operation !== JSON.stringify(operation)) throw new AppError("IDEMPOTENCY_CONFLICT", "相同操作编号的内容已改变", 409);
        return JSON.parse(previous.result);
      }
      const result = this.apply(operation);
      this.db.query("INSERT INTO lotus_executions (id, operation, result) VALUES (?, ?, ?)", toolCallId, JSON.stringify(operation), JSON.stringify(result));
      return result;
    });
  }
  private validateTarget(operation: ProposalInput) {
    if (operation.action === "create") return;
    const entry = this.get(operation.entryId);
    if (!entry) throw new AppError("NOT_FOUND", "记录已经不存在", 404);
    if (entry.version !== operation.expectedVersion) throw new AppError("STALE_VERSION", "记录已更新，请重新查看后确认", 409);
    if (operation.action === "update" && operation.entry.kind !== entry.kind) throw new AppError("KIND_MISMATCH", "修改不能改变记录分类", 400);
  }
  private apply(operation: ProposalInput): Entry | { deleted: string } {
    this.validateTarget(operation);
    if (operation.action === "delete") {
      this.db.query("DELETE FROM lotus_entries WHERE id = ? AND version = ?", operation.entryId, operation.expectedVersion);
      return { deleted: operation.entryId };
    }
    const now = new Date().toISOString();
    const entry = operation.entry;
    if (operation.action === "create") {
      const id = crypto.randomUUID();
      this.db.query("INSERT INTO lotus_entries (id, kind, title, content, date, extra, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)", id, entry.kind, entry.title, entry.content, entry.date ?? null, JSON.stringify(entry.extra), now, now);
      return this.get(id)!;
    }
    this.db.query("UPDATE lotus_entries SET title = ?, content = ?, date = ?, extra = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?", entry.title, entry.content, entry.date ?? null, JSON.stringify(entry.extra), now, operation.entryId, operation.expectedVersion);
    return this.get(operation.entryId)!;
  }
}
