# Lotus 与 foyue-auth 的接入合同

核验日期：2026-09-13。依据是本地 `/Users/bincai/Downloads/Lookaos/foyue-auth` 当前源码；未修改、部署该服务，也未读取密钥或用户会话。本文中的生产域名来自其配置，不代表本次已完成生产登录验收。

## 身份来源与响应

Lotus 后端只从 `https://auth.foyue.org/api/accounts/me` 验证身份。它返回的是**顶层账号对象**，没有 `data` 或 `user` 包裹：

```ts
type AccountProfile = {
  accountId: string; // acc_<ULID>
  name: string;
  isAnonymous: boolean;
  email: string | null;
  emailVerified: boolean;
  phoneNumber: string | null;
  phoneNumberVerified: boolean;
  linkedProviders: string[];
  passkeyCount: number;
  reliableRecovery: boolean;
  recoveryAdvice: string | null;
  createdAt: string;
};
```

未登录返回 HTTP 401 与 `{ "error": "UNAUTHENTICATED" }`。上游通过 `auth.api.getSession({ headers: request.headers })` 解析会话，再从 `session.user.id` 取 `accountId`。证据：auth `src/index.ts` 的“需要会话的账号/授权面”、`src/registry.ts:93–143`。

Lotus 应将调用者的 Cookie 或 Authorization 转发到这一固定服务端地址，并对响应的 `accountId` 和 `isAnonymous` 做类型校验。未知结构、网络错误及上游 5xx 都应拒绝访问，不能降级为演示账号。客户端传来的账号 ID、邮箱、浏览器缓存和模型输出都不是身份凭据。

数据库、Agent 实例、会话、提案、消息、记忆及记录的所属账号必须来自上述服务端身份。任何按 ID 读取、修改或删除都同时限定所属账号。页面切换账号后清空旧账号的缓存与选择状态。

## 浏览器登录

上游配置开启跨子域 Cookie，Domain 为 `.foyue.org`；HTTPS 环境开启 Secure Cookie。浏览器请求使用 `credentials: "include"`。上游启用 Bearer 插件供无 Cookie 的客户端使用，会话令牌不能与 JWT 混用：JWT 是另一条 `/api/auth/token` → JWKS 验签路线。

`GET /login` 是开发者链路验证页，不是产品登录页：它只创建已配置的社交登录按钮，`callbackURL` 固定回到 auth 的 `/login`，**没有 `returnTo` 参数合同**。Lotus 应提供自己的登录界面，通过官方 Better Auth 端点或客户端完成登录，再重新读取 Lotus 的账号状态。证据：auth `src/login-page.ts:1–10,166–185`。

首版可使用的最小链路：

1. 读取 `GET https://auth.foyue.org/api/auth-methods`，只展示服务端实际启用的方式。
2. 邮箱密码登录调用 `POST /api/auth/sign-in/email`，JSON 为 `{email,password}`；注册为 `POST /api/auth/sign-up/email`，JSON 为 `{email,password,name}`。
3. 社交调用 `POST /api/auth/sign-in/social`，传可用 provider 和固定为当前 Lotus origin 的 `callbackURL`；仅接受预期 HTTPS 提供方跳转。不要把任意查询参数当跳转目标。
4. 成功后重新请求 Lotus API，由 Lotus 后端再次验证身份，再加载该账号的数据。

上游允许的生产来源为 `https://foyue.org` 与 `https://*.foyue.org`；开发可信来源是 `http://localhost:3000`、`http://localhost:5173`。CORS 的 localhost 范围比 trustedOrigins 宽，不能只看 CORS 就假设所有开发端口都可登录。`.foyue.org` Cookie 不会成为 localhost 同源 Cookie，本地需要独立演示身份或明确配置的开发认证链路，不能宣称已验证生产 SSO。

