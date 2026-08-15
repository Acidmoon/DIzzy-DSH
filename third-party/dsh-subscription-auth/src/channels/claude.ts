/**
 * Claude 订阅渠道（Anthropic OAuth）：授权码 + PKCE + localhost 回调，
 * 用 Claude Pro/Max 订阅额度访问 Claude 模型。授权/换码/续期是本渠道专属函数，
 * 推理走 AnthropicMessagesAdapter（../adapters/anthropic.js）。
 * @module dsh-subscription-auth/channels/claude
 */
import { LlmError } from '@deepseek-ai/dsh-llm'
import { AnthropicMessagesAdapter } from '../adapters/anthropic.js'
import type { AdapterModel } from '../adapter.js'
import { generatePkce, generateState, openBrowser, waitForCallback } from '../oauth.js'
import type { ChannelContext, ChannelDefinition, ChannelReasoning, ChannelRuntime } from '../channel.js'
import type { StoredToken } from '../channel.js'

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const AUTHORIZE = 'https://claude.ai/oauth/authorize'
const TOKEN_ENDPOINT = 'https://api.anthropic.com/v1/oauth/token'
const MODELS_ENDPOINT = 'https://api.anthropic.com/v1/models'
const CALLBACK_PATH = '/callback'
const SCOPES =
  'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload'
const RESOLVE_THRESHOLD_MS = 60_000

const defaultModels: AdapterModel[] = [
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', contextWindow: 400_000 },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', contextWindow: 1_000_000 },
  { id: 'claude-fable-5', name: 'Claude Fable 5', contextWindow: 1_000_000 },
  { id: 'claude-mythos-5', name: 'Claude Mythos 5', contextWindow: 1_000_000 },
]

const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_BETA =
  'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,redact-thinking-2026-02-12,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,advanced-tool-use-2025-11-20,effort-2025-11-24,extended-cache-ttl-2025-04-11'

/** 思考强度 → Claude output_config.effort；官方最高档是 max，high 上面还有 xhigh。 */
const REASONING: ChannelReasoning = {
  efforts: [
    { id: 'low', name: 'Low' },
    { id: 'medium', name: 'Medium' },
    { id: 'high', name: 'High' },
    { id: 'xhigh', name: 'Extra High' },
    { id: 'max', name: 'Max' },
  ],
  defaultEffort: 'high',
}

function redirectUri(port: number): string {
  return 'http://localhost:' + port + CALLBACK_PATH
}

function toStoredToken(json: any, fallbackRefresh: string | undefined): StoredToken {
  const access = typeof json.access_token === 'string' ? json.access_token : ''
  if (access === '') throw new Error('token response missing access_token')
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 600
  const refresh = typeof json.refresh_token === 'string' ? json.refresh_token : (fallbackRefresh ?? '')
  return {
    refresh,
    access,
    expires: Date.now() + expiresIn * 1000,
    accountId: json?.account?.uuid,
    email: json?.account?.email_address,
  }
}

function buildAuthorizeUrl(port: number, challenge: string, state: string): string {
  const params = new URLSearchParams({
    code: 'true',
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(port),
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })
  return AUTHORIZE + '?' + params.toString()
}

async function exchangeClaudeCode(code: string, port: number, verifier: string, state: string): Promise<StoredToken> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      state,
      redirect_uri: redirectUri(port),
      code_verifier: verifier,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error('token exchange failed (HTTP ' + res.status + '): ' + text.slice(0, 240))
  }
  return toStoredToken(await res.json(), undefined)
}

async function refreshClaudeToken(refresh: string): Promise<StoredToken> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'anthropic-sdk-typescript/0.94.0 userOAuthProvider',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refresh,
    }),
  })
  if (!res.ok) throw new Error('token refresh failed (HTTP ' + res.status + ')')
  return toStoredToken(await res.json(), refresh)
}

async function fetchClaudeModels(access: string): Promise<AdapterModel[]> {
  const res = await fetch(MODELS_ENDPOINT, {
    method: 'GET',
    headers: {
      authorization: 'Bearer ' + access,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
      'anthropic-beta': ANTHROPIC_BETA,
    },
  })
  if (!res.ok) throw new Error('model list failed (HTTP ' + res.status + ')')
  const json: any = await res.json()
  const data: any[] = Array.isArray(json?.data) ? json.data : []
  return data.map((m) => {
    const id = String(m?.id ?? '')
    const name = typeof m?.display_name === 'string' && m.display_name !== '' ? m.display_name : id
    return id !== '' ? { id, name } : null
  }).filter((m): m is AdapterModel => m !== null)
}

