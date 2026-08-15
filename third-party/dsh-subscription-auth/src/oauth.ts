/**
 * ChatGPT（codex）订阅 OAuth：授权码 + PKCE + localhost 回调。
 *
 * 常量以 omp（@oh-my-pi/pi-coding-agent）的实现为准（2026-08 实测可登录），
 * 与 opencode 的差异只有两处：scope 多了 `api.connectors.read
 * api.connectors.invoke`（opencode 的旧 scope 会被 auth.openai.com 以
 * missing_required_parameter 拒绝），originator 用 `pi`：
 *   - client_id:   app_EMoamEEZ73f0CkXaXp7hrann
 *   - 授权端点:     https://auth.openai.com/oauth/authorize
 *   - 令牌端点:     https://auth.openai.com/oauth/token
 *   - scope:        openid profile email offline_access
 *                   api.connectors.read api.connectors.invoke
 *   - redirect_uri: http://localhost:1455/auth/callback
 *   - 额外参数:     code_challenge(S256) / id_token_add_organizations /
 *                   codex_cli_simplified_flow / originator=pi
 *
 * 返回的 access_token 用于调用 ChatGPT 后端 codex Responses API
 * （默认 https://chatgpt.com/backend-api/codex/responses）。
 * @module dsh-subscription-auth/oauth
 */
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'

export const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const AUTH_BASE = 'https://auth.openai.com'
export const REDIRECT_PORT = 1455
/** omp 使用的完整 scope 集合；缺 `api.connectors.*` 会被端点拒绝。 */
const SCOPES = 'openid profile email offline_access api.connectors.read api.connectors.invoke'
/** omp（pi-coding-agent）的 originator 值。 */
const ORIGINATOR = 'pi'

/** 持久化在 credential 里的令牌（JSON 字符串）。 */
export interface StoredToken {
  refresh: string
  access: string
  /** epoch 毫秒。 */
  expires: number
  accountId?: string
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/**
 * 独立随机的 OAuth state。必须与 code_verifier 分离:授权 URL 会携带 state
 * 出现在浏览器地址栏/历史记录,若 state 复用 verifier,能看到授权 URL 的人
 * (或本地端口抢占后截获回调的攻击者)可直接解 PKCE 并兑换令牌。
 */
export function generateState(): string {
  return base64url(randomBytes(32))
}

function decodeJwt(token: string): any | undefined {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  } catch {
    return undefined
  }
}

function accountIdFromClaims(payload: any): string | undefined {
  return payload?.chatgpt_account_id
    ?? payload?.['https://api.openai.com/auth']?.chatgpt_account_id
    ?? payload?.organizations?.[0]?.id
}

function accountIdFromTokens(idToken?: string, access?: string): string | undefined {
  if (idToken) {
    const fromId = accountIdFromClaims(decodeJwt(idToken))
    if (fromId) return fromId
  }
  if (access) return accountIdFromClaims(decodeJwt(access))
  return undefined
}

export function buildAuthorizeUrl(port: number, challenge: string, state: string): string {
  const redirectUri = `http://localhost:${port}/auth/callback`
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state,
    originator: ORIGINATOR,
  })
  return `${AUTH_BASE}/oauth/authorize?${params.toString()}`
}

export function openBrowser(url: string): void {
  try {
    const platform = process.platform
    if (platform === 'win32') {
      // Windows: 不能用 `cmd /c start`（URL 里的 `&` 会被 cmd 当命令分隔符
      // 截断参数），也不能用 explorer.exe（带 `?` 的 URL 会被当本地文件
      // 路径）。rundll32 url.dll,FileProtocolHandler 是 CreateProcess 直传
      // 参数、不经 shell 解析，正确处理任意 URL。
      const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { stdio: 'ignore', detached: true })
      child.on('error', () => {})
      child.unref()
      return
    }
    const cmd = platform === 'darwin' ? 'open' : 'xdg-open'
    const child = spawn(cmd, [url], { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
  } catch {
    /* 打不开浏览器也不致命——页面里会回显 URL 供用户手动打开 */
  }
}

function toStoredToken(json: any, fallbackRefresh: string | undefined): StoredToken {
  const access = typeof json.access_token === 'string' ? json.access_token : ''
  if (access === '') throw new Error('token response missing access_token')
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 600
  const idToken = typeof json.id_token === 'string' ? json.id_token : undefined
  const refresh = typeof json.refresh_token === 'string' ? json.refresh_token : (fallbackRefresh ?? '')
  return {
    refresh,
    access,
    expires: Date.now() + expiresIn * 1000,
    accountId: accountIdFromTokens(idToken, access),
  }
}

export async function exchangeCode(code: string, port: number, verifier: string): Promise<StoredToken> {
  const redirectUri = `http://localhost:${port}/auth/callback`
  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }).toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`token exchange failed (HTTP ${res.status}): ${text.slice(0, 240)}`)
  }
  return toStoredToken(await res.json(), undefined)
}

export async function refreshAccessToken(refresh: string): Promise<StoredToken> {
  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: CLIENT_ID,
    }).toString(),
  })
  if (!res.ok) throw new Error(`token refresh failed (HTTP ${res.status})`)
  return toStoredToken(await res.json(), refresh)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

/**
 * 启动一次性 localhost HTTP 服务器，等待浏览器回调返回授权码。
 * 收到 code 且 state 匹配时 resolve；用户取消 / 信号中止 / 端口被占 /
 * 超过 `timeoutMs` 未回调时 reject。
 */
export function waitForCallback(
  port: number,
  state: string,
  signal?: AbortSignal,
  timeoutMs = 10 * 60 * 1000,
  path = '/auth/callback',
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const server: Server = createServer()
    let settled = false
    const timer = setTimeout(() => {
      fail(new Error('oauth timed out: 等待授权回调超时'))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const fail = (err: Error) => {
      if (settled) return
      settled = true
      cleanup()
      server.close()
      reject(err)
    }
    const done = (code: string) => {
      if (settled) return
      settled = true
      cleanup()
      server.close()
      resolve(code)
    }
    const onAbort = () => fail(new Error('aborted'))
    if (signal) {
      if (signal.aborted) { fail(new Error('aborted')); return }
      signal.addEventListener('abort', onAbort, { once: true })
    }
    server.on('request', (req, res) => {
      const u = new URL(req.url ?? '/', `http://localhost:${port}`)
      if (u.pathname !== path) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      const error = u.searchParams.get('error')
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<h1>登录失败</h1><p>${escapeHtml(error)}</p>`)
        fail(new Error(`oauth error: ${error}`))
        return
      }
      const code = u.searchParams.get('code')
      const st = u.searchParams.get('state')
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<h1>缺少授权码</h1>')
        return
      }
      if (st !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<h1>state 不匹配</h1>')
        fail(new Error('oauth state mismatch'))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<h1>登录成功</h1><p>可以关闭此页面，回到 dsh 继续。</p>')
      done(code)
    })
    server.on('error', (err: Error) => {
      fail(new Error(`localhost:${port} 启动失败：${err.message}（端口被占用？）`))
    })
    server.listen(port, '127.0.0.1')
  })
}
