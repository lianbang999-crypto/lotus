import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import * as Navigation from "@radix-ui/react-dialog";
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
  ListIcon,
  XIcon,
  CheckCircleIcon,
  WarningCircleIcon,
  TrayIcon,
  ArrowClockwiseIcon,
} from "@phosphor-icons/react";
import type { Entry, EntryKind, Proposal, ProposalInput, SessionInfo } from "./shared/contracts";
import { api } from "./lib/utils";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { LotusMark } from "./components/LotusMark";
import { EntryDialog, ApprovalDialog, type EditorState } from "./components/EntryDialog";
import { LoginDialog } from "./components/LoginDialog";
import { Dashboard } from "./pages/Dashboard";
import { RecordsPage } from "./pages/RecordsPage";
const Chat = lazy(() => import("./components/chat/Chat"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const nav = [
  { id: "chat", label: "和小莲聊聊", icon: ChatCircleDotsIcon },
  { id: "today", label: "今日概览", icon: HouseSimpleIcon },
  { id: "practice", label: "每日功课", icon: FlowerLotusIcon },
  { id: "journal", label: "我的记录", icon: NotebookIcon },
  { id: "merit", label: "功过省察", icon: HeartIcon },
  { id: "ledger", label: "生活账本", icon: WalletIcon },
  { id: "calendar", label: "我的日历", icon: CalendarBlankIcon },
];
const validPages = [...nav.map((n) => n.id), "sources"];
function currentPage() {
  const hash = location.hash.slice(1);
  return validPages.includes(hash) ? hash : "chat";
}
export default function App() {
  const [page, setPage] = useState(currentPage);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [approval, setApproval] = useState<Proposal | null>(null);
  const [login, setLogin] = useState(false);
  const [settings, setSettings] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [prompt, setPrompt] = useState("");
  const loadSequence = useRef(0);
  const accountRef = useRef<string | null>(null);
  const [chatProposalIds, setChatProposalIds] = useState<string[]>([]);
  const clearPersonalUI = useCallback(() => {
    setEditor(null);
    setApproval(null);
    setPendingOpen(false);
    setPrompt("");
    setChatProposalIds([]);
  }, []);
  const reload = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setError("");
    try {
      const s = await api<SessionInfo>("/api/session");
      if (sequence !== loadSequence.current) return;
      if (accountRef.current !== (s.user?.accountId || null)) {
        clearPersonalUI();
        setEntries([]);
        setProposals([]);
        accountRef.current = s.user?.accountId || null;
      }
      setSession(s);
      if (s.capabilities.entries) {
        const [e, p] = await Promise.all([
          api<{ entries: Entry[] }>("/api/entries"),
          api<{ proposals: Proposal[] }>("/api/proposals"),
        ]);
        if (sequence !== loadSequence.current) return;
        setEntries(e.entries);
        setProposals(p.proposals);
      } else {
        setEntries([]);
        setProposals([]);
      }
    } catch (e) {
      if (sequence === loadSequence.current) {
        setError(e instanceof Error ? e.message : "连接暂时中断");
        setSession(null);
        setEntries([]);
        setProposals([]);
        clearPersonalUI();
        accountRef.current = null;
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [clearPersonalUI]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    const change = () => {
      setPage(currentPage());
      setMobileOpen(false);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const focus = () => void reload();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [reload]);
  function navigate(next: string) {
    location.hash = next;
    setPage(next);
    setMobileOpen(false);
  }
  function create(kind: EntryKind, content?: string, title?: string) {
    if (!session?.capabilities.write) {
      setLogin(true);
      return;
    }
    setEditor({ kind, content, title });
  }
  const edit = useCallback((entry: Entry) => setEditor({ kind: entry.kind, entry }), []);
  async function propose(operation: ProposalInput) {
    const { proposal } = await api<{ proposal: Proposal }>("/api/proposals", operation);
    setProposals((p) => [proposal, ...p.filter((v) => v.id !== proposal.id)]);
    if (page === "chat") {
      setChatProposalIds((ids) => [...ids, proposal.id]);
    } else {
      setApproval(proposal);
    }
  }
  async function remove(entry: Entry) {
    try {
      await propose({ action: "delete", entryId: entry.id, expectedVersion: entry.version });
    } catch (e) {
      setToast(e instanceof Error ? e.message : "暂时无法删除");
    }
  }
  async function resolve(id: string, approved: boolean) {
    if (page === "chat") setChatProposalIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    await api(`/api/proposals/${encodeURIComponent(id)}/${approved ? "approve" : "reject"}`, {});
    await reload();
    setToast(approved ? "已确认，记录已更新。" : "已取消，没有更改你的记录。");
  }
  function chat(text: string) {
    setPrompt(text);
    navigate("chat");
  }
  const pending = proposals.filter((p) => p.status === "pending");
  const canWrite = session?.capabilities.write || false;
  return (
    <Navigation.Root open={mobileOpen} onOpenChange={setMobileOpen}>
      <div className={`app-shell ${page === "chat" ? "is-chat-page" : ""}`}>
        <a
          className="skip-link"
          href="#main-content"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById("main-content")?.focus();
          }}
        >
          跳到主要内容
        </a>
        <Navigation.Portal>
          <Navigation.Overlay className="navigation-overlay" />
          <Navigation.Content className="sidebar navigation-drawer" aria-describedby={undefined}>
            <Navigation.Title className="sr-only">我的空间</Navigation.Title>
            <Navigation.Close className="icon-link navigation-close" aria-label="关闭我的空间">
              <XIcon size={20} />
            </Navigation.Close>
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
            <div className="sidebar-bottom">
              <button
                className={`nav-item ${page === "sources" ? "active" : ""}`}
                onClick={() => navigate("sources")}
              >
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
                <button
                  className="account-button"
                  onClick={() => {
                    setMobileOpen(false);
                    if (session?.mode !== "local" && !session?.authenticated) setLogin(true);
                    else setSettings(true);
                  }}
                >
                  <span className="account-avatar">
                    {session?.mode === "local" ? "莲" : session?.user?.name?.slice(0, 1) || "莲"}
                  </span>
                  <span>
                    <strong>
                      {session?.mode === "local" ? "本地体验" : session?.user?.name || "与你相遇"}
                    </strong>
                    <small>
                      {session?.mode === "local"
                        ? "记录保存在本机"
                        : session?.authenticated
                          ? "我的佛悦账号"
                          : "登录，安放你的日常"}
                    </small>
                  </span>
                </button>
                <button
                  className="icon-link"
                  aria-label="设置"
                  onClick={() => {
                    setMobileOpen(false);
                    setSettings(true);
                  }}
                >
                  <GearSixIcon size={19} />
                </button>
              </div>
            </div>
          </Navigation.Content>
        </Navigation.Portal>
        <div className="main-shell">
          <header className="topbar">
            <div>
              <Navigation.Trigger asChild>
                <button
                  className="workspace-menu icon-link"
                  aria-label="打开我的空间"
                  title="记录与设置"
                >
                  <ListIcon size={23} />
                </button>
              </Navigation.Trigger>
              <a
                className="breadcrumb chat-brand-link"
                href="#chat"
                onClick={() => navigate("chat")}
                aria-label="回到小莲对话"
              >
                <LotusMark size={25} />
                <span>
                  小莲 <span className="brand-english">Lotus</span>
                </span>
              </a>
              {page !== "chat" && (
                <>
                  <span className="breadcrumb-divider">/</span>
                  <span>{nav.find((n) => n.id === page)?.label || "法义文库"}</span>
                </>
              )}
              {page === "chat" && <span className="chat-top-label">净土伴修</span>}
            </div>
            <div className="topbar-actions">
              {pending.length > 0 && (
                <button className="pending-button" onClick={() => setPendingOpen(true)}>
                  <TrayIcon size={16} />
                  <span>{pending.length} 条待确认</span>
                </button>
              )}
              <button className="private-indicator" onClick={() => setSettings(true)}>
                <span />
                {session?.capabilities.chat
                  ? "AI 已配置"
                  : session?.authenticated
                    ? "AI 尚未连接"
                    : "登录后开始"}
              </button>
            </div>
          </header>
          {session?.mode === "local" && (
            <div className="mode-banner">
              <span>本地开发</span>记录保存在本机
              {session.capabilities.chat
                ? "，已配置语言模型。"
                : "，可通过输入框旁的「＋」体验记录与确认。"}
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <WarningCircleIcon size={18} />
              <span>{error}</span>
              <button onClick={() => void reload()}>
                <ArrowClockwiseIcon size={16} />
                重试
              </button>
            </div>
          )}
          <main
            id="main-content"
            tabIndex={-1}
            className={page === "chat" ? "main-content chat-main" : "main-content"}
          >
            {loading ? (
              <div className="loading-page" aria-label="正在打开小莲">
                <div className="skeleton skeleton-heading" />
                <div className="skeleton skeleton-hero" />
                <div className="skeleton skeleton-composer" />
              </div>
            ) : (
              <Suspense
                fallback={
                  <div className="loading-page">
                    <div className="skeleton skeleton-hero" />
                  </div>
                }
              >
                <div className="chat-host" hidden={page !== "chat"}>
                  <Chat
                    key={session?.user?.accountId || "guest"}
                    initialPrompt={prompt}
                    onPromptConsumed={() => setPrompt("")}
                    onRefresh={() => void reload()}
                    session={session}
                    entries={entries}
                    proposals={proposals.filter(
                      (p) => p.status === "pending" || chatProposalIds.includes(p.id),
                    )}
                    onCreate={create}
                    onEdit={edit}
                    onResolve={resolve}
                    onLogin={() => setLogin(true)}
                  />
                </div>
                {page === "today" ? (
                  <Dashboard
                    entries={entries}
                    session={session}
                    onCreate={create}
                    onChat={chat}
                    onNavigate={navigate}
                  />
                ) : page === "chat" ? null : page === "calendar" ? (
                  <CalendarPage
                    entries={entries}
                    canWrite={canWrite}
                    onCreate={() => create("schedule")}
                    onEdit={edit}
                  />
                ) : page === "sources" ? (
                  <Sources
                    connected={session?.capabilities.dharma || false}
                    onChat={() => chat("请检索印光法师文钞中关于摄心念佛的开示，附原文和出处。")}
                    canChat={session?.capabilities.chat || false}
                  />
                ) : (
                  <RecordsPage
                    key={page}
                    page={page}
                    entries={entries}
                    canWrite={canWrite}
                    onCreate={create}
                    onEdit={edit}
                    onDelete={(e) => void remove(e)}
                  />
                )}
              </Suspense>
            )}
          </main>
        </div>
        {editor && (
          <EntryDialog editor={editor} onClose={() => setEditor(null)} onPropose={propose} />
        )}{" "}
        {approval && (
          <ApprovalDialog
            key={approval.id}
            proposal={approval}
            entries={entries}
            onClose={() => setApproval(null)}
            onResolve={resolve}
          />
        )}{" "}
        {login && <LoginDialog onClose={() => setLogin(false)} onSuccess={() => void reload()} />}
        <Dialog
          open={pendingOpen}
          onOpenChange={setPendingOpen}
          title="等待你的确认"
          description="这些操作尚未写入个人记录。你可以逐条核对，或取消。"
        >
          <div className="pending-list">
            {pending.length ? (
              pending.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setPendingOpen(false);
                    setApproval(p);
                  }}
                >
                  <span>
                    {p.operation.action === "delete" ? "删除记录" : p.operation.entry.title}
                    <small>
                      {p.operation.action === "update"
                        ? "修改"
                        : p.operation.action === "create"
                          ? "新增"
                          : "删除"}{" "}
                      · 等待确认
                    </small>
                  </span>
                  <ArrowRightIcon size={18} />
                </button>
              ))
            ) : (
              <p>没有待确认的操作。</p>
            )}
          </div>
        </Dialog>
        <Dialog
          open={settings}
          onOpenChange={setSettings}
          title="我的小莲"
          description="了解当前的连接与记录状态。"
        >
          <dl className="settings-list">
            <div>
              <dt>使用环境</dt>
              <dd>{session?.mode === "local" ? "本机开发环境" : "佛悦账号环境"}</dd>
            </div>
            <div>
              <dt>个人记录</dt>
              <dd>
                {session?.capabilities.entries
                  ? session.mode === "local"
                    ? "保存在这台设备"
                    : "保存在你的账号中"
                  : "登录后可用"}
              </dd>
            </div>
            <div>
              <dt>语言模型</dt>
              <dd>{session?.capabilities.chat ? "已配置" : "尚未连接"}</dd>
            </div>
            <div>
              <dt>法义检索</dt>
              <dd>{session?.capabilities.dharma ? "已配置，待实际检索核验" : "尚未连接"}</dd>
            </div>
            <div>
              <dt>日程提醒</dt>
              <dd>应用内查看</dd>
            </div>
          </dl>
          <p className="field-hint">
            {session?.mode === "local"
              ? "本地记录不会自动同步到正式账号；请勿把这里作为长期个人资料库。"
              : "账号与检索复用佛悦服务。每一次记录、修改和删除，均由你确认。"}
          </p>
        </Dialog>
        {toast && (
          <div className="toast" role="status">
            <CheckCircleIcon size={19} />
            {toast}
            <button aria-label="关闭提示" onClick={() => setToast("")}>
              <XIcon size={16} />
            </button>
          </div>
        )}
      </div>
    </Navigation.Root>
  );
}
function Sources({
  connected,
  canChat,
  onChat,
}: {
  connected: boolean;
  canChat: boolean;
  onChat: () => void;
}) {
  return (
    <div className="sources-page page-enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow">LOTUS / 有据可依</div>
          <h1>法义文库</h1>
          <p>循着原文理解，让每一份开解都有出处。</p>
        </div>
      </div>
      <section className="source-intro">
        <LotusMark size={70} />
        <div>
          <h2>原文、解释，各有安放</h2>
          <p>小莲先查找资料，再依据原文作答。引用会附上篇名与位置，方便你回到上下文核对。</p>
        </div>
      </section>
      <div className="source-book">
        <span className="source-number">01</span>
        <div>
          <span className="eyebrow">主要依据</span>
          <h2>印光法师文钞</h2>
          <p>涉及净土法义，以文钞原文为主要依据。</p>
        </div>
        <BookOpenIcon size={35} weight="light" />
      </div>
      <div className="source-book">
        <span className="source-number">02</span>
        <div>
          <span className="eyebrow">解释与实践通路 · 接入准备中</span>
          <h2>大安法师文库</h2>
          <p>通过同一套文库索引接入。未完成索引核验前，不把资料展示为已检索的证据。</p>
        </div>
        <BookOpenIcon size={35} weight="light" />
      </div>
      <div className="source-status">
        <span className="status-tag">{connected ? "检索服务已配置" : "检索服务尚未连接"}</span>
        <p>检索不足时，小莲会说明资料不足，不补造原文或祖师观点。</p>
        <Button disabled={!canChat || !connected} onClick={onChat}>
          从一个问题开始
          <ArrowRightIcon size={17} />
        </Button>
      </div>
    </div>
  );
}
