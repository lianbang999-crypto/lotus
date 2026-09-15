import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSameOrigin, AUTH_ORIGIN, AuthError, handleAuthRoute, resolveSession } from "../../src/agent/auth";

const APP = "https://lotus.foyue.org";
const ACCOUNT = "acc_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const profile = { accountId: ACCOUNT, name: "莲友", isAnonymous: false };
const enabled = { email: true, phone: true, anonymous: true, passkey: true, social: ["google"] };
const sessionRequest = (extra: Record<string, string> = {}) => new Request(`${APP}/api/session`, { headers: { Cookie: "test-session=synthetic", ...extra } });
const post = (path: string, body: unknown, extra: Record<string, string> = {}) => new Request(APP + path, {
  method: "POST", headers: { Origin: APP, "Content-Type": "application/json", ...extra }, body: JSON.stringify(body),
});
const mockFetch = (response: Response) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
afterEach(() => vi.unstubAllGlobals());

describe("Lotus identity boundary", () => {
  it("resolves only the upstream top-level profile and forwards no asserted user headers", async () => {
    mockFetch(Response.json(profile));
    const result = await resolveSession(sessionRequest({ "X-Account-Id": "victim", Authorization: "Bearer synthetic" }), { LOTUS_AUTH_URL: "https://attacker.invalid" }, false);
    expect(result).toEqual({ ...profile, mode: "cloud" });
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(AUTH_ORIGIN + "/api/accounts/me");
    expect(options?.redirect).toBe("error");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(options?.headers);
    expect(headers.get("X-Account-Id")).toBeNull();
    expect(headers.get("Cookie")).toBe("test-session=synthetic");
    expect(headers.get("Authorization")).toBe("Bearer synthetic");
  });
  it("does not turn browser-provided identity into a session", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const result = await resolveSession(new Request(`${APP}/api/session?accountId=${ACCOUNT}`, { headers: { "X-Account-Id": ACCOUNT } }), {}, false);
    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves the anonymous fact instead of granting formal-account capabilities", async () => {
    mockFetch(Response.json({ ...profile, isAnonymous: true, name: "" }));
    expect(await resolveSession(sessionRequest(), {}, false)).toMatchObject({ isAnonymous: true, name: "" });
  });
  it.each([
    {}, { user: profile }, { ...profile, isAnonymous: undefined }, { ...profile, isAnonymous: "false" },
    { ...profile, accountId: "victim" }, { ...profile, accountId: "acc_8ZZZZZZZZZZZZZZZZZZZZZZZZZ" }, { ...profile, name: null },
  ])("fails closed for malformed identity envelopes: %j", async (data) => {
    mockFetch(Response.json(data));
    await expect(resolveSession(sessionRequest(), {}, false)).rejects.toMatchObject({ code: "AUTH_UNAVAILABLE", status: 503 });
  });
  it("returns logged out only for an actual 401", async () => {
    mockFetch(Response.json({ error: "UNAUTHENTICATED" }, { status: 401 }));
    expect(await resolveSession(sessionRequest(), {}, false)).toBeNull();
  });
  it.each([302, 403, 500])("does not downgrade upstream status %i into a local identity", async (status) => {
    mockFetch(new Response(null, { status }));
    await expect(resolveSession(sessionRequest(), { DEV_LOCAL: "true" }, false)).rejects.toBeInstanceOf(AuthError);
  });
  it("does not downgrade a timeout into a local identity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("upstream timeout")));
    await expect(resolveSession(sessionRequest(), { DEV_LOCAL: "true" }, false)).rejects.toMatchObject({ code: "AUTH_UNAVAILABLE" });
  });
  it("rejects HTML and oversized upstream envelopes", async () => {
    mockFetch(new Response("<html>Sign in</html>"));
    await expect(resolveSession(sessionRequest(), {}, false)).rejects.toBeInstanceOf(AuthError);
    mockFetch(Response.json({ ...profile, unused: "x".repeat(33000) }));
    await expect(resolveSession(sessionRequest(), {}, false)).rejects.toBeInstanceOf(AuthError);
  });
  it.each([
    ["http://localhost:5173", true, "true", true], ["http://127.0.0.1:5173", true, "true", true], ["http://[::1]:5173", true, "true", true],
    [APP, true, "true", false], ["http://localhost:5173", false, "true", false], ["http://localhost:5173", true, "false", false],
    ["http://localhost:5173", true, "1", false], ["https://127.0.0.1.evil.invalid", true, "true", false],
  ])("local identity requires all three guards: %s / %s / %s", async (base, dev, flag, expected) => {
    vi.stubGlobal("fetch", vi.fn());
    const result = await resolveSession(new Request(`${base}/api/session`), { DEV_LOCAL: String(flag) }, Boolean(dev));
    expect(Boolean(result?.mode === "local")).toBe(expected);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Lotus origin and auth proxy boundary", () => {
  it.each([undefined, "null", "http://lotus.foyue.org", "https://other.foyue.org", "https://lotus.foyue.org.evil.invalid"])("rejects missing or foreign origins: %s", (origin) => {
    const headers: Record<string, string> = { Upgrade: "websocket" };
    if (origin) headers.Origin = origin;
    expect(() => assertSameOrigin(new Request(`${APP}/api/agent`, { headers }))).toThrow(AuthError);
  });
  it("accepts an exact origin", () => {
    expect(() => assertSameOrigin(post("/api/proposals", {}))).not.toThrow();
  });
  it("does not expose an arbitrary auth proxy", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect(await handleAuthRoute(post("/api/auth/delete-user", {}), {})).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not allow GET login or POST methods", async () => {
    expect((await handleAuthRoute(new Request(`${APP}/api/auth/sign-in/email`), {}))?.status).toBe(405);
    expect((await handleAuthRoute(post("/api/auth-methods", {}), {}))?.status).toBe(405);
  });
  it("rejects cross-origin and form-encoded login before the network", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(handleAuthRoute(post("/api/auth/sign-in/email", { email: "a@example.com", password: "synthetic" }, { Origin: "https://other.foyue.org" }), {})).rejects.toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    await expect(handleAuthRoute(post("/api/auth/sign-in/email", {}, { "Content-Type": "text/plain" }), {})).rejects.toMatchObject({ status: 415 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects forged callback and account parameters", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(handleAuthRoute(post("/api/auth/sign-in/email", { email: "a@example.com", password: "synthetic", accountId: "victim" }), {})).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(handleAuthRoute(post("/api/auth/sign-in/social", { provider: "google", callbackURL: "https://attacker.invalid" }), {})).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves multiple cookies and omits session tokens from email login responses", async () => {
    const headers = new Headers();
    headers.append("Set-Cookie", "test-a=synthetic; HttpOnly; Secure; Domain=.foyue.org");
    headers.append("Set-Cookie", "test-b=synthetic; Expires=Wed, 21 Oct 2037 07:28:00 GMT; HttpOnly; Secure");
    mockFetch(Response.json({ token: "synthetic-private-token", user: { id: ACCOUNT } }, { headers }));
    const response = await handleAuthRoute(post("/api/auth/sign-in/email", { email: "a@example.com", password: "synthetic" }), {});
    expect(response?.headers.getSetCookie()).toHaveLength(2);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    expect(await response?.json()).toEqual({ ok: true });
    const [, options] = vi.mocked(fetch).mock.calls[0];
    expect(new Headers(options?.headers).get("Origin")).toBe(APP);
  });
  it("does not reflect upstream login errors or secrets", async () => {
    mockFetch(Response.json({ message: "internal details", token: "synthetic-private-token" }, { status: 401 }));
    const response = await handleAuthRoute(post("/api/auth/sign-in/email", { email: "a@example.com", password: "synthetic" }), {});
    expect(response?.status).toBe(401);
    expect(await response?.text()).not.toMatch(/internal details|synthetic-private-token/);
  });
  it("does not report successful login for an unexpected successful envelope", async () => {
    mockFetch(Response.json({ ok: true }));
    await expect(handleAuthRoute(post("/api/auth/sign-in/email", { email: "a@example.com", password: "synthetic" }), {})).rejects.toMatchObject({ code: "AUTH_UNAVAILABLE" });
  });
  it("only advertises the auth service's configured providers", async () => {
    mockFetch(Response.json({ ...enabled, irrelevant: "hidden" }));
    const response = await handleAuthRoute(new Request(`${APP}/api/auth-methods`), {});
    expect(await response?.json()).toEqual(enabled);
    mockFetch(Response.json({ ...enabled, social: ["attacker"] }));
    await expect(handleAuthRoute(new Request(`${APP}/api/auth-methods`), {})).rejects.toBeInstanceOf(AuthError);
  });
  it("blocks an unavailable provider before initiating login", async () => {
    mockFetch(Response.json({ ...enabled, social: [] }));
    await expect(handleAuthRoute(post("/api/auth/sign-in/social", { provider: "google" }), {})).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("locks the social callback to Lotus and returns the expected provider URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(enabled)).mockResolvedValueOnce(Response.json({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic" })));
    const response = await handleAuthRoute(post("/api/auth/sign-in/social", { provider: "google" }), {});
    expect(await response?.json()).toEqual({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic" });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toEqual({ provider: "google", callbackURL: APP + "/" });
  });
  it.each(["https://attacker.invalid", "http://accounts.google.com", "https://accounts.google.com.attacker.invalid", "https://attacker@accounts.google.com", "https://accounts.google.com:8443"])("rejects an unexpected social redirect: %s", async (url) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(enabled)).mockResolvedValueOnce(Response.json({ url })));
    await expect(handleAuthRoute(post("/api/auth/sign-in/social", { provider: "google" }), {})).rejects.toMatchObject({ code: "AUTH_UNAVAILABLE" });
  });
});
