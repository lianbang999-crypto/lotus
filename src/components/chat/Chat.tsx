import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  ComposerPrimitive,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import {
  getToolName,
  isToolUIPart,
  type UIMessage,
} from "ai";
import { Streamdown, defaultRehypePlugins } from "streamdown";
import {
  ArrowUpIcon,
  StopIcon,
  CheckIcon,
  XIcon,
  BookOpenIcon,
  ArrowSquareOutIcon,
  CheckCircleIcon,
  PlusIcon,
  FlowerLotusIcon,
  NotebookIcon,
  CalendarBlankIcon,
  ArrowDownIcon,
  WifiSlashIcon,
  ChatTeardropTextIcon,
  ArrowsClockwiseIcon,
  HeartIcon,
  ClockIcon,
  CopyIcon,
  PencilSimpleIcon,
  BookmarkSimpleIcon,
  MicrophoneIcon,
  PlayIcon,
  PauseIcon,
} from "@phosphor-icons/react";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { LotusMark } from "../LotusMark";
import { EntrySummary, kindInfo } from "../cards/EntryCard";
import {
  entryInputSchema,
  type Entry,
  type EntryKind,
  type Proposal,
  type SessionInfo,
  type VoiceMeta,
} from "../../shared/contracts";
import { useDraft } from "./useDraft";
import { transcribeVoice, useVoiceRecorder, type VoiceRecorderState } from "./useVoiceRecorder";

type ChatProps = {
  initialPrompt: string;
  onPromptConsumed: () => void;
  onRefresh: () => void;
  session: SessionInfo | null;
  entries: Entry[];
  proposals: Proposal[];
  onCreate: (kind: EntryKind, content?: string, title?: string) => void;
  onEdit: (entry: Entry) => void;
  onResolve: (id: string, approved: boolean) => Promise<void>;
  onLogin: () => void;
};
type Starter = { icon: typeof FlowerLotusIcon; title: string; text: string };
const starterPool = {
  practice: { icon: FlowerLotusIcon, title: "记下今日功课", text: "帮我记录今天的念佛功课。" },
  mood: { icon: NotebookIcon, title: "说说今天的心情", text: "我想和你说说今天的心情。" },
  dharma: {
    icon: BookOpenIcon,
    title: "问一个法义问题",
    text: "念佛时容易散乱，请帮我查找印光法师关于摄心念佛的开示，并附上原文出处。",
  },
  schedule: { icon: CalendarBlankIcon, title: "安排一件小事", text: "帮我安排一个日程。" },
  merit: { icon: HeartIcon, title: "做一次省察", text: "我想省察一下今天的言行。" },
} satisfies Record<string, Starter>;
const beijingHour = (now = new Date()) =>
  Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", hour: "numeric", hourCycle: "h23" }).format(now),
  );
/** 时段问候与起手句顺序：陪伴感来自“知道现在几点”，而不是固定的一句欢迎语。 */
export function moment(now = new Date()) {
  const hour = beijingHour(now);
  const p = starterPool;
  if (hour < 5 || hour >= 23)
    return { word: "夜深了", line: "还没休息吗？有什么想说的，我都在。", starters: [p.mood, p.merit, p.practice, p.dharma] };
  if (hour < 11)
    return { word: "早安", line: "新的一天，从一声佛号开始。", starters: [p.practice, p.dharma, p.mood, p.schedule] };
  if (hour < 14)
    return { word: "午安", line: "歇一歇，也是功课的一部分。", starters: [p.mood, p.practice, p.dharma, p.schedule] };
  if (hour < 18)
    return { word: "下午好", line: "一声佛号，一段心事，或是生活里的小事。", starters: [p.mood, p.practice, p.dharma, p.schedule] };
  return { word: "晚上好", line: "今天过得怎么样？可以慢慢和我说。", starters: [p.mood, p.merit, p.practice, p.dharma] };
}
/** 只在正式账号且有名字时称呼；本地开发身份叫“本地体验”，不该被当成人名。 */
function displayName(session: SessionInfo | null) {
  const name = session?.mode === "cloud" ? session.user?.name?.trim() : "";
  return name && name.length <= 12 ? name : "";
}
const toolKinds: Record<string, EntryKind> = {
  saveNote: "note",
  writeDiary: "diary",
  recordMerit: "merit",
  recordLedger: "ledger",
  recordPractice: "practice",
  createSchedule: "schedule",
};
const names: Record<string, string> = {
  saveNote: "笔记",
  writeDiary: "日记",
  recordMerit: "功过格",
  recordLedger: "账目",
  recordPractice: "功课",
  createSchedule: "日程",
  createEntry: "新增记录",
  updateEntry: "修改记录",
  deleteEntry: "删除记录",
  searchDharma: "法义资料",
  listEntries: "查找记录",
};

