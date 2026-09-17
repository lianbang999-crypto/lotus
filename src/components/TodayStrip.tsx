import { useMemo, useState } from "react";
import { ClockIcon, XIcon } from "@phosphor-icons/react";
import type { Entry } from "../shared/contracts";

const dayKey = (at: number | string | Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
const clock = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * 今天到期、尚未完成的日程条——产品承诺的「应用内到期提示」。
 * 原来挂在聊天页对话上方；聊天页只留对话之后，搬到「我的记录」全部标签的顶上。
 * 关掉后当天不再出现（sessionStorage），第二天照常。
 */
export function TodayStrip({ entries, canWrite, onEdit }: { entries: Entry[]; canWrite: boolean; onEdit: (entry: Entry) => void }) {
  const today = dayKey(Date.now());
  const key = `lotus:today-dismissed:${today}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const items = useMemo(
    () =>
      entries
        .filter((e) => e.kind === "schedule" && e.extra.dueAt && !e.extra.completed && dayKey(e.extra.dueAt) === today)
        .sort((a, b) => a.extra.dueAt!.localeCompare(b.extra.dueAt!))
        .slice(0, 3),
    [entries, today],
  );
  if (dismissed || items.length === 0) return null;
  const now = Date.now();
  return (
    <div className="chat-today" role="status" aria-label="今天的日程">
      <span className="chat-today-label">
        <ClockIcon size={14} />
        今天
      </span>
      {items.map((e) => {
        const overdue = Date.parse(e.extra.dueAt!) < now;
        return (
          <button
            key={e.id}
            type="button"
            className={`chat-today-item ${overdue ? "is-overdue" : ""}`}
            disabled={!canWrite}
            title={canWrite ? "查看或标记完成" : undefined}
            onClick={() => onEdit(e)}
          >
            <time dateTime={e.extra.dueAt}>{clock.format(new Date(e.extra.dueAt!))}</time>
            <span>{e.title}</span>
            {overdue && <small>已过时间</small>}
          </button>
        );
      })}
      <button
        type="button"
        className="icon-link chat-today-close"
        aria-label="今天不再提示"
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem(key, "1");
          } catch {
            /* 没有存储也只是不记住关闭状态 */
          }
        }}
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}
