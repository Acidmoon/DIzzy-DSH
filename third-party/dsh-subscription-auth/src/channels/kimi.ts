/**
 * Kimi Code 订阅渠道（RFC 8628 设备授权流 + Anthropic Messages API）：
 * 用 Kimi 订阅额度访问 kimi 系模型。OAuth 走设备授权码（pollDeviceFlow），
 * 推理默认走 Anthropic Messages API（api.kimi.com/coding/v1/messages）。
 * @module dsh-subscription-auth/channels/kimi
 */
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { AnthropicMessagesAdapter } from '../adapters/anthropic.js'
import type { AdapterModel } from '../adapter.js'
import { pollDeviceFlow } from '../device-flow.js'
import { openBrowser } from '../oauth.js'
import type { ChannelContext, ChannelDefinition, ChannelReasoning, ChannelRuntime, StoredToken } from '../channel.js'

const AUTH_BASE = 'https://auth.kimi.com'
const DEVICE_AUTHORIZATION_URL = 'https://auth.kimi.com/api/oauth/device_authorization'
const TOKEN_URL = 'https://auth.kimi.com/api/oauth/token'
const MODELS_URL = 'https://api.kimi.com/coding/v1/models'

const CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098'

const DEFAULT_MODELS: AdapterModel[] = [
  { id: 'kimi-for-coding', name: 'Kimi For Coding', contextWindow: 128_000 },
  { id: 'kimi-for-coding-highspeed', name: 'Kimi For Coding Highspeed', contextWindow: 128_000 },
  { id: 'k3', name: 'Kimi K3', contextWindow: 1_048_576 },
  { id: 'k3-256k', name: 'Kimi K3 256K', contextWindow: 262_144 },
  { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', contextWindow: 262_144 },
  { id: 'kimi-k2.6', name: 'Kimi K2.6', contextWindow: 262_144 },
  { id: 'kimi-k2.5', name: 'Kimi K2.5', contextWindow: 262_144 },
]

/** 思考强度 → 顶层 reasoning_effort；K3 官方是 low / high / max，默认 max。 */
const REASONING: ChannelReasoning = {
  efforts: [
    { id: 'low', name: 'Low' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max' },
  ],
  defaultEffort: 'max',
}

/** 进程内稳定的通用请求头（device id 只生成一次并缓存）。 */
let deviceId: string | undefined
function kimiCommonHeaders(): Record<string, string> {
  if (deviceId === undefined) {
    deviceId = randomUUID().replace(/-/g, '')
  }
  return {
    'User-Agent': 'KimiCLI/1.0',
    'X-Msh-Platform': 'kimi_cli',
    'X-Msh-Version': '1.0',
    'X-Msh-Device-Name': os.hostname(),
    'X-Msh-Device-Model': `${os.platform()} ${os.release()} ${os.arch()}`,
    'X-Msh-Os-Version': os.release(),
    'X-Msh-Device-Id': deviceId,
  }
}

interface DeviceAuthorization {
  user_code: string
  device_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

async function postForm(url: string, body: Record<string, string>, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: new URLSearchParams(body).toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 240)}`)
  }
  return res.json()
}

/** 设备授权轮询返回的令牌 JSON 转 StoredToken。 */
function toStoredToken(json: any, fallbackRefresh?: string): StoredToken {
  const access = typeof json.access_token === 'string' ? json.access_token : ''
  if (access === '') throw new Error('token response missing access_token')
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 600
  const refresh = typeof json.refresh_token === 'string' ? json.refresh_token : (fallbackRefresh ?? '')
  return {
    refresh,
    access,
    expires: Date.now() + expiresIn * 1000,
  }
}

async function requestDeviceAuthorization(): Promise<DeviceAuthorization> {
  const json = await postForm(DEVICE_AUTHORIZATION_URL, { client_id: CLIENT_ID }, kimiCommonHeaders())
  return {
    user_code: String(json.user_code ?? ''),
    device_code: String(json.device_code ?? ''),
    verification_uri: String(json.verification_uri ?? ''),
    verification_uri_complete: String(json.verification_uri_complete ?? json.verification_uri ?? ''),
    expires_in: typeof json.expires_in === 'number' ? json.expires_in : 600,
    interval: typeof json.interval === 'number' ? json.interval : 5,
  }
}

async function pollToken(
  device: { device_code: string; expires_in: number; interval: number },
  signal?: AbortSignal,
): Promise<StoredToken> {
  return pollDeviceFlow({
    signal,
    expiresInSeconds: device.expires_in,
    intervalSeconds: device.interval,
    poll: async () => {
      let json: any
      try {
        json = await postForm(
          TOKEN_URL,
          {
            client_id: CLIENT_ID,
            device_code: device.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          },
          kimiCommonHeaders(),
        )
      } catch (error) {
        // 瞬时网络错误视为 pending，继续轮询（轮询在 pollDeviceFlow 里不视为失败）
        return { status: 'pending' }
      }
      if (json.access_token) {
        return { status: 'complete', value: toStoredToken(json, undefined) }
      }
      if (json.error === 'authorization_pending') return { status: 'pending' }
      if (json.error === 'slow_down') return { status: 'slow_down' }
      if (json.error === 'expired_token' || json.error === 'access_denied') {
        return { status: 'failed', message: `device authorization ${json.error}` }
      }
      // 未知错误：视为 failed 以便尽快向用户反馈
      return { status: 'failed', message: `device authorization error: ${String(json.error)}` }
    },
  })
}

async function refreshAccessTokenInternal(refresh: string): Promise<StoredToken> {
  const json = await postForm(
    TOKEN_URL,
    { grant_type: 'refresh_token', refresh_token: refresh, client_id: CLIENT_ID },
    kimiCommonHeaders(),
  )
  return toStoredToken(json, refresh)
}

async function fetchModels(access: string): Promise<AdapterModel[]> {
  const res = await fetch(MODELS_URL, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${access}`,
      ...kimiCommonHeaders(),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`models fetch failed (HTTP ${res.status}): ${text.slice(0, 240)}`)
  }
  const json: any = await res.json()
  const data: any[] = Array.isArray(json?.data) ? json.data : []
  return data.map((m: any) => {
    const id: string = typeof m?.id === 'string' ? m.id : ''
    if (id === '') return undefined
    const base: AdapterModel = {
      id,
      name: typeof m?.display_name === 'string' && m.display_name !== '' ? m.display_name : id,
    }
    if (typeof m?.context_length === 'number') base.contextWindow = m.context_length
    return base
  }).filter((m: AdapterModel | undefined): m is AdapterModel => m !== undefined)
}

