# 聊天主界面与浏览器验收

2026-09-13，按「聊天 Agent 是主要界面」调整 Lotus。默认进入对话，今日概览、功课、记录、功过省察、账本、日历最初作为侧栏辅助页面；2026-09-14 已收进「我的空间」抽屉。当前一个账号对应一段持续会话，多主题会话列表尚未实现。

## 实际界面

- 空会话以欢迎文案、输入框和四个起手句为中心；起手句填入草稿，由用户发送。
- 有会话时消息区域滚动，输入框保持在底部。停止回复、回到最新消息与工具确认由 assistant-ui / Cloudflare 聊天运行时衔接。
- 修改、删除展示内容与确认动作。手动填写入口放在输入框旁「＋」，填写完成后进入对话中的确认卡。
- 尚未配置模型时显示完整聊天外观与明确连接状态。尝试发送会说明内容没有发出，可继续编辑或填写为笔记，没有模拟 AI 回复。
- 切换侧栏页面保留未发送草稿和已挂载会话；刷新恢复服务端聊天和未处理的人工提案。输入草稿不会跨浏览器刷新持久化。
- 每次账号变化清空旧账号的编辑/确认状态并重建聊天实例。人工提案的成功提示会留在当前对话中；已处理的人工卡片不作为永久聊天历史。

## 浏览器证据

使用隔离 Playwright 浏览器操作真正的 Vite / Cloudflare Worker，桌面 1280×800，手机 390×844。

日常本地环境 `127.0.0.1:5173`：

1. 默认聊天首页、起手句填入、未连接时诚实提示、输入框「＋」菜单。
2. 功课填写后业务记录仍为空；刷新后待确认卡恢复；批准只新增一条记录。
3. 修改取消保留原数量；确认修改正确更新；删除卡展示实际标题，确认后移除。
4. 热力图真实生成 SVG，日历真实渲染；不是占位图片。
5. 12.34 元保存为 1234 分；北京时间 2026-09-13 20:00 保存为 12:00 UTC；日程事件可点击并确认完成状态。
6. 刷新恢复的人工确认卡处理成功后仍显示完成结果。
7. 桌面与手机切换页面保留输入草稿，手机侧栏可打开与关闭，聊天页面没有水平溢出。

独立聊天环境 `127.0.0.1:5181` 使用 `.wrangler/chat-ui-test` 独立数据与本机 SSE 测试 provider：

1. 浏览器 `useAgentChat` 发消息，经真正 WebSocket 返回语义工具确认卡。
2. 未确认前数据库零写入；刷新恢复原生审批状态。
3. 在手机上点击确认后只保存一条功课，SDK 自动续答并展示工具执行完成。
4. 拒绝另一条记录不产生业务写入，界面展示已取消。
5. 浏览器未出现未捕获的应用异常；该环境只证明连接与 UI/工具协议，不证明真实模型的理解能力。

本次生成的普通本地测试记录已逐条通过提案确认删除；隔离测试环境数据单独保存。截图和临时操作脚本位于 `output/playwright/`，已排除出 Git。

## 重现原生聊天界面

需要两个终端，两个端口均仅监听本机：

```bash
node tests/backend/chat-preview-provider.mjs
```

```bash
WRANGLER_LOG_PATH=/tmp/lotus-chat-ui-wrangler.log npx vite --config tests/backend/chat-ui-vite.config.ts --host 127.0.0.1 --port 5181 --strictPort
```

在 5181 打开页面并输入「帮我记录今天念佛 108 声」。该 provider 是明确的测试夹具，按固定规则生成卡片；真实模型已配置于正常本地环境；生产 SSO、线上检索与大安索引仍待联调。真实 Worker 协议测试细节见 [协议验收](chat-protocol-validation.md)。

## 最终检查结果

