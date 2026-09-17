# 小莲 Lotus

净土伴修个人助理。基于 Cloudflare Agents 官方 starter，使用 React、shadcn 风格的 Radix 组件、assistant-ui 对话运行时、Schedule-X 日历和 cal-heatmap。个人数据保存在每个账号独立的 Durable Object SQLite 中。

## 本地运行

需要 Node.js 22.13+。

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

打开 `http://127.0.0.1:5173`。现有 `.dev.vars` 已启用本地开发模式。密钥只填写在该 Git 忽略文件中；复制示例文件前注意不要覆盖已有密钥。**本地模式无模型时仍能体验全部记录表单与审批，不伪造 AI 回答或法义引用。** 页面明确标注记录保存在本机，数据位于 `.wrangler/state`，不会自动迁移到正式账号。

```bash
npm run check
npm test
node --test integrations/wenchao/integration.test.mjs
npm run build
```

原生聊天 WebSocket、确认与自动续答已通过本机 SSE 夹具和真实 Worker 验证，重跑方法与证据边界见 [聊天协议验收](docs/chat-protocol-validation.md)。

Cloudflare Vite 开发时需要本机监听权限。受限环境可设置 `WRANGLER_LOG_PATH=/tmp/lotus-wrangler.log`，避免 Wrangler 写入系统日志目录。

## 首版能力

