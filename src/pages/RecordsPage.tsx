import { useMemo, useState, Suspense, lazy } from "react";
import { MagnifyingGlassIcon, NotebookIcon, PlusIcon } from "@phosphor-icons/react";
import type { Entry, EntryKind } from "../shared/contracts";
import { Button } from "../components/ui/button";
import { EntryCard } from "../components/cards/EntryCard";
import { money, today } from "../lib/utils";
const Heatmap = lazy(() => import("../components/Heatmap"));
const ALL: EntryKind[] = ["practice", "diary", "note", "merit", "ledger", "schedule"];

/** 某一类记录（或全部）的列表：统计、筛选、搜索与卡片。页头与类型标签由 RecordsHub 提供。 */
export function RecordsPage({
  kind,
  entries,
  canWrite,
  onCreate,
  onEdit,
  onDelete,
}: {
  kind: EntryKind | "records";
  entries: Entry[];
  canWrite: boolean;
  onCreate: (kind: EntryKind) => void;
  onEdit: (entry: Entry) => void;
  onDelete: (entry: Entry) => void;
}) {
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<"all" | "expense" | "income">("all");
  const kinds = kind === "records" ? ALL : [kind];
  const current = entries.filter((e) => kinds.includes(e.kind));
  const filtered = current.filter(
    (e) => (direction === "all" || e.extra.direction === direction) && (e.title + e.content).toLowerCase().includes(query.toLowerCase()),
  );
  const month = current.filter((e) => e.date?.startsWith(today().slice(0, 7)));
  const total = (d: string) => month.filter((e) => e.extra.direction === d).reduce((n, e) => n + (e.extra.amountCents || 0), 0);
  const activeDays = useMemo(() => new Set(current.map((e) => e.date)).size, [current]);
  const createKind: EntryKind = kind === "records" ? "note" : kind;
  return (
    <div className="records-page">
      {kind === "ledger" ? (
        <div className="ledger-stats">
          <div><span>本月支出</span><strong>{money(total("expense"))}</strong></div>
          <div><span>本月收入</span><strong>{money(total("income"))}</strong></div>
          <div><span>本月结余</span><strong>{money(total("income") - total("expense"))}</strong></div>
        </div>
      ) : (
        (kind === "practice" || kind === "merit") && (
          <section className="heatmap-section">
            <div className="section-title">
              <h2>{kind === "merit" ? "每日省察" : "功课足迹"}</h2>
              <span>已记录 {activeDays} 天 · 不作功德评判</span>
            </div>
            <Suspense fallback={<div className="skeleton" style={{ height: 120 }} />}>
              <Heatmap entries={current} />
            </Suspense>
          </section>
        )
      )}
      <div className="records-toolbar">
        {kind === "ledger" ? (
          <div className="filter-tabs">
            {(["all", "expense", "income"] as const).map((d) => (
              <button key={d} className={direction === d ? "active" : ""} onClick={() => setDirection(d)}>
                {d === "all" ? "全部" : d === "expense" ? "支出" : "收入"}
                {d === "all" && <span>{current.length}</span>}
              </button>
            ))}
          </div>
        ) : (
          <span className="records-count">{current.length} 条</span>
        )}
        <label className="search-input">
          <MagnifyingGlassIcon size={17} />
          <input aria-label="搜索记录" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索记录" />
        </label>
      </div>
      {filtered.length ? (
        <div className="entries-grid">
          {filtered.map((e) => <EntryCard key={e.id} entry={e} canWrite={canWrite} onEdit={onEdit} onDelete={onDelete} />)}
        </div>
      ) : (
        <div className="large-empty">
          <NotebookIcon size={38} weight="light" />
          <h2>{query ? "没有找到对应的记录" : "在这里，留下一点日常"}</h2>
          <p>{query ? "试着换一个关键词。" : "不用写得完整，也不用写得漂亮。从一条小小的记录开始。"}</p>
          {!query && (
            <Button variant="secondary" disabled={!canWrite} onClick={() => onCreate(createKind)}>
              <PlusIcon size={17} />
              开始记录
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