当前 `npm run check`、`npm run lint`、86 项后端及客户端解析测试、13 项检索集成测试以及生产构建均通过。构建仍提示聊天分包约 892 kB（gzip 261 kB），属于后续性能优化项。测试 provider 与隔离 Worker 在验收后停止，正常本地预览保留运行。真实模型接入状态见 [模型接入](model-integration.md)。

## 2026-09-14 单一聊天界面验收

- 首页移除常驻功能侧栏，记录与设置进入 Radix 抽屉；Esc关闭、焦点返回、手机端打开设置和草稿保留均经浏览器检查。
- 1280×800 与390×844 的首页、输入框和起手句已截图核对，无水平溢出；起手句只填入草稿。
- 新增 `tests/browser/chat-flow.js`：纯工具回复先无写入，刷新后确认保存；另一条取消不写入；第三条直接确认。刷新后两张完成卡和一张取消卡全部存在，且无可见错误。
- 待确认时保持草稿可编辑并禁用新消息发送，避免跨过未完成工具操作。
- 截图：`output/playwright/lotus-single-chat-desktop.png`、`lotus-single-chat-mobile.png`、`lotus-space-drawer.png`。
- GitHub 参考与许可证见 [设计调研](design-references.md)。本次没有复制上游界面代码或引入新的聊天运行时。

正常本地服务的真实 DeepSeek-V3 已完成确认、取消、续答与刷新卡片恢复验收，详见 [模型接入](model-integration.md)。上述测试结论均不代表正式账号、线上检索或部署验收。

## 2026-09-15 聊天体验修复与提升

本轮以「聊天是主界面」为前提，先用真实模型在 1280×900 与 390×844 下走完整对话，再修复看到的问题。全部改动经 `npm run check`、`npm run lint`、88 项单测、生产构建与 `wrangler deploy --dry-run` 通过；浏览器回归脚本在本地 5173 上用真实 DeepSeek 跑完（截图 `/tmp/lotus-v2-*.png`，未入库）。

修复：

- **Markdown 回复退化成纯文本**：Streamdown 依赖 Tailwind 工具类，但 `styles.css` 没有 `@source` 登记其 dist，标题、列表编号、引用竖线、加粗全部丢失（实测 `ol` 为 `list-style: none`，`h2` 与正文同字号）。补 `@source "../node_modules/streamdown/dist/*.js"`，并把 `--color-background/foreground/muted/border/primary` 等语义色映射到小莲配色，避免代码块、表格、外链弹层出现 shadcn 默认的黑白灰。在此基础上用 `[data-streamdown="…"]` 收敛标题字号、列表缩进、引用样式到陪伴式阅读的密度。
- **待确认卡挂起时按 Enter 会吞掉草稿**：原 `onNew` 在 `waitingForApproval` 时直接 `return`，assistant-ui 已清空输入框，用户的话无声消失。现在把文本放回输入框；断线时同理。
- **系统提示只给 UTC 时间**：北京 0–8 点模型会把“今天”算成前一天。改为注入北京日期、星期、时刻并说明日程 `dueAt` 用 `+08:00`；新增 `tests/backend/time.test.ts` 锁定跨日边界。
- **“重试回复”按钮实际是发空消息**：原实现调用 `sendMessage()` 无参数。改为 `regenerate()`，且只在确实有出错的用户消息、已在线、未运行时显示。

提升：

