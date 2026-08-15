/**
 * ChatGPT 订阅渠道（codex Responses API）：复用 oauth.ts / discovery.ts / adapter.ts
 * 的 OAuth（授权码 + PKCE + localhost 回调）、模型发现与 Responses API 适配器。
 * @module dsh-subscription-auth/channels/chatgpt
 */
import { LlmError } from '@deepseek-ai/dsh-llm'
import { ChatGptAdapter } from '../adapter.js'
import type { AdapterModel } from '../adapter.js'
import {
  buildAuthorizeUrl,
  exchangeCode,
  generatePkce,
  generateState,
  openBrowser,
  refreshAccessToken,
  waitForCallback,
} from '../oauth.js'
import { fetchCodexModels } from '../discovery.js'
import type { ChannelContext, ChannelDefinition, ChannelReasoning, ChannelRuntime } from '../channel.js'

const DEFAULT_MODELS: AdapterModel[] = [
  { id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 400_000 },
  { id: 'gpt-5.4', name: 'GPT-5.4', contextWindow: 400_000 },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', contextWindow: 400_000 },
  { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark', contextWindow: 400_000 },
  { id: 'gpt-5.5-pro', name: 'GPT-5.5 Pro', contextWindow: 400_000 },
]

/** codex Responses API 的 reasoning.effort：官方最高档是 max，high 上面还有 xhigh。 */
const REASONING: ChannelReasoning = {
  efforts: [
    { id: 'minimal', name: 'Minimal' },
    { id: 'low', name: 'Low' },
    { id: 'medium', name: 'Medium' },
    { id: 'high', name: 'High' },
    { id: 'xhigh', name: 'Extra High' },
    { id: 'max', name: 'Max' },
  ],
  defaultEffort: 'medium',
}

export const chatgptChannel: ChannelDefinition = {
  id: 'chatgpt',
  displayName: 'ChatGPT (订阅)',
  name: 'ChatGPT 订阅',
  description: '用 ChatGPT Plus/Pro 订阅额度访问 codex 系模型（模型列表登录后自动从官方 API 获取）',
  tokenRefName: 'CHATGPT_SUBSCRIPTION_TOKEN',
  defaultApiBaseURL: 'https://chatgpt.com/backend-api/codex/responses',
  defaultRedirectPort: 1455,
  defaultContextWindow: 400_000,
  defaultMaxTokens: 8192,
  defaultModels: DEFAULT_MODELS,
  reasoning: REASONING,

  create(ctx: ChannelContext): ChannelRuntime {
    let controller: AbortController | undefined
    let pending: { url: string } | undefined

    const adapter = new ChatGptAdapter({
      options: () => ({
        apiBaseURL: ctx.options().apiBaseURL,
        maxTokens: ctx.options().maxTokens,
        models: ctx.options().models,
        defaultContextWindow: ctx.options().defaultContextWindow,
      }),
      reasoning: REASONING,
      resolveAccessToken: async () => {
        const token = await ctx.readToken()
        if (!token) {
          throw new LlmError('chatgpt: 未登录。请在 设置 → 订阅服务 里完成订阅账号授权。', 'MISSING_CREDENTIAL')
        }
        if (token.expires - Date.now() < 60_000) {
          const refreshed = await refreshAccessToken(token.refresh)
          await ctx.writeToken(refreshed)
          return { access: refreshed.access }
        }
        return { access: token.access }
      },
      label: 'chatgpt',
      displayName: 'ChatGPT (订阅)',
    })

    return {
      adapter,

      async login() {
        const existing = await ctx.readToken()
        if (existing && existing.expires > Date.now() + 60_000) {
          return { status: 'logged-in', account: existing.accountId }
        }
        this.cancelLogin()
        const port = ctx.options().redirectPort
        const { verifier, challenge } = generatePkce()
        const state = generateState()
        const url = buildAuthorizeUrl(port, challenge, state)
        controller = new AbortController()
        pending = { url }
        waitForCallback(port, state, controller.signal)
          .then(async (code) => {
            ctx.log('收到授权回调，开始换取令牌…')
            const token = await exchangeCode(code, port, verifier)
            await ctx.writeToken(token)
            ctx.log(`登录成功${token.accountId ? `（account: ${token.accountId}）` : ''}，开始发现模型列表…`)
            ctx.afterLogin()
          })
          .catch((error) => {
            if (controller && !controller.signal.aborted) ctx.log(`登录失败: ${error?.message ?? error}`)
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
        if (!token || token.expires - Date.now() < 60_000) return []
        try {
          return await fetchCodexModels(
            token.access,
            token.accountId,
            ctx.options().apiBaseURL.replace(/\/codex\/responses$/, ''),
          )
        } catch (error) {
          ctx.log(`模型列表发现失败: ${error?.message ?? error}`)
          return []
        }
      },
    }
  },
}