Lotus 自己的写入端点仍须校验精确 Origin 与 JSON Content-Type。上游 CORS 不会替 Lotus 提供 CSRF 防护。身份响应、用户数据及会话响应应使用 `Cache-Control: no-store`；不要记录 Cookie、Authorization、密码或完整身份响应。

## 匿名账号与升级

上游匿名登录会创建真实 `acc_…` ID，`isAnonymous: true`，`name: ""`、`email: null`、`reliableRecovery: false`。当前配置只有 `anonymous({ emailDomainName: ... })`，没有产品数据迁移的 `onLinkAccount` 回调，也没有 `disableDeleteAnonymousUser`。证据：auth `src/auth.ts` 匿名插件配置；`test/auth.spec.ts:226–282` 包含匿名身份断言，但本次未重新运行该仓库测试。

Better Auth 官方文档说明：匿名用户随后登录或注册其他方式时，可通过 `onLinkAccount({ anonymousUser, newUser })` 迁移业务数据；默认会删除旧匿名用户。仅保留旧匿名行也不能自动把 Lotus 数据移交新账号。[官方匿名插件文档](https://better-auth.com/docs/plugins/anonymous)

**首版策略：正式账号保存个人业务记录；未登录或匿名体验不创建可承诺继承的云端个人记录。** UI 必须说明登录后才会保存，不能显示“绑定后自动保留全部内容”。如确需匿名持久化，先实现和验收下述迁移合同：

- 旧、新身份关系必须由 auth 的可信 hook 证明，不能接受浏览器提交的 oldAccountId/newAccountId。
- 迁移有一次性事件 ID、签名、有效期和固定接收方；Lotus 记录幂等状态并验证目标身份。
- 迁移覆盖 Agent 及其全部所属数据，处理新账号已有数据的合并规则；每个阶段可重试，失败不删除唯一数据副本。
- 验收匿名升级到新账号、登录已有账号、重复事件、签名伪造、跨账号请求、失败重试及账号切换；完成前不要开放“自动继承”的产品承诺。

以上是 Lotus 后续迁移设计，不是已有 auth 功能。当前外部仓库不需要为正式账号首版做任何改动。

## 账号与授权分开

`accountId` 只证明身份。它不授权 Lotus 读取 Looka、其他产品或其他用户的数据。跨产品授权在 auth `/api/grants` 独立管理；Lotus 首版只访问自己的数据。

`isAnonymous: false` 也不等于有可靠找回方式。上游允许未验证邮箱登录，免验证码手机号注册的 `phoneNumberVerified` 保持 false；UI 可显示 `recoveryAdvice`，不得宣称这些方式已经验证。

任何 Agent 对业务数据的写入均应先生成该账号的提案，在用户明确确认后由服务器执行；模型不得直接提交数据库写入。提案所属账号、状态、有效期和实际执行内容应在确认时再次校验。

## 当前验收边界

已完成：读取和核对当前 auth 源码、配置、测试内容，并对照官方匿名插件合同。Lotus `src/agent/auth.ts` 实现固定上游身份校验、精确 Origin 校验、邮箱/社交登录代理与可用方式查询；代理不回传会话 token，只保留必要结果与各条 Set-Cookie。开发身份要求同时满足开发构建、`DEV_LOCAL === "true"` 和 localhost/127.0.0.1/IPv6 loopback 地址。

`npx vitest run tests/backend/auth.test.ts` 已通过 45 项测试，涵盖伪造账号、无凭据、缺失/错误匿名位、上游 401/异常/重定向、开发身份边界、跨源登录、非法 JSON Content-Type、外部回调地址、未启用 provider、异常提供方跳转、Cookie 多头保留及 token 不回显。这是模拟上游的单元验证，不是生产 SSO 验收。

未完成：生产浏览器注册/登录、Cookie 跨子域实际共享、会话撤销传播、匿名迁移、邮件送达、社交提供方真人授权与 Passkey 浏览器流程。本次未使用真实账号或创建上游账号；源码中的已部署说明不计作本次生产验收证据。
