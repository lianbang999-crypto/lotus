/** Identity is resolved by the existing auth service, never by a browser account ID. */
export const AUTH_ORIGIN = "https://auth.foyue.org";
type AuthEnv = { DEV_LOCAL?: string; LOTUS_AUTH_URL?: string };
export type ResolvedSession = {
  accountId: string;
  name: string;
  isAnonymous: boolean;
  mode: "local" | "cloud";
};
export class AuthError extends Error {
  constructor(public code: string, message: string, public status = 503) { super(message); }
}

const providers = ["google", "apple", "wechat"] as const;
type Provider = typeof providers[number];
const socialHosts: Record<Provider, string> = { google: "accounts.google.com", apple: "appleid.apple.com", wechat: "open.weixin.qq.com" };
const profileId = /^acc_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const json = (data: unknown, status = 200, headers?: Headers) => {
  const safe = new Headers(headers);
  safe.set("Cache-Control", "no-store");
  safe.set("X-Content-Type-Options", "nosniff");
  safe.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status, headers: safe });
};
const unavailable = () => new AuthError("AUTH_UNAVAILABLE", "账号服务暂时不可用，请稍后重试");

/** Call for every mutation and WebSocket upgrade, including requests without cookies. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new AuthError("FORBIDDEN_ORIGIN", "请求来源不匹配，请从莲花页面重试", 403);
  }
}

function credentials(request: Request): Headers {
  const headers = new Headers({ Accept: "application/json" });
  const cookie = request.headers.get("Cookie");
  const authorization = request.headers.get("Authorization");
  if (cookie) {
    if (cookie.length > 16384) throw new AuthError("INVALID_CREDENTIAL", "登录凭据无效", 400);
    headers.set("Cookie", cookie);
  }
  if (authorization) {
    if (authorization.length > 8192 || !/^Bearer [^\s]+$/i.test(authorization)) {
      throw new AuthError("INVALID_CREDENTIAL", "登录凭据无效", 400);
    }
    headers.set("Authorization", authorization);
  }
  return headers;
}

async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    const response = await fetch(AUTH_ORIGIN + path, {
      ...init,
      // Workers 运行时只接受 "follow" / "manual"；传 "error" 会直接抛 TypeError，
      // 被下面的 catch 吞成「账号服务不可用」，登录链路必然全挂。拒绝跳转改由下一行判断。
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    if (response.status >= 300 && response.status < 400) throw unavailable();
    return response;
  } catch { throw unavailable(); }
}

async function boundedJSON(input: Request | Response, maxBytes: number): Promise<unknown> {
  if (Number(input.headers.get("Content-Length") ?? 0) > maxBytes) throw new Error("Oversized JSON");
  const reader = input.body?.getReader();
  if (!reader) throw new Error("Missing JSON");
  let length = 0;
  let text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new Error("Oversized JSON"); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally { reader.releaseLock(); }
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export async function resolveSession(request: Request, env: AuthEnv, isDev: boolean): Promise<ResolvedSession | null> {
  const url = new URL(request.url);
  if (isDev && env.DEV_LOCAL === "true" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return { accountId: "local_lotus_developer", name: "本地体验", isAnonymous: false, mode: "local" };
  }
  const headers = credentials(request);
  if (!headers.has("Cookie") && !headers.has("Authorization")) return null;
  const response = await authFetch("/api/accounts/me", { headers });
  if (response.status === 401) return null;
  if (!response.ok) throw unavailable();
  let profile: unknown;
  try { profile = await boundedJSON(response, 32768); } catch { throw unavailable(); }
  if (!record(profile) || typeof profile.accountId !== "string" || !profileId.test(profile.accountId)
    || typeof profile.isAnonymous !== "boolean" || typeof profile.name !== "string" || profile.name.length > 1000) {
    throw unavailable();
  }
  return { accountId: profile.accountId, name: profile.name, isAnonymous: profile.isAnonymous, mode: "cloud" };
}

type AuthMethods = { email: boolean; phone: boolean; anonymous: boolean; passkey: boolean; social: Provider[] };
async function getMethods(): Promise<AuthMethods> {
  const response = await authFetch("/api/auth-methods");
  if (!response.ok) throw unavailable();
  let data: unknown;
  try { data = await boundedJSON(response, 8192); } catch { throw unavailable(); }
  if (!record(data) || !["email", "phone", "anonymous", "passkey"].every((key) => typeof data[key] === "boolean")
    || !Array.isArray(data.social) || !data.social.every((value) => providers.includes(value as Provider))) throw unavailable();
  return { email: data.email as boolean, phone: data.phone as boolean, anonymous: data.anonymous as boolean, passkey: data.passkey as boolean, social: data.social as Provider[] };
}

function cookieHeaders(response: Response): Headers {
  const headers = new Headers();
  // Preserve each Set-Cookie separately, including Expires commas. Do not log them.
  for (const cookie of response.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
  return headers;
}

/** A deliberately small proxy; it cannot forward arbitrary auth paths or hosts. */
export async function handleAuthRoute(request: Request, _env: AuthEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/api/auth-methods") {
    if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED", message: "不支持此请求方式" }, 405);
    return json(await getMethods());
  }
  if (path !== "/api/auth/sign-in/email" && path !== "/api/auth/sign-in/social") return null;
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED", message: "不支持此请求方式" }, 405);
  assertSameOrigin(request);
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new AuthError("JSON_REQUIRED", "请使用 JSON 请求", 415);
  }
  let input: unknown;
  try { input = await boundedJSON(request, 16384); } catch { throw new AuthError("INVALID_INPUT", "登录信息格式不正确", 400); }
  if (!record(input)) throw new AuthError("INVALID_INPUT", "登录信息格式不正确", 400);
  let body: Record<string, unknown>;
  let provider: Provider | undefined;
  if (path.endsWith("/email")) {
    if (Object.keys(input).some((key) => key !== "email" && key !== "password")
      || typeof input.email !== "string" || input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)
      || typeof input.password !== "string" || input.password.length < 1 || input.password.length > 1024) {
      throw new AuthError("INVALID_INPUT", "请输入有效邮箱和密码", 400);
    }
    body = { email: input.email, password: input.password };
  } else {
    if (Object.keys(input).some((key) => key !== "provider") || !providers.includes(input.provider as Provider)) {
      throw new AuthError("INVALID_INPUT", "登录方式无效", 400);
    }
    provider = input.provider as Provider;
    if (!(await getMethods()).social.includes(provider)) throw new AuthError("PROVIDER_UNAVAILABLE", "此登录方式暂未启用", 400);
    body = { provider, callbackURL: new URL("/", request.url).href };
  }
  const headers = credentials(request);
  headers.set("Origin", new URL(request.url).origin);
  headers.set("Content-Type", "application/json");
  const response = await authFetch(path, { method: "POST", headers, body: JSON.stringify(body) });
  if (!response.ok) {
    const status = [400, 401, 403, 429].includes(response.status) ? response.status : 503;
    return json({ error: status === 429 ? "RATE_LIMITED" : "SIGN_IN_FAILED", message: status === 429 ? "尝试次数较多，请稍后再试" : "登录未完成，请检查账号信息或稍后重试" }, status);
  }
  let result: unknown;
  try { result = await boundedJSON(response, 32768); } catch { throw unavailable(); }
  if (!record(result)) throw unavailable();
  if (provider) {
    if (typeof result.url !== "string") throw unavailable();
    let target: URL;
    try { target = new URL(result.url); } catch { throw unavailable(); }
    if (target.protocol !== "https:" || target.hostname !== socialHosts[provider] || target.port || target.username || target.password) throw unavailable();
    return json({ url: target.href }, 200, cookieHeaders(response));
  }
  // The browser needs the cookie, not the session token returned by Better Auth.
  if (!record(result.user) || typeof result.user.id !== "string" || !profileId.test(result.user.id)
    || response.headers.getSetCookie().length === 0) throw unavailable();
  return json({ ok: true }, 200, cookieHeaders(response));
}