- **消息时间戳与按天分隔**：服务端 `messageMetadata` 在回复 `start` 时写 `createdAt`，用户消息由客户端带 `metadata.createdAt`。界面按北京时间显示 `HH:mm`，跨天插入「今天 / 9月14日 周日」分隔线；刷新后仍在（经 `get-messages` 持久化）。旧消息没有时间戳则不显示，不补造。
- **输入草稿跨刷新保留**：按账号存 `sessionStorage`（`lotus:draft:<accountId>`），发送成功或开始新对话时清除；关闭浏览器即清空，未发出的心事不长期留在设备上。
- **开始新的对话**：对话区右上角入口，二次确认后调用 SDK `clearHistory`（服务端同步清空 `cf_ai_chat_agent_messages`）；已确认保存的记录不受影响，弹窗文案明确说明。
- **流式光标与减少动画**：回复流式进行中在末尾显示方块光标，`isAnimating` 只对最后一条 assistant 消息生效；`prefers-reduced-motion` 沿用全局关闭动画的规则。
- **触屏 Enter 换行**：`unstable_insertNewlineOnTouchEnter` 让手机上 Enter 换行、点按钮发送，桌面保持 Enter 发送；桌面输入框加「Enter 发送 · Shift+Enter 换行」提示，手机隐藏。
- Streamdown 的复制按钮文案改中文；关闭 mermaid/图片控件与外链安全弹窗（法义来源链接已由 Evidence 卡自行核验域名）。

仍未做（属于后续项，不在本轮宣称）：多主题会话列表、Chat 分包 901 kB（gzip 263 kB）的进一步拆分、对话内搜索、语音输入、正式域名 SSO 验收。

## 2026-09-15 下午：单一聊天入口的陪伴感（借鉴人机恋项目）

前提是「这个 Agent 只有一个聊天入口」，所以功课/日程/记忆都得从对话里自然长出来，而不是再开页面。调研了 AIRI、Open-LLM-VTuber、KouriChat、Everthine、EverOtome、Yuralume、Mimir、SillyTavern，以及闭源的 Character.AI / Replika 作对照，结论与取舍见 [陪伴类项目调研](companion-references.md)。落地四项，`tsc`/`oxlint`/98 项单测/生产构建/`wrangler deploy --dry-run` 全过，浏览器回归在本地 5173 用真实 DeepSeek 跑完（截图 `/tmp/lotus-v3-*.png`，未入库）：

- **时段问候与起手句**：欢迎页按北京时段说「夜深了 / 早安 / 午安 / 下午好 / 晚上好」，正式账号有名字时带称呼（本地开发身份不称呼）；四个起手句顺序随时段变化。实测 14:43 显示「下午好」、首个起手句为「说说今天的心情」。
- **今日日程条**：对话入口上方一行，列今天到期未完成的日程（≤3 条，按时间），点开进编辑表单可标记完成，过时的标「已过时间」，可关闭到明天（sessionStorage）。实测点开进入「编辑记录」弹窗，关闭后消失。
- **近况上下文**：服务端把最近 6 条记录 + 今天未完成日程压成两行摘要放进系统提示（只放标题/数量/时间，标题去空白截 40 字，正文不进）。实测用户问「不用查记录，我昨天念了多少」，模型零工具调用直接答「昨天念佛 1080 声。今晚 16:43 有晚课的日程」。系统提示同时要求「像常来往的道友，先接住状态再谈事；简短口语，两三句」。
- **消息级操作**：悬停出现「复制」；用户最后一条有「改一改」（预填回输入框，发送时用 `messageId` 替换并从该处重新回复，之后的对话被替换，有提示条和「不改了」）；最后一条**不含工具调用**的回复有「换一种说法」（`regenerate`，回复数不增加、内容变化）；所有回复有「存为笔记」（标题预填「小莲说」，正文为回复原文，走原有确认流程）。触屏常显淡色，桌面悬停浮现。实测编辑重发后用户消息数不变、刷新后历史一致。

## 2026-09-15 夜：首屏瘦身与流式滚动核查

这轮先量再改。用 `build.sourcemap` 产出 sourcemap，按模块归因 Chat 分包的真实构成（不是猜）：`ai` 534 KB、`@assistant-ui/core` 279 KB、**`parse5` 269 KB**、`zod/v3` 147 KB。