function Welcome({ session }: { session: SessionInfo | null }) {
  const { word, line } = moment();
  const name = displayName(session);
  return (
    <div className="chat-welcome page-enter">
      <div className="welcome-lotus">
        <LotusMark size={57} />
      </div>
      <span className="welcome-overline">小莲 · 你的净土伴修助手</span>
      <h1>
        <span className="welcome-first-line">
          {word}
          {name ? `，${name}` : ""}，
        </span>
        <span>想和小莲说些什么？</span>
      </h1>
      <p>
        {line}
        <br className="mobile-break" />
        我在这里，陪你慢慢整理。
      </p>
    </div>
  );
}
function Suggestions({ onSelect }: { onSelect: (text: string) => void }) {
  const { starters } = moment();
  return (
    <div className="chat-suggestions" aria-label="试着这样开始">
      {starters.map((item) => (
        <button key={item.title} onClick={() => onSelect(item.text)}>
          <item.icon size={19} weight="light" />
          <span>{item.title}</span>
        </button>
      ))}
    </div>
  );
}
const dayKey = (at: number | string | Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
const clock = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** 今天到期、尚未完成的日程，直接放进对话入口——这是产品承诺的“应用内到期提示”。 */
function TodayStrip({ entries, canWrite, onEdit }: { entries: Entry[]; canWrite: boolean; onEdit: (entry: Entry) => void }) {
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
function RecordMenu({
  onCreate,
  content = "",
}: {
  onCreate: ChatProps["onCreate"];
  content?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div
      className="composer-record-menu"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          ref.current?.querySelector("button")?.focus();
        }
      }}
    >
      <button
        type="button"
        className="composer-add"
        aria-label="添加记录"
        aria-expanded={open}
        aria-controls="composer-record-options"
        onClick={() => setOpen(!open)}
      >
        <PlusIcon size={21} />
      </button>
      {open && (
        <div className="composer-options" id="composer-record-options">
          <p>手动填写一条记录</p>
          {Object.entries(kindInfo).map(([kind, info]) => (
            <button
              type="button"
              key={kind}
              onClick={() => {
                setOpen(false);
                onCreate(kind as EntryKind, content);
              }}
            >
              <info.icon size={18} />
              {info.label}
            </button>
          ))}
          <small>填写后，回到对话中确认保存</small>
        </div>
      )}
    </div>
  );
}
function Footnote() {
  return (
    <p className="chat-footnote">
      每一次记录，都由你确认。<span>法义答复请核对引用原文。</span>
    </p>
  );
}
const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dayFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "long",
  day: "numeric",
  weekday: "short",
});
const dayKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** 服务端在回复开始时写入 metadata.createdAt；旧消息没有时间戳时不显示。 */
function messageTime(message: UIMessage): number | null {
  const meta = message.metadata as { createdAt?: unknown } | undefined;
  return typeof meta?.createdAt === "number" && Number.isFinite(meta.createdAt) ? meta.createdAt : null;
}
function DayDivider({ at }: { at: number }) {
  const today = dayKeyFormat.format(new Date());
  const key = dayKeyFormat.format(new Date(at));
  return (
    <div className="chat-day-divider" role="separator">
      <span>{key === today ? "今天" : dayFormat.format(new Date(at))}</span>
    </div>
  );
}
function MessageStamp({ at }: { at: number | null }) {
  if (at === null) return null;
  return (
    <time className="message-time" dateTime={new Date(at).toISOString()}>
      {timeFormat.format(new Date(at))}
    </time>
  );
}
/** 语音条元数据：模型只看到转写文字，这里只决定要不要显示可回放的语音气泡。 */
function voiceMeta(message: UIMessage): VoiceMeta | null {
  const voice = (message.metadata as { voice?: Partial<VoiceMeta> } | undefined)?.voice;
  if (!voice || typeof voice.durationMs !== "number") return null;
  return { audioId: typeof voice.audioId === "string" ? voice.audioId : null, durationMs: voice.durationMs };
}
const clipLength = (ms: number) => {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
/** 可回放的语音气泡：音频是同源请求，自带登录 Cookie；没有 audioId（R2 未配置）时只显示时长。 */
function VoiceClip({ meta }: { meta: VoiceMeta }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const bars = useMemo(() => Array.from({ length: 14 }, (_, i) => 5 + ((i * 7) % 11)), []);
  function toggle() {
    const element = audio.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setPlaying(false));
    else element.pause();
  }
  return (
    <span className="voice-clip">
      {meta.audioId && (
        <>
          <button type="button" onClick={toggle} aria-label={playing ? "暂停" : "播放语音"}>
            {playing ? <PauseIcon size={15} weight="fill" /> : <PlayIcon size={15} weight="fill" />}
          </button>
          <audio
            ref={audio}
            src={`/api/voice/audio/${meta.audioId}`}
            preload="none"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
        </>
      )}
      <span className="voice-bars" aria-hidden="true">
        {bars.map((height, i) => (
          <i key={i} style={{ height }} />
        ))}
      </span>
      <time>{clipLength(meta.durationMs)}</time>
    </span>
  );
}
/**
 * 按住说话：按下开始、抬起发送、上滑 60px 取消。显式 setPointerCapture 让鼠标和触屏
 * 都能在按钮外抬起仍收到 pointerup；不用 pointerleave 判取消，触屏的隐式捕获会让它在抬起时误触发。
 */