export const claudeChannel: ChannelDefinition = {
  id: 'claude',
  displayName: 'Claude (订阅)',
  name: 'Claude 订阅',
  description: '用 Claude Pro/Max 订阅额度访问 Claude 模型（OAuth 登录，模型列表登录后自动从官方 API 获取）',
  tokenRefName: 'CLAUDE_SUBSCRIPTION_TOKEN',
  defaultApiBaseURL: 'https://api.anthropic.com/v1/messages',
  defaultRedirectPort: 54545,
  defaultContextWindow: 1_000_000,
  defaultMaxTokens: 64000,
  defaultModels,
  reasoning: REASONING,

  create(ctx: ChannelContext): ChannelRuntime {
    let controller: AbortController | undefined
    let pending: { url: string } | undefined

    const adapter = new AnthropicMessagesAdapter({
      options: () => ({
        apiBaseURL: ctx.options().apiBaseURL,
        maxTokens: ctx.options().maxTokens,
        models: ctx.options().models,
        defaultContextWindow: ctx.options().defaultContextWindow,
        headers: () => ({
          'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-beta': ANTHROPIC_BETA,
        }),
      }),
      reasoning: REASONING,
      wireEffort: 'output_config',
      resolveAccessToken: async () => {
        const token = await ctx.readToken()
        if (!token) {
          throw new LlmError('claude: 未登录。请在 设置 → 订阅服务 里完成订阅账号授权。', 'MISSING_CREDENTIAL')
        }
        if (token.expires - Date.now() < RESOLVE_THRESHOLD_MS) {
          const refreshed = await refreshClaudeToken(token.refresh)
          await ctx.writeToken(refreshed)
          return { access: refreshed.access }
        }
        return { access: token.access }
      },
      label: 'claude',
      displayName: 'Claude (订阅)',
    })

    return {
      adapter,

      async login() {
        const existing = await ctx.readToken()
        if (existing && existing.expires > Date.now() + RESOLVE_THRESHOLD_MS) {
          return { status: 'logged-in', account: existing.accountId }
        }
        this.cancelLogin()
        const port = ctx.options().redirectPort
        const { verifier, challenge } = generatePkce()
        const state = generateState()
        const url = buildAuthorizeUrl(port, challenge, state)
        controller = new AbortController()
        pending = { url }
        waitForCallback(port, state, controller.signal, 10 * 60 * 1000, CALLBACK_PATH)
          .then(async (code) => {
            ctx.log('收到授权回调，开始换取令牌…')
            const token = await exchangeClaudeCode(code, port, verifier, state)
            await ctx.writeToken(token)
            ctx.log('登录成功' + (token.accountId !== undefined ? '（account: ' + token.accountId + '）' : '') + '，开始发现模型列表…')
            ctx.afterLogin()
          })
          .catch((error) => {
            if (controller && !controller.signal.aborted) ctx.log('登录失败: ' + (error?.message ?? error))
          })
          .finally(() => {
            pending = undefined
          })
        openBrowser(url)
        return { status: 'pending', url }
      },

      async authStatus() {
        const token = await ctx.readToken()
        if (token) {
          return { provider: ctx.id, status: 'logged-in', account: token.accountId, expiresAt: token.expires }
        }
        if (pending && controller && !controller.signal.aborted) {
          return { provider: ctx.id, status: 'pending', url: pending.url }
        }
        return { provider: ctx.id, status: 'not-logged-in' }
      },

      async logout() {
        this.cancelLogin()
        await ctx.clearToken()
      },

      cancelLogin() {
        if (controller && !controller.signal.aborted) controller.abort()
        controller = undefined
        pending = undefined
      },

      async discoverModels() {
        const token = await ctx.readToken()
        if (!token || token.expires - Date.now() < RESOLVE_THRESHOLD_MS) return []
        try {
          return await fetchClaudeModels(token.access)
        } catch (error) {
          ctx.log('模型列表发现失败: ' + (error?.message ?? error))
          return []
        }
      },
    }
  },
}
