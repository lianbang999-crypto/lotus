import { useEffect, useMemo, useState } from "react";
import {
  HouseSimpleIcon,
  ChatCircleDotsIcon,
  FlowerLotusIcon,
  NotebookIcon,
  HeartIcon,
  WalletIcon,
  CalendarBlankIcon,
  BookOpenIcon,
  GearSixIcon,
  ArrowRightIcon,
} from "@phosphor-icons/react";
import type { Entry, SessionInfo } from "../shared/contracts";
import { LotusMark } from "./LotusMark";
import { kindInfo } from "./cards/EntryCard";

export const nav = [
  { id: "chat", label: "和小莲聊聊", icon: ChatCircleDotsIcon },
  { id: "today", label: "今日概览", icon: HouseSimpleIcon },
  { id: "practice", label: "每日功课", icon: FlowerLotusIcon },
  { id: "journal", label: "我的记录", icon: NotebookIcon },
  { id: "merit", label: "功过省察", icon: HeartIcon },
  { id: "ledger", label: "生活账本", icon: WalletIcon },
  { id: "calendar", label: "我的日历", icon: CalendarBlankIcon },
];

/** 桌面常驻侧栏与手机抽屉共用同一套判断；SSR 不涉及，直接读 matchMedia。 */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

const dayKey = (at: string | number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
const shiftDays = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
};
/**
 * 侧栏里的记录时间线：prompt-kit 聊天骨架里「历史列表」的位置，放的是用户自己的记录，
 * 按今天 / 昨天 / 最近 7 天 / 更早分组。数据就是 entries，不需要多会话后端。
 */
export function RecordsTimeline({
  entries,
  onPick,
  onNavigate,
}: {
  entries: Entry[];
  onPick: (entry: Entry) => void;
  onNavigate: (page: string) => void;
}) {
  const groups = useMemo(() => {
    const today = dayKey(Date.now());
    const yesterday = dayKey(shiftDays(1).getTime());
    const weekAgo = dayKey(shiftDays(7).getTime());
    const buckets: Record<string, Entry[]> = { 今天: [], 昨天: [], "最近 7 天": [], 更早: [] };
    for (const entry of entries) {
      const key = dayKey(entry.date ? `${entry.date}T12:00:00+08:00` : entry.updatedAt);
      const name = key === today ? "今天" : key === yesterday ? "昨天" : key >= weekAgo ? "最近 7 天" : "更早";
      buckets[name].push(entry);
    }
    let budget = 18;
    return Object.entries(buckets)
      .filter(([, items]) => items.length)
      .map(([name, items]) => {
        const shown = items.slice(0, Math.max(0, Math.min(items.length, budget, 8)));
        budget -= shown.length;
        return { name, items: shown };
      })
      .filter((g) => g.items.length);
  }, [entries]);
  return (
    <section className="records-timeline" aria-label="最近的记录">
      {groups.length === 0 ? (
        <p className="timeline-empty">还没有记录。和小莲聊聊，或用输入框旁的「＋」写下第一条。</p>
      ) : (
        groups.map((group) => (
          <div key={group.name}>
            <div className="nav-caption">{group.name}</div>
            {group.items.map((entry) => {
              const Icon = kindInfo[entry.kind].icon;
              return (
                <button key={entry.id} type="button" className="timeline-item" title={entry.title} onClick={() => onPick(entry)}>
                  <Icon size={15} />
                  <span>{entry.title}</span>
                  <small>{kindInfo[entry.kind].label}</small>
                </button>
              );
            })}
          </div>
        ))
      )}
      {entries.length > 0 && (
        <button type="button" className="timeline-more" onClick={() => onNavigate("journal")}>
          查看全部记录
          <ArrowRightIcon size={13} />
        </button>
      )}
    </section>
  );
}

export type SidebarProps = {
  page: string;
  session: SessionInfo | null;
  entries: Entry[];
  navigate: (page: string) => void;
  onPick: (entry: Entry) => void;
  onAccount: () => void;
  onSettings: () => void;
};
/** 侧栏主体：桌面 <aside> 与手机 Radix 抽屉共用。品牌固定在顶部，导航与时间线可滚动，账号行沉底。 */
export function SidebarBody({ page, session, entries, navigate, onPick, onAccount, onSettings }: SidebarProps) {
  return (
    <>
      <a className="brand" href="#chat" onClick={() => navigate("chat")}>
        <span className="brand-mark">
          <LotusMark size={39} />
        </span>
        <div>
          <strong>
            小莲 <span>Lotus</span>
          </strong>
          <small>净土伴修，日常相伴</small>
        </div>
      </a>
      <div className="sidebar-scroll">
        <nav aria-label="对话与记录">
          {nav.map((item, i) => (
            <div key={item.id}>
              {i === 1 && <div className="nav-caption">对话里的日常</div>}
              <a
                href={`#${item.id}`}
                onClick={() => navigate(item.id)}
                className={`nav-item ${page === item.id ? "active" : ""}`}
                aria-current={page === item.id ? "page" : undefined}
              >
                <item.icon size={20} weight={page === item.id ? "duotone" : "regular"} />
                <span>{item.label}</span>
                {page === item.id && <i />}
              </a>
            </div>
          ))}
        </nav>
        {session?.capabilities.entries && <RecordsTimeline entries={entries} onPick={onPick} onNavigate={navigate} />}
      </div>
      <div className="sidebar-bottom">
        <button className={`nav-item ${page === "sources" ? "active" : ""}`} onClick={() => navigate("sources")}>
          <BookOpenIcon size={19} />
          <span>法义文库</span>
          <ArrowRightIcon size={15} />
        </button>
        <div className="sidebar-message">
          <LotusMark size={26} />
          <p>
            不求一时圆满，
            <br />
            只愿日日相伴。
          </p>
        </div>
        <div className="account-row">
          <button className="account-button" onClick={onAccount}>
            <span className="account-avatar">{session?.mode === "local" ? "莲" : session?.user?.name?.slice(0, 1) || "莲"}</span>
            <span>
              <strong>{session?.mode === "local" ? "本地体验" : session?.user?.name || "与你相遇"}</strong>
              <small>{session?.mode === "local" ? "记录保存在本机" : session?.authenticated ? "我的佛悦账号" : "登录，安放你的日常"}</small>
            </span>
          </button>
          <button className="icon-link" aria-label="设置" onClick={onSettings}>
            <GearSixIcon size={19} />
          </button>
        </div>
      </div>
    </>
  );
}