function VoiceButton({
  state,
  disabled,
  onStart,
  onStop,
  onCancel,
}: {
  state: VoiceRecorderState;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
}) {
  const origin = useRef<{ x: number; y: number } | null>(null);
  const recording = state === "recording";
  return (
    <button
      type="button"
      className={`composer-voice ${recording ? "is-recording" : ""} ${state === "processing" ? "is-processing" : ""}`}
      disabled={disabled || state === "processing"}
      aria-label={recording ? "松开发送语音" : "按住说话"}
      aria-pressed={recording}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        origin.current = { x: e.clientX, y: e.clientY };
        onStart();
      }}
      onPointerMove={(e) => {
        const from = origin.current;
        if (!from) return;
        if (from.y - e.clientY > 60 || Math.abs(e.clientX - from.x) > 120) {
          origin.current = null;
          onCancel();
        }
      }}
      onPointerUp={() => {
        if (!origin.current) return;
        origin.current = null;
        onStop();
      }}
      onPointerCancel={() => {
        origin.current = null;
        onCancel();
      }}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          (recording ? onStop : onStart)();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MicrophoneIcon size={19} weight={recording ? "fill" : "regular"} />
    </button>
  );
}
/** 上一条消息缺时间戳时沿用最近一条已知时间，保证按天分组稳定。 */
function withDays(messages: UIMessage[]) {
  let lastDay = "";
  return messages.map((message) => {
    const at = messageTime(message);
    const day = at === null ? lastDay : dayKeyFormat.format(new Date(at));
    const startsDay = at !== null && day !== lastDay;
    if (at !== null) lastDay = day;
    return { message, at, startsDay };
  });
}
/**
 * 去掉 Streamdown 默认的 rehype-raw：小莲的回复不需要渲染模型输出的原始 HTML，
 * 保留它反而要背上完整的 parse5 HTML 解析器（约 269 kB 源码）。去掉后 Streamdown
 * 自动改走「把 html 节点当纯文本显示」的分支——既更小，也更安全。
 * 用 defaultRehypePlugins 取差集而不是硬编码，上游新增默认插件时不会被我们丢掉。
 */
const { raw: _rawHtmlPlugin, ...safeRehypePlugins } = defaultRehypePlugins;
const messageRehypePlugins = Object.values(safeRehypePlugins);
const textOf = (message: UIMessage) =>
  message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
