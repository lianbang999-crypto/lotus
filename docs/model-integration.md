# Lotus 模型接入

本机使用硅基流动的 OpenAI 兼容 Chat Completions 接口。密钥保存在被 Git 忽略的 `.dev.vars` 中，权限为 `0600`，仅由 Worker 读取；浏览器通过同源 `/api/agent` 通信。Cloudflare 插件默认会为本地 preview 复制 `.dev.vars` 到输出目录，Lotus 的构建插件已移除此文件，发布产物只使用正式 Worker Secrets。

```dotenv
OPENAI_BASE_URL=https://api.siliconflow.cn/v1
MODEL_NAME=deepseek-ai/DeepSeek-V3
OPENAI_API_KEY=请在本机填写
```

本次已使用提供的密钥访问官方模型列表，返回 HTTP 200，并确认上述模型可用。真实模型曾通过浏览器生成笔记确认卡、确认后保存一条记录；该次联调也发现确认后续答报错和重复询问保存，不能把首次写入成功视为整条对话已验收。

## 兼容性调整

- 当前依赖为 `agents@0.17.4`、`@cloudflare/ai-chat@0.9.3`、`@ai-sdk/react@3.0.204`、`ai@6.0.202`，具体版本由 lockfile 固定。
- `ai@6.0.282` 的 `resume-stream` 从空消息开始，而当前 Agents 工具续答流直接发送先前工具的输出，客户端会报 `No tool invocation found`。改用普通提交又会在此版本组合下丢失部分持久化工具卡。最终固定 Cloudflare 声明兼容的 `@ai-sdk/react@3.0.204` 与其依赖 `ai@6.0.202`，保留 Agents 原生自动续答；`tests/backend/chat-continuation.test.ts` 直接运行真实客户端解析器验证批准和取消，升级时必须通过。
- 在待确认卡处理完之前，用户仍能编辑草稿，但不能发送新的用户消息，避免未完成工具调用进入下一轮上下文。
- 系统提示明确：工具返回 `ok:true` 时写入已经完成，不再重复询问保存，不展示内部 ID 或版本；取消不能说成已保存。
- WebSocket 认证凭据只在内存中。默认休眠会清空认证 Map，却保留旧 socket；实测首次操作触发 `4401`，而 SDK 将该关闭码视为不自动重连。当前设置 `hibernate:false` 保持活跃连接的认证上下文，并提供重新连接入口。代价是连接期间没有休眠节省，应在生产容量评估时计算，不以此宣称生产运行成本已验证。

官方参考：[硅基流动快速开始](https://docs.siliconflow.cn/docs/userguide/quickstart)、[模型列表](https://docs.siliconflow.cn/docs/api/models-get)、[Function Calling](https://docs.siliconflow.cn/docs/userguide/guides/function-calling)、[AI SDK 工具确认与自动续答](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage)。

## 验证入口

`tests/browser/chat-flow.js` 使用独立本机 SSE 夹具，专门覆盖没有前置文字的纯工具调用、刷新待确认、批准与取消、草稿与抽屉焦点、错误提示和手机横向溢出。它不能替代真实模型或正式域名账号验收。具体执行记录见 [界面验证](ui-validation.md) 与 [聊天协议验收](chat-protocol-validation.md)。

本项目尚未部署。正式域名 SSO、生产法义检索、模型长期质量与限流恢复尚未验收。本机模型调用成功不表示这些能力已经上线。

## 2026-09-14 最终真实模型验收

正常本地服务在完整重启后，使用硅基流动 `deepseek-ai/DeepSeek-V3` 通过真实浏览器验证：

1. 用户输入产生实际原生工具确认卡，点击前业务表没有该笔记。
2. 点击确认后只保存一条；模型回复“已完成笔记保存。”，没有重复请求确认和内部版本号。
3. 第二条笔记点击取消后没有业务写入。
4. 刷新后，完成卡与取消卡都存在，界面无可见流错误；手机端无水平溢出。
5. 合成记录通过正常提案确认删除。密钥扫描未在源码、文档、测试、前端或发布目录发现密钥，输出目录没有 `.dev.vars`。

截图位于 `output/playwright/siliconflow-final-approval.png`、`siliconflow-final-completed.png` 和 `siliconflow-final-mobile.png`。此次共覆盖两条业务意图，证明连接和这条工具流程，不是所有模型意图、故障恢复、模型质量或生产并发的完整验收。

曾用 Qwen 测试时出现只输出文字而不生成卡片。工具说明已明确“现在调用以生成待确认卡，由平台等待用户点击确认”；期间 Vite 环境热更新失败，后续更改必须完整重启才能验证，不能把旧配置下的输出当成新版本结果。