- **聊天是默认主界面**：欢迎页、自然语言起手句、固定输入框、消息流、原生工具确认卡。功课、笔记、日记、功过省察、账本、日历收进「我的空间」侧栏：桌面常驻可折叠（记住状态），手机为抽屉；侧栏下半是按今天 / 昨天 / 最近 7 天 / 更早分组的记录时间线，点一条直接编辑。消息带北京时间戳与按天分隔；输入草稿跨刷新保留（sessionStorage，关浏览器即清）；对话区可「开始新的对话」。
- 输入框旁「＋」可手动填写，确认卡回到对话流中；未配置模型也能核对、确认、取消。切换记录页面保留尚未发送的聊天草稿，未确认提案可在刷新后恢复。
- 新增/修改/删除均先生成不可变提案，确认后才写入；取消不改变业务记录，重复确认不重复写入。
- 修改/删除带版本校验；金额按人民币整数分保存。日历为北京时间，提供应用内时间提示与完成状态，暂不发送系统推送。
- `AIChatAgent` 流式会话、消息持久化、语义工具、原生审批卡片；服务器额外核对提案内容、确认帧和幂等执行记录。
- SDK 版本：`agents@^0.23`、`@cloudflare/ai-chat@^0.12`（2026-09-16 升级，为实时语音通话所需）；`ai@6.0.202` 与 `@ai-sdk/react@3.0.204` 仍固定以保持原生工具续答兼容。升级时注意 `agents` 把 `@modelcontextprotocol/sdk` 钉在精确版本，增量 `npm install` 会 ERESOLVE，需先卸掉旧 `agents` 子树再一起装。请保留 lockfile，升级后跑真实 Worker 浏览器流程（对话、确认卡、语音条）。
- `searchDharma` 只调用原有 wenchao 检索，严格验证语料角色和来源地址。来源卡将原文与解释区分。
- 聊天回复的 Markdown 由 Streamdown 渲染，但**不启用 `rehype-raw`**：模型输出的原始 HTML 以纯文本显示而非进入 DOM。这既是安全边界，也让首屏分包省掉 parse5（Chat 分包 909→739 kB，gzip 266→214）。约束由 `src/lib/rehype-raw-stub.ts`、`vite.config.ts` 的 alias 与 `tests/backend/markdown-safety.test.ts` 三处共同保证，改动前请先看该测试的注释。
- **北欧极简单主题**（2026-09-17）：全站一套配色，取自 [Nord](https://github.com/nordtheme/nord) 调色板（Snow Storm 做面、Polar Night 做字、Frost 做主色）。主色与错误色按 WCAG AA 加深过，派生值在 `styles.css` 顶部逐个标注。原先的苔绿 / 朝霞 / 素纸三套与设置里的切换器已移除。
- **语音条**（2026-09-16）：输入框旁「按住说话」，松开即发、上滑取消。客户端把录音重采样成 16 kHz WAV 上传，服务端用 Workers AI `whisper-large-v3-turbo`（`language: zh`）转写，原音按账号前缀存 R2 供回放（支持 Range）。**模型只看到转写文字**，走同一个 `sendMessage`，工具与确认卡一行不动；想改转写用「改一改」。
- **对话附件**（2026-09-17）：输入框「+」菜单里的「图片 / 文件」，也可直接拖进窗口。一次一个文件原始字节 `POST /api/attachments`（白名单：图片 / PDF / txt / md / docx，最大 10 MB），按账号前缀存 R2 桶 `ATTACHMENTS`，`GET /api/attachments/:id` 只认本账号。消息里存的是 AI SDK 的 `FileUIPart`（同源相对地址）；进模型前 `modelSafeMessages` 把文本附件内容内联、图片在视觉模型下转 data URL、其余给占位说明——**换模型不用动界面与存储**。部署前先 `wrangler r2 bucket create lotus-attachments`。
- **侧栏收成三个区**（2026-09-18）：和小莲聊聊 / 我的记录 / 法义文库。原来的今日概览、每日功课、我的记录、功过省察、生活账本、我的日历六个入口合成一页 `RecordsHub`（`#records`），类型（全部 / 功课 / 日记 / 笔记 / 功过格 / 账目 / 日历）是页内一行标签；旧地址 `#today` `#journal` `#practice` 等继续有效。「今日概览」那页（营销式 hero、第二个聊天框、点滴列表）整页删除，今天到期的日程条 `TodayStrip` 搬到「全部」标签顶上。圆角收成 6 / 10 / 14 / 20 四档。
- **两条版式硬规则**（2026-09-18）：全站字号下限 12px（之前 7–11px 用了 145 处，长辈在手机上看不清；层级弱化改用颜色与字距，不用缩字）；触屏设备上手指要按的控件 44px（`@media (pointer: coarse)`，桌面保持紧凑）。核查脚本用 Playwright 跑五个页面：无横向溢出、无裁切、最小字号 12。
- **设计审查工具**：项目里装了 [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)（MIT，装在全局 `~/.claude/skills/ui-ux-pro-max/`，不进仓库；纯本地 Python 检索，不联网）。它的风格 / 配色推荐对小莲不适用（会给出创业公司落地页那套），有用的是 119 条 UX 准则清单，改界面前可按 `--domain ux` 查一条条对照。
- **输入框只有三个键**（2026-09-17）：「+」（附件 / 通话 / 手动写一条记录，微信的 + 号语义）、按住说话、发送。通话从 + 菜单进，键盘用户也够得着。
- **语音朗读**（2026-09-16）：助手消息上的「朗读」键，只在点击时出声。中文 TTS 用 SiliconFlow `FunAudioLLM/CosyVoice2-0.5B`（`OPENAI_BASE_URL` 指向 SiliconFlow 时自动启用，`capabilities.speech`）；按账号 + 文本哈希缓存在 R2。Workers AI melotts 的中文输出经 Whisper 回听不可辨，已弃用（记录见 `docs/ui-validation.md`）。
- **实时通话**（2026-09-16）：输入框的电话键，`agents@0.23` 的 `withVoice` 混入；识别先试 `WorkersAINova3STT({ language: "zh" })`，起不来退到「能量 VAD + Whisper 分段」；通话与文字共用同一颗脑子（系统提示、近况、工具），**通话里的写入工具只生成待确认提案**，挂断后回对话里点确认；每轮转写与回复并回聊天线程并标「通话」。语音 WebSocket 走同一条 `/api/agent` 握手鉴权，`/agents/*` 仍不开放；小莲不主动呼叫。

## UI/UX 技术栈（真实在用）

界面不是「基于某个模板」，而是自建 CSS + 少量成熟无头组件。下表按**是否真的跑在代码里**区分，避免把调研看过的项目误记成依赖。

| 层 | 用的项目 | 版本 / 许可证 | 在小莲里负责什么 |
| --- | --- | --- | --- |
| 对话运行时 | [assistant-ui](https://github.com/assistant-ui/assistant-ui) | 0.15.19 · MIT | `Thread/Composer` 原语：视口自动滚动、「回到最新」、输入框状态与 IME 合成、Enter/Shift+Enter |
| Agent 通道 | `agents` + `@cloudflare/ai-chat` | 0.23.0 / 0.12.0 · MIT | WebSocket 会话、消息持久化、原生工具审批帧、`clearHistory` |
| 无障碍交互 | [Radix UI](https://www.radix-ui.com/) | dialog 1.1.23 / slot 1.3.3 · MIT | 「我的空间」抽屉与各弹窗：焦点陷阱、Esc 关闭、焦点归位 |
| Markdown 渲染 | [Streamdown](https://github.com/vercel/streamdown) | 2.6.0 · Apache-2.0 | 流式 Markdown、未闭合语法容错、流式光标；**已禁用 `rehype-raw`** |
| 图标 | [Phosphor Icons](https://phosphoricons.com/) | 2.1.10 · MIT | 全站图标（regular/duotone/light 三种字重） |
| 样式 | [Tailwind CSS](https://tailwindcss.com/) v4 | 4.3.3 · MIT | 仅作为 `@theme inline` 映射与 `@source` 扫描；组件样式是 `src/styles.css` 手写，颜色全部走 17 个语义 token |
| 配色 | [Nord](https://github.com/nordtheme/nord) | MIT | 全站 17 个语义 token 的色值来源；未安装包，只用了调色板的色值，派生处在 `styles.css` 标注 |
| 文件选择 / 拖拽 | [prompt-kit](https://github.com/ibelick/prompt-kit) | MIT | `file-upload.tsx` 复制自其组件，未改逻辑；只交出 `File[]`，不碰上传 |
| 附件卡片 | [shadcn/ui chat 组件](https://ui.shadcn.com/docs/changelog/2026-06-chat-components) | MIT | `attachment.tsx` 取自 registry，只改了三处占位 import；Button 补了 `icon-xs` 一档 |
| 语音波形 | [ElevenLabs UI](https://github.com/elevenlabs/ui) | MIT | `waveform.tsx` / `live-waveform.tsx` 复制自其 registry（纯 UI，不依赖 ElevenLabs 服务）；本地改了触屏拖动、高度透传与外部麦克风流 |
| 样式工具 | `clsx` + `tailwind-merge` + `class-variance-authority` | · MIT / Apache-2.0 | shadcn 式 `cn()` 与 Button 变体 |
| 日历 | [Schedule-X](https://schedule-x.dev/) | 4.8.0 · MIT | 月视图 / 议程视图（抽屉内，懒加载） |
| 热力图 | [cal-heatmap](https://cal-heatmap.com/) | 4.2.4 · MIT | 功课与省察足迹（抽屉内，懒加载） |
| 语音转写 | Workers AI `@cf/openai/whisper-large-v3-turbo` + R2 | 平台服务 · $0.000513/分钟 | 语音条转写与原音回放；通话里 Nova-3 不可用时的分段识别退路；`wrangler.jsonc` 的 `ai` / `r2_buckets` 绑定，本地开发 AI 走 `remote: true` |
| 实时通话 | `agents/voice`（`withVoice`、`WorkersAINova3STT`、`useVoiceAgent`） | 0.23.0 · MIT | 通话协议、客户端 VAD/打断/播放；STT `@cf/deepgram/nova-3`（本地 dev 起不来，线上待验） |
| 中文朗读 | SiliconFlow `FunAudioLLM/CosyVoice2-0.5B`（OpenAI 兼容 `/audio/speech`） | 按量计费 | 朗读键与通话回声；`src/agent/tts.ts`，密钥只在服务端 |

**只是设计参考、未引入代码**：Zola（布局）、prompt-kit（`full-chat-app` 区块的侧栏 + 消息流 + 输入框动作行骨架，2026-09-16 起按此结构自建）、Haven（陪伴感）、以及 AIRI / KouriChat / Everthine / SillyTavern / EverOtome 等陪伴类项目的交互取舍，分别见 [设计调研](docs/design-references.md) 与 [陪伴类项目调研](docs/companion-references.md)。

**关于 shadcn/ui**：`components.json` 存在（new-york / stone），但仓库里**没有安装 shadcn 组件**——`src/components/ui/` 下的 `button.tsx`、`dialog.tsx` 是按 shadcn 约定手写的薄封装（合计 10 行），直接包 Radix，样式走 `styles.css` 的语义类（`button-primary` 等）而非 Tailwind 工具类串。这是刻意选择：小莲的视觉是 3300 行手写 CSS，若引入 shadcn 组件自带的 Tailwind 工具类，等于在同一个项目里并行维护两套样式体系。保留 `components.json` 是为了以后 `npx shadcn add` 能落到正确目录。

> 若将来考虑真正引入 shadcn：注意 2026-07 起它的默认底层已从 Radix 换成 [Base UI](https://base-ui.com)（同一批作者的新项目，npm 包已更名为 `@base-ui/react`，2026-09 为 1.8.0）。**Radix 未被弃用**，shadcn 明确表示两者都会长期支持，且不建议已有项目迁移；我们用的 `@radix-ui/react-dialog@1.1.23` 也是当前最新（2026-07-31），近 12 个月有 81 次发布，维护正常。`npx shadcn init -b radix` 可继续沿用 Radix。结论是现状无需变动。

**`@ai-sdk/react@3.0.204` 不在 `src` 里直接 import**，它是 `agents` 与 `@cloudflare/ai-chat` 的 peer dependency，必须显式固定版本（原因见上一节的兼容性说明），不要当成未使用依赖删掉。

## 正式服务接线

账号服务固定 `https://auth.foyue.org`。Lotus 服务器验证其 `/api/accounts/me` 返回的 `accountId`，不会让浏览器指定 Durable Object。所有修改和 WebSocket 握手都核对同源 Origin；WebSocket 在握手时验证一次会话，只把 `accountId` 写进休眠安全的连接状态（不保存任何可重放凭据），之后每帧只读状态；文本帧超过 30 分钟由服务端以 4409 关闭、客户端静默重连重新握手，登录被吊销的窗口以此为限；语音的二进制帧同样受连接状态门禁但不触发重验。原 auth `/login` 不支持返回地址，因此 Lotus 提供自身的邮箱与 Google 登录入口。只有正式账号能保存长期数据，匿名升级迁移尚未实现。

在 `.foyue.org` 子域部署后，已有共享 Cookie 才能完成真实 SSO。本机开发模式不宣称完成生产 SSO。详见 [账号接入](docs/auth-integration.md)。

当前默认模型提供方为硅基流动，地址为 `https://api.siliconflow.cn/v1`，模型为 `deepseek-ai/DeepSeek-V3`。通过硅基官方 [OpenAI 兼容接口](https://docs.siliconflow.cn/docs/userguide/quickstart) 接入：在 Worker Secrets 设置 `OPENAI_API_KEY`，变量设置 `OPENAI_BASE_URL`（可选）、`MODEL_NAME`。代码同时支持 Workers AI binding；使用该分支时必须把 `MODEL_NAME` 改为对应 Workers AI 模型名称。密钥不进入浏览器。

检索与大安文库接线详见 [检索文档](docs/retrieval.md)。已准备可审查的 wenchao Worker 补丁和大安资料导入工具，资料结构 dry-run 通过；实际线上端点、服务 key、远程入库和模型作答仍须联调。

## 当前边界

本项目尚未部署、提交或推送。真实模型连接状态与验收见 [模型接入](docs/model-integration.md)；正式域名 SSO、生产检索与大安远程索引尚未验收。匿名到正式账号迁移、后台推送、全量统计与分页、数据导出/恢复均不属于已完成能力。首版列表最多返回最近 300 条记录，首页/账本/热力图统计基于返回记录；不以记录数量判断功德、修行证量或往生资格。

项目由 `cloudflare/agents-starter` 演进，保留上游 MIT LICENSE。设计组件按小莲的配色、间距与交互定制。`integrations/wenchao/prepared` 和含文库全文的导入批次为本地产物，均排除出 Git。

聊天界面的本机浏览器验收见 [界面验证](docs/ui-validation.md)。当前每个账号是一段持续对话，尚未实现多个独立聊天主题。

GitHub 界面参考、许可证与改造取舍见 [设计调研](docs/design-references.md)。当前方向为 Zola 的聊天布局、prompt-kit 的视觉细节和 Haven 的轻量陪伴感；本次未复制这些项目代码或迁移后端。人机恋 / 陪伴类项目（AIRI、KouriChat、Everthine、SillyTavern 等）的交互借鉴与边界取舍见 [陪伴类项目调研](docs/companion-references.md)：已落地时段问候、今日日程条、近况上下文、消息级操作（复制 / 改一改 / 换一种说法 / 存为笔记）。