- **去掉 parse5（909 kB → 739 kB，gzip 266 → 214，-19%）**：269 KB 的完整 HTML5 解析器来自 Streamdown 默认启用的 `rehype-raw`，而小莲从不渲染模型输出的原始 HTML。做法两步：① `Chat.tsx` 用 `defaultRehypePlugins` 取差集剔除 `raw`（不硬编码插件列表，上游新增默认插件仍会带上，`sanitize`/`harden` 保留）；② Streamdown 对 rehype-raw 是**顶层静态 import，打包器摇不掉**，故在 `vite.config.ts` 把它 alias 到 `src/lib/rehype-raw-stub.ts`——Streamdown 对该导入的唯一用途是恒等比较，空函数即可满足。实测产物中 `parse5` 出现次数为 0。
- **安全性同时变好，且已验证**：让真实模型原样输出一段含 `<img onerror>`、`<script>`、`<b>` 的内容，结果 DOM 里真实 `img`/`script`/`b` 元素均为 0，HTML 以纯文本显示，`window.__XSS` 未被置位；同一段里的标题、有序列表、加粗、引用、行内代码、链接六项 Markdown 仍全部正常渲染。新增 `tests/backend/markdown-safety.test.ts` 锁住这条边界（共 101 项单测通过）。
- **`zod/v3` 147 KB 不动**：它由 `@ai-sdk/provider-utils` 为兼容 v3/v4 schema 而引入，属 SDK 内部依赖，强行替换会破坏工具参数校验。记录在案，不做。
- **流式滚动：先报的"被拽回底部"是我的测试有问题，不是产品 bug。** 用 `el.scrollTop = 0` 程序化跳转时，恰好落在 `scrollHeight` 变化的帧上，而 assistant-ui 的 `isUserScrollUp` 要求 `scrollHeight` 相等才判定为用户上滚，于是漏判。改用**真实滚轮手势**复现：上滚后停在 0、2.5 秒内持续有新 token 也没有被拽回、「回到最新消息」按钮正常出现、点击后回到底部。结论是当前行为正确，不需要改代码——记在这里是为了防止以后有人照着错误的测法再"修"一遍。
- **懒加载已生效**：冷启动聊天页不请求 Heatmap / CalendarPage / cal-heatmap / schedule-x，无需再拆。

改动后重跑上一轮的全部陪伴功能回归，均通过（时段问候此次为「晚上好」、起手句首位变为「说说今天的心情」「做一次省察」，验证了时段逻辑随时间变化）。`wrangler deploy --dry-run` 通过，产物无 `.dev.vars`、无真实密钥。

## 2026-09-16 语音条（阶段 1）：按住说话、发出去、可回放

按 2026-09-16 计划（三套主题 / 布局 / 语音条 / 实时通话）的阶段 1 落地，**不升级任何依赖**，只加 `ai`（`remote: true`）与 R2 `VOICE_AUDIO` 两个绑定。`tsc` / `oxlint` / 110 项单测（新增 `tests/backend/voice.test.ts` 9 项）/ 生产构建 / `wrangler deploy --dry-run` 全过。

设计要点：客户端 `useVoiceRecorder.ts` 用 `MediaRecorder` 录音后统一解码重采样成 16 kHz 单声道 WAV 再上传（绕开 Chrome webm / iOS mp4 的容器差异）；服务端 `/api/voice/transcribe` 只收标准 44 字节头的 WAV、时长从字节数算、≤ 5 MB / 90 秒，调 Workers AI Whisper（`language: zh`, `vad_filter`），原音按 `voice/<accountId>/` 前缀存 R2；`/api/voice/audio/:id` 只读本账号前缀。**模型只看到转写文字**（`sendMessage` 的 `metadata.voice` 仅供气泡回放），工具、确认卡、系统提示都没动。

真实验证（本地 dev，AI 为远程 Workers AI）：

