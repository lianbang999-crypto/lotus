import { useEffect, useRef, useId, useState } from "react";
import CalHeatmap from "cal-heatmap";
import "cal-heatmap/cal-heatmap.css";
import type { Entry } from "../shared/contracts";

export default function Heatmap({ entries }: { entries: Entry[] }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const host = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    // Each effect owns one container: asynchronous cleanup cannot remove the next chart.
    const container = document.createElement("div");
    container.id = `heatmap-${id}-${++generation.current}`;
    host.current.appendChild(container);
    const cal = new CalHeatmap();
    const counts = new Map<string, number>();
    entries.forEach((e) => {
      if (e.date && Number.isFinite(Date.parse(`${e.date}T12:00:00+08:00`)))
        counts.set(e.date, (counts.get(e.date) || 0) + 1);
    });
    const start = new Date();
    start.setDate(1);
    start.setMonth(start.getMonth() - 3);
    let disposed = false;
    let destroyed = false;
    const destroy = async () => {
      if (destroyed) return;
      destroyed = true;
      try {
        await cal.destroy();
      } catch {
        /* A partially painted, detached chart has no remaining UI. */
      }
    };
    setFailed(false);
    const painted = cal
      .paint({
        itemSelector: `#${container.id}`,
        range: 4,
        date: { start, timezone: "Asia/Shanghai" },
        domain: { type: "month", gutter: 18, label: { text: "YYYY年 M月", position: "top" } },
        subDomain: { type: "ghDay", width: 12, height: 12, gutter: 4, radius: 3 },
        data: {
          source: Array.from(counts, ([date, value]) => ({
            date: new Date(`${date}T12:00:00+08:00`).getTime(),
            value,
          })),
          x: "date",
          y: "value",
        },
        scale: {
          color: {
            type: "threshold",
            range: ["#e9ede3", "#b7c6a6", "#8ca576", "#627f52"],
            domain: [1, 2, 4],
          },
        },
        animationDuration: 0,
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      container.remove();
      void painted.then(destroy);
    };
  }, [entries, id]);
  return (
    <div className="heatmap-wrap">
      <div ref={host} role="img" aria-label="最近四个月每日记录次数热力图" />
      {failed && (
        <p className="error-text" role="status">
          热力图暂时无法显示，你的记录仍可在列表中查看。
        </p>
      )}
      <div className="heatmap-legend">
        <span>每一格是一天，深浅代表记录次数</span>
        <span>
          少<i />
          <i />
          <i />
          <i />多
        </span>
      </div>
    </div>
  );
}
