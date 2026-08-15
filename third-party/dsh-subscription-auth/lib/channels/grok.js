import { LlmError } from "@deepseek-ai/dsh-llm";
import { ChatGptAdapter } from "../adapter.js";
import { openBrowser } from "../oauth.js";
import { pollDeviceFlow } from "../device-flow.js";
const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const SCOPE = "openid profile email offline_access grok-cli:access api:access";
const DEFAULT_MODELS = [
  { id: "grok-4.3", name: "Grok 4.3", contextWindow: 1e6 },
  { id: "grok-build", name: "Grok Build", contextWindow: 512000 },
  { id: "grok-build-0.1", name: "Grok Build 0.1", contextWindow: 256000 },
  { id: "grok-4.5", name: "Grok 4.5", contextWindow: 500000 },
  { id: "grok-4.20-multi-agent-0309", name: "Grok 4.20 (Multi-Agent)", contextWindow: 2000000 },
  { id: "grok-4.20-0309-reasoning", name: "Grok 4.20 (Reasoning)", contextWindow: 2000000 },
  { id: "grok-4.20-0309-non-reasoning", name: "Grok 4.20 (Non-Reasoning)", contextWindow: 2000000 },
  { id: "grok-composer-2.5-fast", name: "Grok Composer 2.5 Fast", contextWindow: 200000 }
];
const REASONING = {
  efforts: [
    { id: "low", name: "Low" },
    { id: "medium", name: "Medium" },
    { id: "high", name: "High" },
    { id: "xhigh", name: "Extra High" }
  ]
};
async function discoverTokenEndpoint() {
  const res = await fetch("https://auth.x.ai/.well-known/openid-configuration", {
    headers: { accept: "application/json" }
  });
  if (!res.ok)
    throw new Error(`OIDC 发现失败 (HTTP ${res.status})`);
  const meta = await res.json();
  const endpoint = typeof meta?.token_endpoint === "string" ? meta.token_endpoint : undefined;
  if (!endpoint)
    throw new Error("OIDC 发现响应缺少 token_endpoint");
  return endpoint;
}
function decodeJwt(token) {
  const parts = token.split(".");
  if (parts.length !== 3)
    return;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString());
  } catch {
    return;
  }
}
function accountIdFromAccessToken(access) {
  const claims = decodeJwt(access);
  const sub = typeof claims?.sub === "string" && claims.sub !== "" ? claims.sub : undefined;
  return sub ?? (typeof claims?.preferred_username === "string" ? claims.preferred_username : undefined);
}
async function fetchUserinfo(access) {
  try {
    const res = await fetch("https://auth.x.ai/oauth2/userinfo", {
      headers: { authorization: `Bearer ${access}`, accept: "application/json" }
    });
    if (!res.ok)
      return { accountId: accountIdFromAccessToken(access) };
    const info = await res.json();
    const accountId = typeof info?.sub === "string" && info.sub !== "" ? info.sub : accountIdFromAccessToken(access);
    const email = typeof info?.email === "string" ? info.email : undefined;
    return { accountId, email };
  } catch {
    return { accountId: accountIdFromAccessToken(access) };
  }
}
function toStoredToken(json, fallbackRefresh = undefined) {
  const access = typeof json.access_token === "string" ? json.access_token : "";
  if (access === "")
    throw new Error("令牌响应缺少 access_token");
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 600;
  const refresh = typeof json.refresh_token === "string" ? json.refresh_token : fallbackRefresh ?? "";
  return { refresh, access, expires: Date.now() + expiresIn * 1000 };
}
async function exchangeDeviceCode(tokenEndpoint, deviceCode) {
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: CLIENT_ID,
      device_code: deviceCode
    }).toString()
  });
  const body = await res.json().catch(() => ({}));
  if (typeof body?.access_token === "string" && body.access_token !== "") {
    return { status: "complete", value: body };
  }
  switch (body?.error) {
    case "authorization_pending":
      return { status: "pending" };
    case "slow_down":
      return { status: "slow_down" };
    case "access_denied":
      return { status: "failed", message: "用户拒绝了授权" };
    case "expired_token":
      return { status: "failed", message: "设备授权已过期，请重新发起登录" };
    default:
      return {
        status: "failed",
        message: `设备授权失败${body?.error ? `: ${body.error}` : ""}${body?.error_description ? ` (${body.error_description})` : ""}`
      };
  }
}
async function startDeviceFlow() {
  const res = await fetch("https://auth.x.ai/oauth2/device/code", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }).toString()
  });
  if (!res.ok)
    throw new Error(`设备码请求失败 (HTTP ${res.status})`);
  const body = await res.json();
  const deviceCode = typeof body?.device_code === "string" ? body.device_code : "";
  const userCode = typeof body?.user_code === "string" ? body.user_code : "";
  if (!deviceCode || !userCode)
    throw new Error("设备码响应缺少 device_code/user_code");
  return {
    deviceCode,
    intervalSeconds: typeof body?.interval === "number" ? body.interval : 5,
    expiresInSeconds: typeof body?.expires_in === "number" ? body.expires_in : 600,
    verificationUriComplete: typeof body?.verification_uri_complete === "string" ? body.verification_uri_complete : typeof body?.verification_uri === "string" ? body.verification_uri : "",
    userCode
  };
}
async function refreshToken(refresh) {
  const tokenEndpoint = await discoverTokenEndpoint();
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refresh
    }).toString()
  });
  if (!res.ok)
    throw new Error(`令牌续期失败 (HTTP ${res.status})`);
  return toStoredToken(await res.json(), refresh);
}
async function fetchGrokModels(access) {
  const res = await fetch("https://api.x.ai/v1/models", {
    headers: { authorization: `Bearer ${access}`, accept: "application/json" }
  });
  if (!res.ok)
    throw new Error(`模型列表请求失败 (HTTP ${res.status})`);
  const body = await res.json();
  const list = Array.isArray(body?.data) ? body.data : [];
  return list.filter((m) => {
    const id = typeof m?.id === "string" ? m.id : "";
    return id !== "" && !id.startsWith("grok-imagine-") && !id.startsWith("grok-stt-") && !id.startsWith("grok-voice-");
  }).map((m) => ({ id: String(m.id), name: String(m.id) }));
}
export const grokChannel = {
  id: "grok",
  displayName: "Grok (订阅)",
  name: "Grok 订阅",
  description: "用 SuperGrok / X Premium+ 订阅额度访问 Grok 模型（设备授权登录，模型列表登录后自动从官方 API 获取）",
  tokenRefName: "GROK_SUBSCRIPTION_TOKEN",
  defaultApiBaseURL: "https://api.x.ai/v1/responses",
  defaultRedirectPort: 0,
  defaultContextWindow: 1e6,
  defaultMaxTokens: 8192,
  defaultModels: DEFAULT_MODELS,
  reasoning: REASONING,
  create(ctx) {
    let controller;
    let pending;
    const adapter = new ChatGptAdapter({
      options: () => ({
        apiBaseURL: ctx.options().apiBaseURL,
        maxTokens: ctx.options().maxTokens,
        models: ctx.options().models,
        defaultContextWindow: ctx.options().defaultContextWindow
      }),
      reasoning: REASONING,
      resolveAccessToken: async () => {
        const token = await ctx.readToken();
        if (!token) {
          throw new LlmError("grok: 未登录。请在 设置 → 订阅服务 里完成订阅账号授权。", "MISSING_CREDENTIAL");
        }
        if (token.expires - Date.now() < 60000) {
          const refreshed = await refreshToken(token.refresh);
          await ctx.writeToken({ ...token, ...refreshed });
          return { access: refreshed.access };
        }
        return { access: token.access };
      },
      label: "grok",
      displayName: "Grok (订阅)"
    });
    return {
      adapter,
      async login() {
        const existing = await ctx.readToken();
        if (existing && existing.expires > Date.now() + 60000) {
          return { status: "logged-in", account: existing.accountId };
        }
        this.cancelLogin();
        try {
          const flow = await startDeviceFlow();
          const tokenEndpoint = await discoverTokenEndpoint();
          controller = new AbortController;
          pending = { url: flow.verificationUriComplete, userCode: flow.userCode };
          pollDeviceFlow({
            signal: controller.signal,
            intervalSeconds: flow.intervalSeconds,
            expiresInSeconds: flow.expiresInSeconds,
            poll: () => exchangeDeviceCode(tokenEndpoint, flow.deviceCode)
          }).then(async (body) => {
            const base = toStoredToken(body);
            const user = await fetchUserinfo(base.access);
            const stored = {
              ...base,
              ...user.accountId !== undefined ? { accountId: user.accountId } : {},
              ...user.email !== undefined ? { email: user.email } : {}
            };
            await ctx.writeToken(stored);
            ctx.log(`登录成功${stored.accountId ? `（account: ${stored.accountId}）` : ""}，开始发现模型列表…`);
            ctx.afterLogin();
          }).catch((error) => {
            if (controller && !controller.signal.aborted) {
              ctx.log(`登录失败: ${error?.message ?? error}`);
            }
          }).finally(() => {
            pending = undefined;
          });
          if (flow.verificationUriComplete)
            openBrowser(flow.verificationUriComplete);
          return { status: "pending", url: flow.verificationUriComplete, userCode: flow.userCode };
        } catch (error) {
          this.cancelLogin();
          ctx.log(`初始化登录失败: ${error?.message ?? error}`);
          return { status: "pending" };
        }
      },
      async authStatus() {
        const token = await ctx.readToken();
        if (token) {
          return { provider: ctx.id, status: "logged-in", account: token.accountId, expiresAt: token.expires };
        }
        if (pending && controller && !controller.signal.aborted) {
          return { provider: ctx.id, status: "pending", url: pending.url, userCode: pending.userCode };
        }
        return { provider: ctx.id, status: "not-logged-in" };
      },
      async logout() {
        this.cancelLogin();
        await ctx.clearToken();
      },
      cancelLogin() {
        if (controller && !controller.signal.aborted)
          controller.abort();
        controller = undefined;
        pending = undefined;
      },
      async discoverModels() {
        const token = await ctx.readToken();
        if (!token || token.expires - Date.now() < 60000)
          return [];
        try {
          return await fetchGrokModels(token.access);
        } catch (error) {
          ctx.log(`模型列表发现失败: ${error?.message ?? error}`);
          return [];
        }
      }
    };
  }
};