- 用 macOS `say -v Tingting` 合成 3.83 s 普通话「今天念佛五百声，心里很平静。」。curl 直打路由：转写返回**「今天念佛五百声,心里很平静。」**，一字不差；回放 md5 与上传一致；错误 id 404。本地经远程绑定调用耗时 14 s，**部署后需重新测量**（本机→Cloudflare→AI 的往返不代表线上）。
- 浏览器端到端（`tests/browser/voice-flow.sh`，Playwright 假麦克风）：找到「按住说话」→ `mousedown` 约 5 s → `mouseup` → 状态行「正在把这段话转成文字…」→ 语音气泡（播放键 + 波形 + `0:05`）+ 转写段落 → 小莲回复。点播放后 `<audio>` 播到结尾（`currentTime = duration = 4.98`，无 error）。1280×800 与 390×844 截图核对，气泡在转写上方堆叠、无横向溢出。
- 两处真 bug 由这轮测出并已修：① `fetch` 里 `return handleVoice()` 没有 `await`，`AppError` 绕过 catch 变成 500——改为 `return await`；② 回放的 `Content-Range` 依赖 R2 返回的 range 对象，本地模拟器给的字段是 `undefined`，算出 `NaN-NaN`，且无 Range 也返回 206——改为按请求头自算，三种写法进单测。

测试环境的坑（记下来防止以后再踩）：**macOS 上 Chromium 的音频服务是沙箱化独立进程，读不到 `--use-file-for-fake-audio-capture` 的文件**，录到的是纯静音（RMS 0），换 16 k / 48 k 采样率都没用；加 `--disable-features=AudioServiceOutOfProcess,AudioServiceSandbox` 后才有声。另外每条 `playwright-cli` 命令有约 2 s 启动开销，"按住 2 秒"实际录到约 5 秒，不是时长 bug。

未做 / 未验：真机 iPhone 微信内置浏览器与安卓 Chrome 尚未手测（`MediaRecorder` 在 iOS 出 mp4/aac，已按重采样路径设计但未在真机跑过）；线上延迟未量。

## 2026-09-16 三套主题（阶段 2 · 上半）：苔绿 / 朝霞 / 素纸

**做法**：`styles.css` 原有 415 处硬编码色值（339 个不同 hex）用脚本按 OKLCH 明度与属性上下文归并为 17 个语义 token（`white / bg / surface / surface-2 / muted / border / border-strong / ink-faint / ink-muted / ink-soft / brand / brand-strong / ink / ink-strong / brand-fg / danger / danger-soft`），带透明度的 8 位 hex 转成 `color-mix(in srgb, var(--token) N%, transparent)`。`:root` 定义苔绿（每个桶取明度中位数那个真实存在的色），`[data-theme="dawn"]` / `[data-theme="paper"]` 由 tweakcn 的 *Sunset Horizon* / *Vintage Paper* 预设推导（预设没有的中间档在线性 sRGB 里小幅混色）。shadcn / Streamdown 认的 `--background / --primary / --muted …` 作为别名指向 token，`@theme inline` 让 Tailwind 工具类跟着走。切换入口在「我的小莲」设置弹窗，`localStorage["lotus:theme"]`，`index.html` 首屏前内联脚本设 `data-theme`，刷新不闪。

**归并规则翻过一次车，记下来**：第一版只按明度分桶，把正文深绿（L≈0.45）和品牌绿归成同一个 `brand`。苔绿下看不出来，切到朝霞整段正文变珊瑚色。修正：`color` 属性落在该明度段的默认归 `ink-soft`（正文柔色），只有选择器明显是链接 / 按钮 / 标签 / 导航 / 图标（`ACCENT` 正则）才保留 `brand`。脚本会打印两类选择器清单供核对，本轮核对结果：`ink-soft` 26 个选择器全是正文、标题、表单；`brand` 19 个全是可点元素。

