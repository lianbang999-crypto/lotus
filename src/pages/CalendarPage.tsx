import { useEffect, useRef, useMemo } from "react";
import { createCalendar, createViewMonthGrid, createViewMonthAgenda } from "@schedule-x/calendar";
import "temporal-polyfill/global";
import "@schedule-x/theme-default/dist/index.css";
import type { Entry } from "../shared/contracts";

/** 月视图。页头与「添加日程」在 RecordsHub；这里只渲染日历本身。 */
export default function CalendarPage({
  entries,
  onEdit,
  canWrite,
}: {
  entries: Entry[];
  onEdit: (entry: Entry) => void;
  canWrite: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<ReturnType<typeof createCalendar> | null>(null);
  const latest = useRef({ entries, onEdit, canWrite });
  latest.current = { entries, onEdit, canWrite };
  const { events, invalid } = useMemo(() => {
    let invalid = 0;
    const events = entries
      .filter((e) => e.kind === "schedule")
      .flatMap((e) => {
        try {
          if (!e.extra.dueAt) throw new Error("Missing time");
          const start = Temporal.Instant.from(e.extra.dueAt).toZonedDateTimeISO("Asia/Shanghai");
          return [{ id: e.id, title: e.title, start, end: start.add({ minutes: 30 }) }];
        } catch {
          invalid++;
          return [];
        }
      });
    return { events, invalid };
  }, [entries]);
  useEffect(() => {
    if (!ref.current) return;
    const calendar = createCalendar({
      views: [createViewMonthGrid(), createViewMonthAgenda()],
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      firstDayOfWeek: 1,
      events: [],
      callbacks: {
        onEventClick: (event) => {
          const current = latest.current;
          const entry = current.entries.find((e) => e.id === event.id);
          if (entry && current.canWrite) current.onEdit(entry);
        },
      },
    });
    calendarRef.current = calendar;
    calendar.render(ref.current);
    return () => {
      calendarRef.current = null;
      calendar.destroy();
    };
  }, []);
  // Refresh events without resetting the user's selected month or calendar view.
  useEffect(() => {
    calendarRef.current?.events.set(events);
  }, [events]);
  return (
    <div className="calendar-page">
      <div className="calendar-hint">所有时间以北京时间显示 · 日程提醒在应用内查看</div>
      {invalid > 0 && (
        <p className="error-text" role="status">
          {invalid} 条日程的时间无法显示，请在记录中检查日期。
        </p>
      )}
      <div ref={ref} className="calendar-host" aria-label="日程日历" />
    </div>
  );
}
