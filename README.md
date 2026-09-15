# 莲花 Lotus

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

- **聊天是默认主界面**：欢迎页、自然语言起手句、固定输入框、消息流、原生工具确认卡。功课、笔记、日记、功过省察、账本、日历收进「我的空间」抽屉。消息带北京时间戳与按天分隔；输入草稿跨刷新保留（sessionStorage，关浏览器即清）；对话区可「开始新的对话」。
- 输入框旁「＋」可手动填写，确认卡回到对话流中；未配置模型也能核对、确认、取消。切换记录页面保留尚未发送的聊天草稿，未确认提案可在刷新后恢复。
- 新增/修改/删除均先生成不可变提案，确认后才写入；取消不改变业务记录，重复确认不重复写入。
- 修改/删除带版本校验；金额按人民币整数分保存。日历为北京时间，提供应用内时间提示与完成状态，暂不发送系统推送。
- `AIChatAgent` 流式会话、消息持久化、语义工具、原生审批卡片；服务器额外核对提案内容、确认帧和幂等执行记录。
- SDK 版本固定 `@cloudflare/ai-chat@0.9.3`：实测 0.9.4 调用 Agents 0.17.4 不存在的 `_withAgentSpan`，导致 DO 无法启动。另固定 `ai@6.0.202` 与 `@ai-sdk/react@3.0.204` 以保持原生工具续答兼容。请保留 lockfile，升级时运行客户端解析器和真实 Worker 浏览器流程。
- `searchDharma` 只调用原有 wenchao 检索，严格验证语料角色和来源地址。来源卡将原文与解释区分。

## 正式服务接线

账号服务固定 `https://auth.foyue.org`。Lotus 服务器验证其 `/api/accounts/me` 返回的 `accountId`，不会让浏览器指定 Durable Object。所有修改和 WebSocket 握手都核对同源 Origin；已连接 WebSocket 的每次消息也重新验证会话，认证凭据只保留于内存；活跃连接已关闭休眠，防止上下文丢失，断开时提供重新连接入口。原 auth `/login` 不支持返回地址，因此 Lotus 提供自身的邮箱与 Google 登录入口。只有正式账号能保存长期数据，匿名升级迁移尚未实现。

在 `.foyue.org` 子域部署后，已有共享 Cookie 才能完成真实 SSO。本机开发模式不宣称完成生产 SSO。详见 [账号接入](docs/auth-integration.md)。

当前默认模型提供方为硅基流动，地址为 `https://api.siliconflow.cn/v1`，模型为 `deepseek-ai/DeepSeek-V3`。通过硅基官方 [OpenAI 兼容接口](https://docs.siliconflow.cn/docs/userguide/quickstart) 接入：在 Worker Secrets 设置 `OPENAI_API_KEY`，变量设置 `OPENAI_BASE_URL`（可选）、`MODEL_NAME`。代码同时支持 Workers AI binding；使用该分支时必须把 `MODEL_NAME` 改为对应 Workers AI 模型名称。密钥不进入浏览器。

检索与大安文库接线详见 [检索文档](docs/retrieval.md)。已准备可审查的 wenchao Worker 补丁和大安资料导入工具，资料结构 dry-run 通过；实际线上端点、服务 key、远程入库和模型作答仍须联调。

## 当前边界

本项目尚未部署、提交或推送。真实模型连接状态与验收见 [模型接入](docs/model-integration.md)；正式域名 SSO、生产检索与大安远程索引尚未验收。匿名到正式账号迁移、后台推送、全量统计与分页、数据导出/恢复均不属于已完成能力。首版列表最多返回最近 300 条记录，首页/账本/热力图统计基于返回记录；不以记录数量判断功德、修行证量或往生资格。

项目由 `cloudflare/agents-starter` 演进，保留上游 MIT LICENSE。设计组件按莲花的配色、间距与交互定制。`integrations/wenchao/prepared` 和含文库全文的导入批次为本地产物，均排除出 Git。

聊天界面的本机浏览器验收见 [界面验证](docs/ui-validation.md)。当前每个账号是一段持续对话，尚未实现多个独立聊天主题。

GitHub 界面参考、许可证与改造取舍见 [设计调研](docs/design-references.md)。当前方向为 Zola 的聊天布局、prompt-kit 的视觉细节和 Haven 的轻量陪伴感；本次未复制这些项目代码或迁移后端。
