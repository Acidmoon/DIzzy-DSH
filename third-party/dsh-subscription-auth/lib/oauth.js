import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const AUTH_BASE = "https://auth.openai.com";
export const REDIRECT_PORT = 1455;
const SCOPES = "openid profile email offline_access api.connectors.read api.connectors.invoke";
const ORIGINATOR = "pi";
function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function generatePkce() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}
export function generateState() {
  return base64url(randomBytes(32));
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
function accountIdFromClaims(payload) {
  return payload?.chatgpt_account_id ?? payload?.["https://api.openai.com/auth"]?.chatgpt_account_id ?? payload?.organizations?.[0]?.id;
}
function accountIdFromTokens(idToken, access) {
  if (idToken) {
    const fromId = accountIdFromClaims(decodeJwt(idToken));
    if (fromId)
      return fromId;
  }
  if (access)
    return accountIdFromClaims(decodeJwt(access));
  return;
}
export function buildAuthorizeUrl(port, challenge, state) {
  const redirectUri = `http://localhost:${port}/auth/callback`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: ORIGINATOR
  });
  return `${AUTH_BASE}/oauth/authorize?${params.toString()}`;
}
export function openBrowser(url) {
  try {
    const platform = process.platform;
    if (platform === "win32") {
      const child = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], { stdio: "ignore", detached: true });
      child.on("error", () => {});
      child.unref();
      return;
    }
    const cmd = platform === "darwin" ? "open" : "xdg-open";
    const child = spawn(cmd, [url], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {}
}
function toStoredToken(json, fallbackRefresh) {
  const access = typeof json.access_token === "string" ? json.access_token : "";
  if (access === "")
    throw new Error("token response missing access_token");
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 600;
  const idToken = typeof json.id_token === "string" ? json.id_token : undefined;
  const refresh = typeof json.refresh_token === "string" ? json.refresh_token : fallbackRefresh ?? "";
  return {
    refresh,
    access,
    expires: Date.now() + expiresIn * 1000,
    accountId: accountIdFromTokens(idToken, access)
  };
}
export async function exchangeCode(code, port, verifier) {
  const redirectUri = `http://localhost:${port}/auth/callback`;
  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: verifier
    }).toString()
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`token exchange failed (HTTP ${res.status}): ${text.slice(0, 240)}`);
  }
  return toStoredToken(await res.json(), undefined);
}
export async function refreshAccessToken(refresh) {
  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: CLIENT_ID
    }).toString()
  });
  if (!res.ok)
    throw new Error(`token refresh failed (HTTP ${res.status})`);
  return toStoredToken(await res.json(), refresh);
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
export function waitForCallback(port, state, signal, timeoutMs = 10 * 60 * 1000, path = "/auth/callback") {
  return new Promise((resolve, reject) => {
    const server = createServer();
    let settled = false;
    const timer = setTimeout(() => {
      fail(new Error("oauth timed out: 等待授权回调超时"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (err) => {
      if (settled)
        return;
      settled = true;
      cleanup();
      server.close();
      reject(err);
    };
    const done = (code) => {
      if (settled)
        return;
      settled = true;
      cleanup();
      server.close();
      resolve(code);
    };
    const onAbort = () => fail(new Error("aborted"));
    if (signal) {
      if (signal.aborted) {
        fail(new Error("aborted"));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    server.on("request", (req, res) => {
      const u = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (u.pathname !== path) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const error = u.searchParams.get("error");
      if (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h1>登录失败</h1><p>${escapeHtml(error)}</p>`);
        fail(new Error(`oauth error: ${error}`));
        return;
      }
      const code = u.searchParams.get("code");
      const st = u.searchParams.get("state");
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>缺少授权码</h1>");
        return;
      }
      if (st !== state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>state 不匹配</h1>");
        fail(new Error("oauth state mismatch"));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>登录成功</h1><p>可以关闭此页面，回到 dsh 继续。</p>");
      done(code);
    });
    server.on("error", (err) => {
      fail(new Error(`localhost:${port} 启动失败：${err.message}（端口被占用？）`));
    });
    server.listen(port, "127.0.0.1");
  });
}
