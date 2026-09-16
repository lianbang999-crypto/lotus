import { useState, useId, type FormEvent } from "react";
import { CheckIcon, ArrowRightIcon, XIcon } from "@phosphor-icons/react";
import type { Entry, EntryKind, EntryInput, Proposal, ProposalInput } from "../shared/contracts";
import { entryInputSchema } from "../shared/contracts";
import { today } from "../lib/utils";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { EntrySummary, kindInfo } from "./cards/EntryCard";
export type EditorState = { kind: EntryKind; entry?: Entry; content?: string; title?: string };
function beijingInput(iso: string) {
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? new Date(value + 8 * 3600000).toISOString().slice(0, 16) : "";
}
function beijingInstant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return undefined;
  const parsed = new Date(`${value}${value.length === 16 ? ":00" : ""}+08:00`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    new Date(parsed.getTime() + 8 * 3600000).toISOString().slice(0, value.length) !== value
  )
    return undefined;
  return parsed.toISOString();
}
export function EntryDialog({
  editor,
  onClose,
  onPropose,
}: {
  editor: EditorState;
  onClose: () => void;
  onPropose: (input: ProposalInput) => Promise<void>;
}) {
  const fieldId = useId();
  const [kind, setKind] = useState(editor.kind);
  const [title, setTitle] = useState(
    editor.entry?.title || editor.title || (editor.kind === "practice" ? "念佛" : ""),
  );
  const [content, setContent] = useState(editor.entry?.content || editor.content || "");
  const [date, setDate] = useState(editor.entry?.date || today());
  const [count, setCount] = useState(String(editor.entry?.extra.count ?? ""));
  const [unit, setUnit] = useState(editor.entry?.extra.unit || "声");
  const [amount, setAmount] = useState(
    editor.entry?.extra.amountCents !== undefined
      ? String(editor.entry.extra.amountCents / 100)
      : "",
  );
  const [direction, setDirection] = useState<"income" | "expense">(
    editor.entry?.extra.direction || "expense",
  );
  const [due, setDue] = useState(
    editor.entry?.extra.dueAt ? beijingInput(editor.entry.extra.dueAt) : `${date}T20:00`,
  );
  const [completed, setCompleted] = useState(editor.entry?.extra.completed ?? false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const extra: EntryInput["extra"] = {};
    if (kind === "practice") {
      if (count.trim() === "") {
        setError("请填写功课数量");
        return;
      }
      extra.count = Number(count);
      extra.unit = unit;
    }
    if (kind === "ledger") {
      if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
        setError("请填写金额，最多保留两位小数");
        return;
      }
      extra.amountCents = Math.round(Number(amount) * 100);
      extra.currency = "CNY";
      extra.direction = direction;
    }
    if (kind === "schedule") {
      const instant = beijingInstant(due);
      if (!instant) {
        setError("请选择有效的日程时间（北京时间）");
        return;
      }
      extra.dueAt = instant;
      extra.completed = completed;
    }
    const parsed = entryInputSchema.safeParse({ kind, title, content, date, extra });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "请检查填写内容");
      return;
    }
    setBusy(true);
    try {
      await onPropose(
        editor.entry
          ? {
              action: "update",
              entryId: editor.entry.id,
              expectedVersion: editor.entry.version,
              entry: parsed.data,
            }
          : { action: "create", entry: parsed.data },
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "暂时无法提交");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={editor.entry ? "编辑记录" : "记录此刻"}
      description="先填写内容，再查看确认卡片。现在还不会保存。"
    >
      <form onSubmit={submit} className="entry-form">
        {!editor.entry && (
          <div className="kind-picker">
            {Object.entries(kindInfo).map(([value, info]) => (
              <button
                type="button"
                key={value}
                className={kind === value ? "selected" : ""}
                onClick={() => setKind(value as EntryKind)}
              >
                <info.icon size={17} />
                {info.label}
              </button>
            ))}
          </div>
        )}
        <label>
          标题
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === "practice" ? "例如：念佛、诵经" : "给这段记录起个名字"}
            required
            maxLength={160}
          />
        </label>
        <div className="form-grid">
          <label>
            日期
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          {kind === "practice" && (
            <div>
              <label htmlFor={`${fieldId}-count`}>数量</label>
              <div className="input-unit">
                <input
                  id={`${fieldId}-count`}
                  type="number"
                  min="0"
                  max="100000000"
                  step="1"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  placeholder="0"
                  required
                />
                <select
                  aria-label="功课单位"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                >
                  <option>声</option>
                  <option>遍</option>
                  <option>分钟</option>
                  <option>拜</option>
                </select>
              </div>
            </div>
          )}
          {kind === "ledger" && (
            <label>
              金额（元）
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </label>
          )}
        </div>
        {kind === "ledger" && (
          <label>
            收支
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as "income" | "expense")}
            >
              <option value="expense">支出</option>
              <option value="income">收入</option>
            </select>
          </label>
        )}
        {kind === "schedule" && (
          <div>
            <label>
              日程时间（北京时间）
              <input
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                required
              />
              <span className="field-hint">到时会显示在应用内；暂不发送手机推送。</span>
            </label>
            {editor.entry && (
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={completed}
                  onChange={(e) => setCompleted(e.target.checked)}
                />
                日程已完成
              </label>
            )}
          </div>
        )}
        <label>
          {kind === "diary" ? "今天的心情" : kind === "merit" ? "今日省察" : "内容"}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={kindInfo[kind].hint}
            rows={4}
            maxLength={20000}
          />
        </label>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="dialog-footer">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button disabled={busy}>
            {busy ? "正在准备…" : "查看确认卡片"}
            <ArrowRightIcon size={17} />
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
export function ApprovalDialog({
  proposal,
  entries,
  onClose,
  onResolve,
}: {
  proposal: Proposal;
  entries: Entry[];
  onClose: () => void;
  onResolve: (id: string, approved: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const op = proposal.operation;
  const previous = op.action === "create" ? undefined : entries.find((e) => e.id === op.entryId);
  const entry = op.action === "delete" ? previous : op.entry;
  const changed = op.action !== "create" && (!previous || previous.version !== op.expectedVersion);
  const resolved = proposal.status !== "pending";
  async function resolve(approved: boolean) {
    setBusy(true);
    setError("");
    try {
      await onResolve(proposal.id, approved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={
        op.action === "delete"
          ? "确认删除这条记录？"
          : op.action === "update"
            ? "确认修改内容"
            : "确认这条记录"
      }
      description={
        op.action === "delete"
          ? "确认后，这条记录将从你的列表中移除。"
          : "请核对下面的内容，点击确认后才会保存。"
      }
    >
      <div className="approval-preview">
        {op.action === "update" && previous && (
          <details className="previous-entry">
            <summary>查看修改前的内容</summary>
            <EntrySummary entry={previous} />
          </details>
        )}
        {entry ? (
          <EntrySummary entry={entry} />
        ) : (
          <p>暂时无法读取这条记录的内容，请关闭卡片并刷新后再核对。</p>
        )}
      </div>
      {changed && (
        <p role="alert" className="error-text">
          记录已变化或暂时无法读取，请取消这次操作，重新查看记录后再提交。
        </p>
      )}
      {resolved && <p role="status">这次操作已经处理，请关闭卡片查看最新记录。</p>}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="dialog-footer">
        <Button variant="secondary" disabled={busy || resolved} onClick={() => resolve(false)}>
          <XIcon size={17} />
          取消这次操作
        </Button>
        <Button
          variant={op.action === "delete" ? "destructive" : "default"}
          disabled={busy || changed || resolved}
          onClick={() => resolve(true)}
        >
          <CheckIcon size={17} />
          {busy
            ? "处理中…"
            : op.action === "delete"
              ? "确认删除"
              : op.action === "update"
                ? "确认修改"
                : "确认保存"}
        </Button>
      </div>
    </Dialog>
  );
}
