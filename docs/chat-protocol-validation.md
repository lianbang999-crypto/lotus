# Lotus 聊天协议验收

2026-09-13，本机实际 Worker 验证使用 `@cloudflare/ai-chat@0.9.3`、`agents@0.17.4`、`ai@6.0.282`。这里的模型响应来自本机确定性 SSE 夹具，不构成真实模型质量、正式账号 SSO、生产检索或上线验收。

## 路由与确认链

前端 `useAgent({ agent: 'LotusAgent', basePath: 'api/agent' })` 连接 `/api/agent`。`useAgentChat` 从 `/api/agent/get-messages` 恢复记录。这两个路径均由 Worker 校验会话后，使用服务端取得的 `accountId` 选择 Durable Object。任意 `/agents/*` 与额外实例路径被拒绝。

SDK 0.9.3 的 `useAgentChat.addToolApprovalResponse({ id, approved })` 会从原生工具 part 找到 `approval.id` 对应的 `toolCallId`，发送 `cf_agent_tool_approval` 专用帧，再更新本地 UI。服务器接收该帧后记录决定，并使用原生自动续答；当前兼容组合为 `@ai-sdk/react@3.0.204` 与 `ai@6.0.202`，服务端 `originalMessages` 保持消息身份。Lotus 在 SDK 处理前增加以下检查：

1. 再次验证当前连接的上游会话，并与 Durable Object 的所属账号核对。
2. 确认该 `toolCallId` 已由服务器的 `needsApproval` 阶段冻结了不可变业务操作。
3. 记录批准或拒绝；重复相同决定直接返回，不再次续答；改变决定被拒绝。
4. 工具 `execute` 再次核对批准状态与完全相同的操作内容，使用 SQLite 事务写入业务记录和幂等执行结果。

因此，把 `approved: true` 塞进客户端会话历史，不足以写入业务数据。人工表单走独立的不可变提案 API，具有相同的先确认后写入语义。修改和删除还必须通过版本检查。删除工具额外核验 `entryTitle` 与真实记录标题相同，确认卡可以清楚展示删除对象。

WebSocket 凭据只保留于当前 Durable Object 内存，不写入 SQLite 或 WebSocket attachment。已关闭活跃连接的休眠，避免保留 socket 却丢失认证上下文。进程重启或身份失效仍须重新握手，界面提供重新连接入口。生产上游会话撤销及真实浏览器重连仍需正式域名联调。

## 已完成的本机证据

`tests/backend/chat-wire.mjs` 通过本机 HTTP provider 和真实 Worker WebSocket 验证：

- 同源握手和消息恢复路由可用。
- SSE 工具调用被 SDK 转为持久化的 `approval-requested` part。
- 批准前业务表无记录。
- 专用批准帧触发工具执行，自动续答并保存一条记录。
- 重复批准不产生重复记录，也不重复请求模型。
- 拒绝产生 `output-denied`，业务表保持不变。
- 不存在的确认编号返回错误。

最终一次执行共调用本机 provider 4 次。生产服务器代码没有测试模式响应、硬编码聊天答案或模拟引文；测试 provider 仅存在于此独立测试脚本。

## 重跑方法

在两个终端执行：

```bash
WRANGLER_LOG_PATH=/tmp/lotus-chat-wire-wrangler.log npx vite --config tests/backend/chat-vite.config.ts --host 127.0.0.1 --port 5181 --strictPort
```

```bash
node tests/backend/chat-wire.mjs
```

测试配置使用显式虚构的本地 key，并且 provider 地址固定为 `http://127.0.0.1:5182/v1`。隔离 Worker 状态保存在 `.wrangler/chat-wire-test`；测试不会改写日常开发模式的记录。两端口需空闲，执行结束后停止第一个终端即可。

常规测试 `npm test` 包括真实 SQLite 提案事务、版本冲突、账号边界、CSRF、原生确认台账、上游认证与引用结构校验。服务器路由/会话单测对 SDK 做了明确替身；上面的真实 Worker 流程用于补足运行时与 wire 兼容性证据。

## 2026-09-14 续答修复

首次真实模型调用暴露了默认 `resume-stream` 对工具输出缺少上下文的问题。原 wire 测试没有运行客户端解析器，原浏览器测试没有检查可见错误，因此不能证明此处无误。新增 `tests/backend/chat-continuation.test.ts` 直接测试实际客户端解析器，`tests/browser/chat-flow.js` 使用纯工具调用夹具，同时断言可见错误为空、刷新后每张工具卡仍存在；模型接入的具体调整见 [模型接入](model-integration.md)。上面的 wire 测试保留为服务端原生确认与幂等性检查，不替代当前前端流程。