/** 消息悬停/长按后的轻操作：复制、换一种说法、改一改重发、存为笔记。不做评分，不做“点赞训练”。 */
function MessageActions({
  message,
  disabled,
  onRegenerate,
  onEdit,
  onSaveNote,
}: {
  message: UIMessage;
  disabled: boolean;
  onRegenerate?: () => void;
  onEdit?: () => void;
  onSaveNote?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = textOf(message);
  if (!text) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时按钮保持原样，不弹错误 */
    }
  }
  return (
    <div className="message-actions" aria-label="消息操作">
      <button type="button" onClick={() => void copy()} aria-label="复制这段话">
        <CopyIcon size={14} />
        <span>{copied ? "已复制" : "复制"}</span>
      </button>
      {onEdit && (
        <button type="button" disabled={disabled} onClick={onEdit} aria-label="改一改再发">
          <PencilSimpleIcon size={14} />
          <span>改一改</span>
        </button>
      )}
      {onRegenerate && (
        <button type="button" disabled={disabled} onClick={onRegenerate} aria-label="换一种说法">
          <ArrowsClockwiseIcon size={14} />
          <span>换一种说法</span>
        </button>
      )}
      {onSaveNote && (
        <button type="button" disabled={disabled} onClick={onSaveNote} aria-label="存为笔记">
          <BookmarkSimpleIcon size={14} />
          <span>存为笔记</span>
        </button>
      )}
    </div>
  );
}
function ProposalCard({
  proposal,
  entries,
  onResolve,
}: Pick<ChatProps, "entries" | "onResolve"> & { proposal: Proposal }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const op = proposal.operation;
  const before = entries.find((e) => op.action !== "create" && e.id === op.entryId);
  const previous = useRef(before);
  if (before && !previous.current) previous.current = before;
  const entry = op.action === "delete" ? previous.current : op.entry;
  async function resolve(approved: boolean) {
    setBusy(true);
    setError("");
    try {
      await onResolve(proposal.id, approved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成，请重试");
    } finally {
      setBusy(false);
    }
  }
  const pending = proposal.status === "pending";
  const stale =
    pending && op.action !== "create" && (!before || before.version !== op.expectedVersion);
  return (
    <article
      className={`chat-tool-card ${pending ? "needs-approval" : ""}`}
      aria-label={`记录确认：${entry?.title || "删除记录"}`}
    >
      <div className="tool-heading">
        <span>
          {op.action === "create"
            ? "你填写的记录"
            : op.action === "update"
              ? "修改记录"
              : "删除记录"}
        </span>
        <span className="status-tag">
          {pending ? "等待你确认" : proposal.status === "approved" ? "已完成" : "已取消"}
        </span>
      </div>
      {op.action === "update" && previous.current && (
        <details className="previous-entry">
          <summary>查看修改前的内容</summary>
          <EntrySummary entry={previous.current} />
        </details>
      )}
      {entry ? (
        <EntrySummary entry={entry} />
      ) : (
        <p className="muted">原记录暂时无法显示，请返回记录列表核对后再操作。</p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {stale && (
        <p role="alert" className="error-text">
          原记录已变化或暂时无法读取，请取消后重新核对。
        </p>
      )}
      {pending ? (
        <>
          <p className="field-hint">
            {op.action === "delete"
              ? "确认后，这条记录将从列表中移除。"
              : "请核对内容，确认后才会写入你的记录。"}
          </p>
          <div className="approval-actions">
            <Button
              size="sm"
              variant={op.action === "delete" ? "destructive" : "default"}
              disabled={busy || !entry || stale}
              onClick={() => void resolve(true)}
            >
              <CheckIcon />
              {busy
                ? "处理中…"
                : op.action === "delete"
                  ? "确认删除"
                  : op.action === "update"
                    ? "确认修改"
                    : "确认保存"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void resolve(false)}>
              <XIcon />
              取消这次操作
            </Button>
          </div>
        </>
      ) : (
        <p className="saved-label">
          {proposal.status === "approved" ? (
            <>
              <CheckCircleIcon />
              {op.action === "delete" ? "记录已删除" : "记录已保存，可在侧栏查看"}
            </>
          ) : (
            "没有更改你的记录"
          )}
        </p>
      )}
    </article>
  );
}
function Proposals(props: Pick<ChatProps, "proposals" | "entries" | "onResolve">) {
  return (
    <>
      {props.proposals
        .slice()
        .reverse()
        .map((proposal) => (
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            entries={props.entries}
            onResolve={props.onResolve}
          />
        ))}
    </>
  );
}
function Evidence({ output }: { output: unknown }) {
  const data = output as {
    ok?: boolean;
    passages?: Array<{
      id: string;
      title: string;
      text: string;
      context: string;
      volName: string;
      corpus: "yinguang" | "daan";
      role: "basis" | "guide";
      url: string;
      paraIndex?: number | null;
    }>;
    error?: { message?: string };
    retrieval?: { unavailableCorpora?: string[] };
  };
  if (data?.ok !== true)
    return (
      <p className="error-text">{data?.error?.message || "检索暂时不可用，未获得可核对的资料。"}</p>
    );
  if (!Array.isArray(data.passages) || !data.passages.length)
    return <p className="muted">没有检索到足够的依据，请尝试更具体的问题。</p>;
  return (
    <div className="evidence-list">
      {data.passages.map((e) => (
        <details key={e.id} className="evidence-card">
          <summary>
            <BookOpenIcon size={17} />
            <div>
              <strong>{e.title || "来源资料"}</strong>
              <span>
                {e.corpus === "yinguang" ? "印光法师" : "大安法师"} ·{" "}
                {e.role === "guide" ? "解释与实践" : "原文依据"}
              </span>
            </div>
          </summary>
          <div>
            <p className="citation-locator">
              {e.volName}
              {e.paraIndex != null ? ` · 第 ${e.paraIndex + 1} 段` : ""}
            </p>
            <blockquote>{e.text}</blockquote>
            {e.context && e.context !== e.text && (
              <details>
                <summary className="field-hint">阅读上下文</summary>
                <blockquote>{e.context}</blockquote>
              </details>
            )}
            {e.url && e.url.startsWith("https://") && (
              <a href={e.url} target="_blank" rel="noopener noreferrer">
                核对原文
                <ArrowSquareOutIcon size={14} />
              </a>
            )}
          </div>
        </details>
      ))}
      {Boolean(data.retrieval?.unavailableCorpora?.length) && (
        <p className="field-hint">部分文库尚未可用，本次只展示已取得的资料。</p>
      )}
      <p className="field-hint">原文证据与小莲的生活化解释分开阅读。</p>
    </div>
  );
}
function EntryResults({ output }: { output: unknown }) {
  const entries = Array.isArray(output) ? output : (output as { entries?: unknown[] })?.entries;
  return (
    <div>
      {entries?.length ? (
        entries.map((entry, i) => {
          const value = entry as Entry;
          const p = entryInputSchema.safeParse({
            kind: value.kind,
            title: value.title,
            content: value.content,
            date: value.date,
            extra: value.extra,
          });
          return p.success ? (
            <div key={i} className="tool-entry">
              <EntrySummary entry={p.data} />
            </div>
          ) : null;
        })
      ) : (
        <p>还没有符合条件的记录。</p>
      )}
    </div>
  );
}
function ToolCard({
  part,
  entries,
  onApproval,
}: {
  part: UIMessage["parts"][number];
  entries: Entry[];
  onApproval: (id: string, approved: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const previous = useRef<Entry | undefined>(undefined);
  if (!isToolUIPart(part)) return null;
  const name = getToolName(part);
  const output = ("output" in part ? part.output : null) as { ok?: boolean; error?: string } | null;
  const failed = part.state === "output-available" && output?.ok === false;
  const saved = part.state === "output-available" && output?.ok === true;
  const input = (part.input || {}) as Record<string, unknown>;
  const before = entries.find((e) => e.id === input.entryId);
  if (before && !previous.current) previous.current = before;
  const parsed = entryInputSchema.safeParse(
    toolKinds[name] ? { ...input, kind: toolKinds[name] } : input.entry || input,
  );
  const pending = part.state === "approval-requested";
  const denied =
    part.state === "output-denied" || ("approval" in part && part.approval?.approved === false);
  const reviewable =
    name !== "deleteEntry" || Boolean(previous.current) || typeof input.entryTitle === "string";
  async function resolve(approved: boolean) {
    if (!("approval" in part) || !part.approval?.id) return;
    setBusy(true);
    setError("");
    try {
      await onApproval(part.approval.id, approved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成，请重试");
    } finally {
      setBusy(false);
    }
  }
  if (name === "searchDharma" && part.state === "output-available")
    return <Evidence output={part.output} />;
  return (
    <div className={`chat-tool-card ${pending ? "needs-approval" : ""}`}>
      <div className="tool-heading">
        <span>{names[name] || "处理记录"}</span>
        <span className="status-tag">
          {pending
            ? "等待你确认"
            : denied
              ? "已取消"
              : failed || part.state === "output-error"
                ? "未完成"
                : part.state === "output-available"
                  ? "已完成"
                  : "处理中"}
        </span>
      </div>
      {name === "updateEntry" && previous.current && (
        <details className="previous-entry">
          <summary>查看修改前的内容</summary>
          <EntrySummary entry={previous.current} />
        </details>
      )}
      {parsed.success ? (
        <EntrySummary entry={parsed.data} />
      ) : name === "deleteEntry" ? (
        previous.current ? (
          <EntrySummary entry={previous.current} />
        ) : (
          <p className="muted">
            {typeof input.entryTitle === "string"
              ? `删除「${input.entryTitle}」`
              : "原记录暂时无法显示，请从记录列表核对后再删除。"}
          </p>
        )
      ) : part.state === "output-available" && name === "listEntries" ? (
        <EntryResults output={part.output} />
      ) : null}
      {failed && (
        <p className="error-text">
          {typeof output?.error === "string" ? output.error : "操作未完成，记录尚未保存。"}
        </p>
      )}
      {part.state === "output-error" && <p className="error-text">{part.errorText}</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {pending && (
        <>
          <p className="field-hint">
            {name === "deleteEntry"
              ? "确认后，这条记录将从列表中移除。"
              : "请核对内容，确认后才会保存。"}
          </p>
          <div className="approval-actions">
            <Button
              size="sm"
              disabled={busy || !reviewable}
              variant={name === "deleteEntry" ? "destructive" : "default"}
              onClick={() => void resolve(true)}
            >
              <CheckIcon />
              {busy
                ? "处理中…"
                : name === "deleteEntry"
                  ? "确认删除"
                  : name === "updateEntry"
                    ? "确认修改"
                    : "确认保存"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void resolve(false)}>
              <XIcon />
              取消
            </Button>
          </div>
        </>
      )}
      {saved && !["listEntries", "searchDharma"].includes(name) && (
        <p className="saved-label">
          <CheckCircleIcon />
          操作已完成
        </p>
      )}
    </div>
  );
}

function OfflineChat(props: ChatProps) {
  const draftStore = useDraft(props.session?.user?.accountId || "guest");
  const [draft, setDraftState] = useState(props.initialPrompt || draftStore.initial);
  const setDraft = (text: string) => {
    setDraftState(text);
    draftStore.save(text);
  };
  const [notice, setNotice] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const active = props.proposals.length > 0;
  useEffect(() => {
    if (props.initialPrompt) {
      setDraftState(props.initialPrompt);
      draftStore.save(props.initialPrompt);
      input.current?.focus();
      props.onPromptConsumed();
    }
  }, [props.initialPrompt, props.onPromptConsumed, draftStore]);
  const pendingCount = props.proposals.filter((p) => p.status === "pending").length;
  useEffect(() => {
    if (active)
      viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" });
  }, [active, pendingCount]);
  function select(text: string) {
    setDraft(text);
    setNotice(false);
    input.current?.focus();
  }
  return (
    <div className={`chat-thread ${active ? "has-messages" : "is-empty"}`}>
      <TodayStrip entries={props.entries} canWrite={Boolean(props.session?.capabilities.write)} onEdit={props.onEdit} />
      <div className="chat-viewport" ref={viewport}>
        {active ? (
          <div className="conversation-column">
            <Proposals {...props} />
          </div>
        ) : (
          <Welcome session={props.session} />
        )}
      </div>
      <div className="chat-input-wrap">
        <form
          className="agent-composer"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) setNotice(true);
          }}
        >
          <textarea
            ref={input}
            aria-label="发送给小莲"
            placeholder="说说你的想法，或让小莲帮你做点什么…"
            rows={3}
            maxLength={20000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (draft.trim()) setNotice(true);
              }
            }}
          />
          <div className="agent-composer-toolbar">
            <RecordMenu onCreate={props.onCreate} content={draft} />
            <span className="composer-mode">
              <LotusMark size={15} />
              小莲伴修
            </span>
            <button className="agent-send" aria-label="发送消息" disabled={!draft.trim()}>
              <ArrowUpIcon size={20} />
            </button>
          </div>
        </form>
        {notice && (
          <div className="chat-connection-notice" role="status">
            <WifiSlashIcon size={18} />
            <div>
              <strong>
                {props.session?.authenticated ? "语言模型尚未连接" : "登录后，就能开始对话"}
              </strong>
              <p>
                {props.session?.authenticated
                  ? "这段话还没有发出。你可以继续编辑，或先把它记下来。"
                  : "输入内容会暂时保留在这里。"}
              </p>
              <button
                onClick={() =>
                  props.session?.authenticated ? props.onCreate("note", draft) : props.onLogin()
                }
              >
                {props.session?.authenticated ? "将这段话填写为笔记" : "登录佛悦账号"}
              </button>
            </div>
            <button aria-label="关闭连接提示" onClick={() => setNotice(false)}>
              <XIcon size={16} />
            </button>
          </div>
        )}
        {!active && <Suggestions onSelect={select} />}
        <Footnote />
      </div>
      {!active && <div className="chat-bottom-note">日常有安放，念念有归处。</div>}
    </div>
  );
}
function ConnectedChat(props: ChatProps) {
  const [online, setOnline] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const agent = useAgent({
    agent: "LotusAgent",
    basePath: "api/agent",
    onOpen: () => {
      setOnline(true);
      setDisconnected(false);
    },
    onClose: () => {
      setOnline(false);
      setDisconnected(true);
    },
  });
  const {
    messages,
    sendMessage,
    regenerate,
    status,
    stop,
    addToolApprovalResponse,
    clearHistory,
    error,
  } = useAgentChat({
    agent,
    experimental_throttle: 100,
    onFinish: props.onRefresh,
  });
  const running = status === "streaming" || status === "submitted";
  const waitingForApproval = messages.some((message) =>
    message.parts.some((part) => isToolUIPart(part) && part.state === "approval-requested"),
  );
  const active = messages.length > 0 || props.proposals.length > 0;
  const composer = useRef<HTMLDivElement>(null);
  const draftStore = useDraft(props.session?.user?.accountId || "guest");
  const canSend = online && !waitingForApproval;
  const canSendRef = useRef(canSend);
  canSendRef.current = canSend;
  const editingRef = useRef<string | null>(null);
  const runtime = useExternalStoreRuntime<UIMessage>({
    messages,
    isRunning: running,
    convertMessage: (m): ThreadMessageLike => ({
      id: m.id,
      role: m.role,
      content: m.parts
        .filter((p) => p.type === "text")
        .map((p) => ({ type: "text" as const, text: p.text })),
    }),
    onNew: async (m) => {
      const text = m.content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      if (!text.trim()) return;
      // 断线或有待确认卡时，Enter 也不能把话发出去；把草稿放回输入框，而不是悄悄吞掉。
      if (!canSendRef.current) {
        runtime.thread.composer.setText(text);
        return;
      }
      draftStore.clear();
      const messageId = editingRef.current ?? undefined;
      setEditing(null);
      await sendMessage({ text, metadata: { createdAt: Date.now() }, ...(messageId ? { messageId } : {}) });
    },
    onCancel: async () => {
      await stop();
    },
  });
  const focusComposer = useCallback(() => {
    composer.current?.querySelector("textarea")?.focus();
  }, []);
  // 语音条：录完转写 → 走同一个 sendMessage；模型只看到文字，音频引用只挂在 metadata 里供回放。
  const voiceReady = Boolean(props.session?.capabilities.voice);
  const [voiceError, setVoiceError] = useState("");
  const voice = useVoiceRecorder(
    async (clip) => {
      setVoiceError("");
      const result = await transcribeVoice(clip.wav);
      if (!result.text) {
        setVoiceError("没听清，再说一次试试。");
        return;
      }
      if (!canSendRef.current) {
        runtime.thread.composer.setText(result.text);
        setVoiceError("现在还不能发送，已把这段话放进输入框。");
        return;
      }
      draftStore.clear();
      await sendMessage({
        text: result.text,
        metadata: { createdAt: Date.now(), voice: { audioId: result.audioId, durationMs: result.durationMs } },
      });
    },
    setVoiceError,
  );
  function select(text: string) {
    runtime.thread.composer.setText(text);
    focusComposer();
  }
  // 首次挂载：起手句优先，其次恢复上次未发出的草稿。
  const restored = useRef(false);
  useEffect(() => {
    if (props.initialPrompt) {
      runtime.thread.composer.setText(props.initialPrompt);
      focusComposer();
      props.onPromptConsumed();
      restored.current = true;
      return;
    }
    if (!restored.current) {
      restored.current = true;
      if (draftStore.initial) runtime.thread.composer.setText(draftStore.initial);
    }
  }, [props.initialPrompt, props.onPromptConsumed, runtime, focusComposer, draftStore.initial]);
  async function approve(id: string, approved: boolean) {
    await addToolApprovalResponse({ id, approved });
    props.onRefresh();
  }
  const timeline = useMemo(() => withDays(messages), [messages]);
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const canRetry = Boolean(error) && online && !running && messages.some((m) => m.role === "user");
  const lastUserId = [...messages].reverse().find((m) => m.role === "user")?.id;
  const [editing, setEditing] = useState<string | null>(null);
  editingRef.current = editing;
  const busy = running || waitingForApproval || !online;
  /** 换一种说法：只允许对最后一条回复，且该回复不含工具调用（否则会跳过已确认的写入语义）。 */
  const canRegenerate = (m: UIMessage) =>
    m.id === lastAssistantId && !m.parts.some((p) => isToolUIPart(p));
  function startEdit(m: UIMessage) {
    setEditing(m.id);
    runtime.thread.composer.setText(textOf(m));
    focusComposer();
  }
  function cancelEdit() {
    setEditing(null);
    runtime.thread.composer.setText("");
  }
  let conversation: ReactNode = <Welcome session={props.session} />;
  if (active)
    conversation = (
      <div className="conversation-column">
        {timeline.map(({ message, at, startsDay }) => {
          const streamingThis = running && message.role === "assistant" && message.id === lastAssistantId;
          return (
            <div key={message.id} className="chat-message-group">
              {startsDay && at !== null && <DayDivider at={at} />}
              <div className={`chat-message message-${message.role}`}>
                <span className="message-author">
                  {message.role === "user" ? (
                    "我"
                  ) : (
                    <>
                      <LotusMark size={20} />
                      小莲
                    </>
                  )}
                  <MessageStamp at={at} />
                  {editing === message.id && <em className="message-editing">正在改这一条</em>}
                </span>
                {message.role === "user" && voiceMeta(message) && <VoiceClip meta={voiceMeta(message)!} />}
                {message.parts.map((part, i) =>
                  isToolUIPart(part) ? (
                    <ToolCard key={i} part={part} entries={props.entries} onApproval={approve} />
                  ) : part.type === "text" ? (
                    <div className="message-text" key={i}>
                      <Streamdown
                        isAnimating={streamingThis}
                        caret={streamingThis ? "block" : undefined}
                        rehypePlugins={messageRehypePlugins}
                        controls={{ code: { copy: true, download: false }, table: { copy: true, download: false, fullscreen: false }, mermaid: false, image: false }}
                        linkSafety={{ enabled: false }}
                        translations={{ copyCode: "复制代码", copied: "已复制", copyTable: "复制表格" }}
                      >
                        {part.text}
                      </Streamdown>
                    </div>
                  ) : null,
                )}
                {!streamingThis && (
                  <MessageActions
                    message={message}
                    disabled={busy}
                    onEdit={message.role === "user" && message.id === lastUserId ? () => startEdit(message) : undefined}
                    onRegenerate={message.role === "assistant" && canRegenerate(message) ? () => void regenerate() : undefined}
                    onSaveNote={message.role === "assistant" ? () => props.onCreate("note", textOf(message), "小莲说") : undefined}
                  />
                )}
              </div>
            </div>
          );
        })}
        <Proposals {...props} />
        {running && (
          <div className="thinking" aria-live="polite">
            <i />
            <i />
            <i />
            <span>小莲正在整理…</span>
          </div>
        )}
      </div>
    );
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className={`chat-thread ${active ? "has-messages" : "is-empty"}`}>
        {messages.length > 0 && (
          <div className="chat-thread-actions">
            <button
              type="button"
              className="text-link"
              disabled={running}
              onClick={() => setConfirmClear(true)}
            >
              <ChatTeardropTextIcon size={15} />
              开始新的对话
            </button>
          </div>
        )}
        <TodayStrip entries={props.entries} canWrite={Boolean(props.session?.capabilities.write)} onEdit={props.onEdit} />
        <ThreadPrimitive.Viewport className="chat-viewport">
          {conversation}
          <ThreadPrimitive.ScrollToBottom className="scroll-to-latest" aria-label="回到最新消息">
            <ArrowDownIcon size={17} />
          </ThreadPrimitive.ScrollToBottom>
        </ThreadPrimitive.Viewport>
        <div className="chat-input-wrap" ref={composer}>
          {error && (
            <p role="alert" className="error-text chat-error">
              <span>{error.message || "连接暂时中断，请稍后重试。"}</span>
              {canRetry && (
                <button type="button" className="text-link" onClick={() => void regenerate()}>
                  <ArrowsClockwiseIcon size={14} />
                  重试回复
                </button>
              )}
            </p>
          )}
          {editing && (
            <p className="chat-reconnecting chat-editing-bar" role="status">
              改好后发送，小莲会从这一条重新回复；之后的对话会被替换。
              <button type="button" className="text-link" onClick={cancelEdit}>
                不改了
              </button>
            </p>
          )}
          {waitingForApproval && !running && (
            <p className="chat-reconnecting" role="status">
              上方有待确认的记录，确认或取消后就能继续聊。
            </p>
          )}
          {!online && (
            <p className="chat-reconnecting" role="status">
              {disconnected ? "连接已断开，请重新连接后重试。" : "正在连接小莲…"}
              {disconnected && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => {
                    props.onRefresh();
                    agent.reconnect();
                  }}
                >
                  重新连接
                </button>
              )}
            </p>
          )}
          {voice.state !== "idle" && (
            <p className={`voice-status ${voice.state === "processing" ? "is-processing" : ""}`} role="status" aria-live="polite">
              <i />
              {voice.state === "recording"
                ? `正在听… ${Math.floor(voice.elapsedMs / 1000)} 秒 · 松开发送，上滑取消`
                : "正在把这段话转成文字…"}
              {voice.state === "recording" && (
                <button type="button" className="text-link" onClick={voice.cancel}>
                  取消
                </button>
              )}
            </p>
          )}
          {voiceError && (
            <p role="alert" className="error-text chat-error">
              <span>{voiceError}</span>
              <button type="button" className="text-link" onClick={() => setVoiceError("")}>
                知道了
              </button>
            </p>
          )}
          <ComposerPrimitive.Root className="agent-composer">
            <ComposerPrimitive.Input
              aria-label="发送给小莲"
              placeholder="说说你的想法，或让小莲帮你做点什么…"
              minRows={active ? 2 : 3}
              maxRows={6}
              maxLength={20000}
              unstable_insertNewlineOnTouchEnter
              onChange={(e) => draftStore.save(e.target.value)}
            />
            <div className="agent-composer-toolbar">
              <RecordMenu onCreate={props.onCreate} />
              {voiceReady && (
                <VoiceButton
                  state={voice.state}
                  disabled={!canSend || running}
                  onStart={() => void voice.start()}
                  onStop={voice.stop}
                  onCancel={voice.cancel}
                />
              )}
              <span className="composer-mode">
                <LotusMark size={15} />
                小莲伴修
              </span>
              <span className="composer-hint" aria-hidden="true">
                Enter 发送 · Shift+Enter 换行
              </span>
              {running ? (
                <ComposerPrimitive.Cancel className="agent-send" aria-label="停止回复">
                  <StopIcon size={18} />
                </ComposerPrimitive.Cancel>
              ) : (
                <ComposerPrimitive.Send
                  className="agent-send"
                  disabled={!canSend}
                  aria-label="发送消息"
                >
                  <ArrowUpIcon size={20} />
                </ComposerPrimitive.Send>
              )}
            </div>
          </ComposerPrimitive.Root>
          {!active && <Suggestions onSelect={select} />}
          <Footnote />
        </div>
        {!active && <div className="chat-bottom-note">日常有安放，念念有归处。</div>}
      </ThreadPrimitive.Root>
      <Dialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="开始新的对话？"
        description="这段对话会从小莲这里清空，已确认保存的记录不受影响。"
      >
        <div className="dialog-footer">
          <Button variant="ghost" onClick={() => setConfirmClear(false)}>
            先不用
          </Button>
          <Button
            onClick={() => {
              clearHistory();
              draftStore.clear();
              setConfirmClear(false);
              props.onRefresh();
            }}
          >
            <CheckIcon size={17} />
            清空并开始
          </Button>
        </div>
      </Dialog>
    </AssistantRuntimeProvider>
  );
}
export default function Chat(props: ChatProps) {
  return props.session?.capabilities.chat ? (
    <ConnectedChat {...props} />
  ) : (
    <OfflineChat {...props} />
  );
}
