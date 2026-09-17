import { lazy, Suspense } from "react";
import { PlusIcon } from "@phosphor-icons/react";
import type { Entry, EntryKind } from "../shared/contracts";
import { Button } from "../components/ui/button";
import { kindInfo } from "../components/cards/EntryCard";
import { TodayStrip } from "../components/TodayStrip";
import { RecordsPage } from "./RecordsPage";
const CalendarPage = lazy(() => import("./CalendarPage"));

/**
 * 统一的「我的记录」：原来侧栏里 6 个入口（今日概览 / 每日功课 / 我的记录 / 功过省察 / 生活账本 / 我的日历）
 * 收成这一页的一行标签。页头、标签、新增按钮在这里；列表与日历只管自己的内容。
 */
export const recordTabs = [
  { id: "records", label: "全部" },
  { id: "practice", label: "功课" },
  { id: "diary", label: "日记" },
  { id: "note", label: "笔记" },
  { id: "merit", label: "功过格" },
  { id: "ledger", label: "账目" },
  { id: "calendar", label: "日历" },
] as const;
export type RecordTab = (typeof recordTabs)[number]["id"];
/** 旧地址继续有效：#today 与 #journal 都落到「全部」。 */
export const recordAliases: Record<string, RecordTab> = { today: "records", journal: "records" };
export const isRecordTab = (page: string): page is RecordTab => recordTabs.some((t) => t.id === page);

export function RecordsHub({
  page,
  entries,
  canWrite,
  onCreate,
  onEdit,
  onDelete,
  onNavigate,
}: {
  page: string;
  entries: Entry[];
  canWrite: boolean;
  onCreate: (kind: EntryKind) => void;
  onEdit: (entry: Entry) => void;
  onDelete: (entry: Entry) => void;
  onNavigate: (page: string) => void;
}) {
  const tab: RecordTab = recordAliases[page] ?? (isRecordTab(page) ? page : "records");
  const createKind: EntryKind = tab === "records" ? "note" : tab === "calendar" ? "schedule" : tab;
  return (
    <div className="records-hub page-enter">
      <div className="page-heading">
        <h1>我的记录</h1>
        <Button disabled={!canWrite} onClick={() => onCreate(createKind)}>
          <PlusIcon size={17} />
          {tab === "records" ? "新增记录" : `新增${kindInfo[createKind].label}`}
        </Button>
      </div>
      <nav className="page-tabs" aria-label="记录类型">
        {recordTabs.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            className={t.id === tab ? "active" : ""}
            aria-current={t.id === tab ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              onNavigate(t.id);
            }}
          >
            {t.label}
          </a>
        ))}
      </nav>
      {tab === "records" && <TodayStrip entries={entries} canWrite={canWrite} onEdit={onEdit} />}
      {tab === "calendar" ? (
        <Suspense fallback={<div className="skeleton" style={{ height: 320 }} />}>
          <CalendarPage entries={entries} canWrite={canWrite} onEdit={onEdit} />
        </Suspense>
      ) : (
        <RecordsPage key={tab} kind={tab} entries={entries} canWrite={canWrite} onCreate={onCreate} onEdit={onEdit} onDelete={onDelete} />
      )}
    </div>
  );
}