**对比度**（WCAG，文字压在页面底上）：苔绿沿用原值；素纸 `brand` 3.67:1、`ink-muted` 4.53:1；朝霞把珊瑚 `#ff7e5f` 往前景掺 30% 得 `#ee765a`→ `brand` 3.14:1、白字压按钮 3.28:1——只达到大字标准（3:1），够不上正文的 4.5:1。朝霞是"活泼"主题，正文已全部走 `ink-soft`（11.5:1），珊瑚只用在标题、徽标、按钮、播放键这些大块或粗体元素上，这是有意的取舍，记录在此。

**浏览器证据**：三套主题各在 1280×800 与 390×844 截图（`output/playwright/theme/v2-* v3-*`），苔绿与改前（`before-*`）逐张比对无可见差异；朝霞、素纸下语音气泡、输入框、确认按钮、抽屉、设置弹窗全部可读。素纸切换后 `body` 字体实测为 `"Songti SC", "Noto Serif SC", …`。通过设置弹窗点「素纸」→ `data-theme`、`localStorage`、字体三者同步；刷新后保持。`tsc` / `oxlint` / 110 项单测 / 生产构建通过（CSS 82.5 kB，gzip 16.3 kB，与改前持平）。

**未做**：深色模式（预设自带深色值，token 结构已就绪，但苔绿没有现成深色版需要设计，且验证矩阵翻倍，本轮不做）；预设指定的 Montserrat / Libre Baskerville 是 Google 字体，大陆加载不可靠，**未引入 webfont**，素纸用系统宋体栈。

## 2026-09-16 聊天布局（阶段 2 · 下半）：桌面常驻侧栏 + 记录时间线

套的是 prompt-kit `full-chat-app` 区块的骨架（侧栏 + 消息流 + 输入框动作行），**没有安装 shadcn `Sidebar` 或 prompt-kit 组件**——它们的样式是 Tailwind 工具类串，与本项目 3700 行手写 CSS 是两套体系（理由见 README「关于 shadcn/ui」）。做法是把侧栏主体抽成 `src/components/Sidebar.tsx` 的 `SidebarBody`，桌面（≥ 901px）渲染成常驻 `<aside>`，手机沿用 Radix 抽屉，两处共用；`useMediaQuery` 决定挂哪一个，顶栏那颗 ☰ 在桌面是折叠 / 展开（`localStorage["lotus:sidebar"]` 记住），在手机是开抽屉。侧栏展开时聊天页顶栏不再重复显示品牌。

区块里「历史列表」的位置放的是**用户自己的记录**（`RecordsTimeline`）：按今天 / 昨天 / 最近 7 天 / 更早分组，最多 18 条，点一条直接进「编辑记录」弹窗，底部「查看全部记录」进我的记录页。数据就是已有的 `entries`，不需要多会话后端。首页插画与 logo（`LotusMark.tsx`）的 10 处 SVG 内联色改为 token，跟主题走。

浏览器证据（本地 dev，1280×800 / 1280×720 / 390×844）：

- 用真实提案流程造了 4 条记录（今天功课、昨天日记、5 天前账目、20 天前笔记），侧栏正确分到四组；桌面点「供灯」打开编辑弹窗；手机抽屉里点「念佛 500 声」抽屉关闭、编辑弹窗打开。
- 桌面展开：侧栏 245px，聊天列在剩余宽度内重新居中，顶栏只剩 ☰ 与「净土伴修」；折叠后满宽、品牌回到顶栏；刷新后折叠状态保持。三套主题下侧栏与时间线均正常。
- **一次返工**：第一版沿用抽屉的行距，800px 高的屏幕上时间线只露出半行。只对 `.sidebar-static` 收紧（导航行 8px 内边距、隐藏那句诗、缩小上下留白）并给滚动区底部加渐隐提示后，四个分组标题在 800px 下全部可见（412–613px）。手机抽屉保持原来的松弛版式。
- `tsc` / `oxlint` / 110 项单测 / 生产构建 / `wrangler deploy --dry-run` 通过。这 4 条示例记录留在本地 dev 数据里，不影响线上。

## 2026-09-16 依赖升级 + 连接鉴权重构（阶段 3）