export const kimiChannel: ChannelDefinition = {
  id: 'kimi',
  displayName: 'Kimi (订阅)',
  name: 'Kimi 订阅',
  description: '用 Kimi Code 订阅额度访问 Kimi 模型（设备授权登录，模型列表登录后自动从官方 API 获取）',
  tokenRefName: 'KIMI_SUBSCRIPTION_TOKEN',
  defaultApiBaseURL: 'https://api.kimi.com/coding/v1/messages',
  defaultRedirectPort: 0,
  defaultContextWindow: 262_144,
  defaultMaxTokens: 32_768,
  defaultModels: DEFAULT_MODELS,
  reasoning: REASONING,

  create(ctx: ChannelContext): ChannelRuntime {
    let controller: AbortController | undefined
    let pending: { url: string; userCode: string } | undefined

    const adapter = new AnthropicMessagesAdapter({
      options: () => ({
        apiBaseURL: ctx.options().apiBaseURL,
        maxTokens: ctx.options().maxTokens,
        models: ctx.options().models,
        defaultContextWindow: ctx.options().defaultContextWindow,
        headers: () => kimiCommonHeaders(),
      }),
      reasoning: REASONING,
      wireEffort: 'reasoning_effort',
      resolveAccessToken: async () => {
        const token = await ctx.readToken()
        if (!token) {
          throw new LlmError('kimi: 未登录。请在 设置 → 订阅服务 里完成订阅账号授权。', 'MISSING_CREDENTIAL')
        }
        if (token.expires - Date.now() < 60_000) {
          const refreshed = await refreshAccessTokenInternal(token.refresh)
          await ctx.writeToken(refreshed)
          return { access: refreshed.access }
        }
        return { access: token.access }
      },
      label: 'kimi',
      displayName: 'Kimi (订阅)',
    })

    return {
      adapter,

      async login() {
        const existing = await ctx.readToken()
        if (existing && existing.expires > Date.now() + 60_000) {
          return { status: 'logged-in', account: existing.accountId }
        }
        this.cancelLogin()
        const device = await requestDeviceAuthorization()
        controller = new AbortController()
        pending = { url: device.verification_uri_complete, userCode: device.user_code }
        if (device.verification_uri_complete) openBrowser(device.verification_uri_complete)
        pollToken(device, controller.signal)
          .then(async (token) => {
            await ctx.writeToken(token)
            ctx.log(`Kimi 登录成功，开始发现模型列表…`)
            ctx.afterLogin()
          })
          .catch((error) => {
            if (controller && !controller.signal.aborted) {
              ctx.log(`Kimi 登录失败: ${error?.message ?? error}`)
            }
          })
          .finally(() => {
            pending = undefined
          })
        return {
          status: 'pending',
          url: device.verification_uri_complete,
          userCode: device.user_code,
        }
      },

      async authStatus() {
        const token = await ctx.readToken()
        if (token) {
          return { provider: ctx.id, status: 'logged-in', account: token.accountId, expiresAt: token.expires }
        }
        if (pending && controller && !controller.signal.aborted) {
          return { provider: ctx.id, status: 'pending', url: pending.url, userCode: pending.userCode }
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
          return await fetchModels(token.access)
        } catch (error) {
          ctx.log(`Kimi 模型列表发现失败: ${error?.message ?? error}`)
          return []
        }
      },
    }
  },
}