**升级**：`agents` 0.17.4 → 0.23.0，`@cloudflare/ai-chat` 0.9.3 → 0.12.0；`ai` 6.0.202 与 `@ai-sdk/react` 3.0.204 不动（ai-chat 0.12 的 peer 允许 `ai ^6||^7`，语音混入不依赖 `ai`）。lockfile 只动 225/387 行，没有全量漂移。**安装的坑**：`agents@0.23` 把 `@modelcontextprotocol/sdk` 钉在精确 1.30.0、还有 `@cloudflare/codemode ≥0.5` 的可选 peer，而旧 `agents` 子树带着 1.29.0 / 0.4.4，增量 `npm install` 无论先装哪个都 ERESOLVE，每次只暴露一层；不清 lockfile（`package.json` 里十来个 `latest` 会全漂）的做法是先 `npm uninstall @cloudflare/ai-chat agents` 卸掉整棵旧子树，再把两个新包一起装。`npm warn EBADENGINE`：本机 Node 22.14 低于 `@babel/code-frame@8` 要求的 22.18，仅告警。

**为什么必须重构鉴权**：0.22 起 `static options.hibernate` 被删、休眠强制，原来 `onConnect` 把凭据塞进内存 Map、`onMessage` 逐帧拿它去 `auth.foyue.org` 验证的做法在升级后第一条消息就被 4401 关掉（浏览器实测「连接已断开」）。而且逐帧 HTTP 对即将到来的语音二进制帧是灾难。

**新模型**（`src/server.ts`）：`onConnect` 验一次 `resolveSession`，通过后 `connection.setState({ accountId, verifiedAt })`（partyserver 的休眠安全附件；**只有账号 id，没有任何可重放凭据**），验不过直接 `close(4401)`；`onMessage` 每帧只读 `connection.state`，缺失即 4401，`assertOwner` 与原生工具审批账本不变；文本帧超过 30 分钟以 **4409** 关闭要求重新握手，客户端 `onClose` 遇 4409 不显示"断开"、由 PartySocket 自动重连并重新验证；语音等二进制帧过状态门禁但不触发 TTL。`chatRecovery = true` 那行删掉走默认（0.11 起每轮都在恢复纤程里）。

**验证**：

- **聊天历史一次性迁移**：本地 DO 里有升级前的真实历史（两轮文字 + 一条语音条），升级后首次打开全部保留、可回放。这是计划里最担心的一步，本地过了；线上仍是不可回滚，部署前再确认。
- 升级后对话：发一句话 4 秒收到回复，无断开、dev 日志无异常。
- **工具确认流程**（经过 `onMessage` 包装层的审批账本）：让小莲记「晚课念佛 108 声」→ 确认卡 4 秒出现 → 确认前记录仍 4 条 → 点「确认保存」→ 5 条且 `('晚课念佛', 108)` → 小莲续答「已记下」。
- 语音条：`tests/browser/voice-flow.sh` 重跑，语音条 2 → 3，最后一条时长 0:04、转写「今天念佛五百**生**,心里很平静。」（这次 Whisper 把"声"写成同音"生"，前一次是对的——转写有随机性，同音字错误存在）、回放正常。脚本本身修过一次：原先抓页面第一个段落/第一个气泡，会拿旧记录冒充新结果，改为按数量 +1 判定、只看最后一条。
- 单测：`server.test.ts` 三个连接测试改写为「握手验一次且附件里不含凭据 / 三种非法会话握手即关且之后任何帧不达 SDK / TTL 后文本帧 4409、二进制帧放行」；110 项全过。`tsc` / `oxlint` / 生产构建 / `wrangler deploy --dry-run` 通过（上传 2599 → 3142 KiB，`agents` 0.23 更大）。

**未验**：4409 重连路径没有在浏览器里等 30 分钟实测，只有单测覆盖服务端与一行客户端逻辑；线上迁移未做。
