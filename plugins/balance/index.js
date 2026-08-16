/**
 * dizzy-dsh-balance 插件(Host 端)
 *
 * 职责:
 *   1. 按 refreshIntervalMs 刷新 DeepSeek 官方 CNY 余额
 *      (credentials 取 credentialName 指定的引用)
 *   2. 从订阅插件写入的 GROK_SUBSCRIPTION_TOKEN 取 OAuth 令牌,
 *      刷新 CLI `GET {proxy}/billing?format=credits`(周额度,与人民币余额分账)
 *   3. GET /dizzy/balance、GET /dizzy/grok-quota —— Client 同源取数
 *   4. 模型可见工具 balance_check / grok_quota_check
 *
 * Client 半区见 client.js:输入栏同一位置的徽章,按当前模型切换 ¥ / 剩余%。
 */
import Schema from 'schemastery'
import {
  formatQuotaText,
  parseCreditsResponse,
  parseStoredToken,
  toRefreshedToken,
} from './grok-parse.js'

/** 可调配置(loader 挂载时校验;settings 命名空间复用同一 schema)。 */
const Config = Schema.object({
  /** DeepSeek credentials 引用名。 */
  credentialName: Schema.string().default('DEEPSEEK_API_KEY'),
  /** Grok 订阅令牌引用名;默认对接订阅插件 grok 渠道。 */
  grokCredentialName: Schema.string().default('GROK_SUBSCRIPTION_TOKEN'),
  /** 刷新间隔(毫秒),5s ~ 1h。DeepSeek 与 Grok 共用。 */
  refreshIntervalMs: Schema.number().min(5000).max(3600000).default(60000),
  /** CLI chat-proxy 根(含 /v1);企业部署可覆盖。 */
  grokBillingBaseURL: Schema.string().default('https://cli-chat-proxy.grok.com/v1'),
  /** 公开 OIDC client id;与订阅插件 grok 渠道一致。 */
  grokOidcClientId: Schema.string().default('b1a00492-073a-47ea-816f-4c329264a828'),
})

const SETTINGS_NS = 'dizzy-balance'

const BALANCE_API = 'https://api.deepseek.com/user/balance'
const TOKEN_AUTH_HEADER = 'xai-grok-cli'
const OIDC_DISCOVERY = 'https://auth.x.ai/.well-known/openid-configuration'
const DEFAULT_TOKEN_ENDPOINT = 'https://auth.x.ai/oauth2/token'

function isSameOriginRequest(req) {
  const fetchSite = req.headers['sec-fetch-site']
  if (fetchSite === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  const host = req.headers.host
  if (host === undefined) return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host
  } catch {
    return false
  }
}

const emptyGrok = () => ({
  status: 'unauthenticated',
  creditUsagePercent: null,
  remainingPercent: null,
  periodStart: null,
  periodEnd: null,
  periodType: null,
  subscriptionTier: null,
  prepaidBalanceCents: null,
  isUnified: null,
  onDemandEnabled: null,
  products: [],
  error: null,
  at: 0,
})

function publicGrok(cache) {
  return {
    status: cache.status,
    creditUsagePercent: cache.creditUsagePercent,
    remainingPercent: cache.remainingPercent,
    periodStart: cache.periodStart,
    periodEnd: cache.periodEnd,
    periodType: cache.periodType,
    subscriptionTier: cache.subscriptionTier,
    prepaidBalanceCents: cache.prepaidBalanceCents,
    isUnified: cache.isUnified,
    onDemandEnabled: cache.onDemandEnabled,
    error: cache.error,
    at: cache.at,
  }
}

function jsonRoute(res, payload, status = 200) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

export default {
  name: 'dizzy-dsh-balance',
  inject: ['credentials', 'timer', 'tools', 'webServer'],
  Config,
  apply(ctx, config) {
    const settings = ctx.get('settings')
    const scope = settings === undefined
      ? undefined
      : settings.register(SETTINGS_NS, Config, { base: config })
    const current = () => (scope === undefined ? config : scope.get())

    let dsCache = { balanceCny: null, isAvailable: false, error: null, at: 0 }
    let grokCache = emptyGrok()
    let stopTimer = null
    let tokenEndpoint = DEFAULT_TOKEN_ENDPOINT
    let refreshInFlight = null
    let quotaInFlight = null
    let quotaAgain = false
    let disposed = false

    const refreshDeepSeek = async () => {
      const cfg = current()
      try {
        const resolved = await ctx.credentials.resolve(cfg.credentialName)
        if (resolved === undefined) {
          dsCache = { balanceCny: null, isAvailable: false, error: `未配置 ${cfg.credentialName}`, at: Date.now() }
          return
        }
        const response = await fetch(BALANCE_API, {
          headers: { authorization: `Bearer ${resolved.value}` },
          signal: AbortSignal.timeout(15000),
        })
        if (!response.ok) {
          dsCache = { balanceCny: null, isAvailable: false, error: `HTTP ${response.status}`, at: Date.now() }
          return
        }
        const data = await response.json()
        const cny = (data.balance_infos ?? []).find((b) => b.currency === 'CNY')
        dsCache = {
          balanceCny: cny === undefined ? null : Number(cny.total_balance),
          isAvailable: data.is_available === true,
          error: null,
          at: Date.now(),
        }
      } catch (err) {
        dsCache = {
          balanceCny: null,
          isAvailable: false,
          error: String(err === null || err === undefined ? '' : err.message ?? err),
          at: Date.now(),
        }
      }
    }

    const discoverTokenEndpoint = async () => {
      try {
        const res = await fetch(OIDC_DISCOVERY, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(10000),
        })
        if (!res.ok) return
        const meta = await res.json()
        if (typeof meta?.token_endpoint === 'string' && meta.token_endpoint !== '') {
          tokenEndpoint = meta.token_endpoint
        }
      } catch {
        // 发现失败沿用 DEFAULT_TOKEN_ENDPOINT。
      }
    }

    const readGrokToken = async () => {
      const resolved = await ctx.credentials.resolve(current().grokCredentialName)
      if (resolved === undefined) return undefined
      return parseStoredToken(resolved.value)
    }

    const persistGrokToken = async (startedFrom, next) => {
      try {
        const latest = await readGrokToken()
        if (latest === undefined) return { ...startedFrom, ...next }
        if (latest.refresh !== startedFrom.refresh) return { ...latest }
        const stored = { ...latest, ...next }
        await ctx.credentials.set(current().grokCredentialName, JSON.stringify(stored))
        return stored
      } catch {
        return { ...startedFrom, ...next }
      }
    }

    const refreshAccess = async (token) => {
      if (refreshInFlight !== null) return refreshInFlight
      refreshInFlight = (async () => {
        await discoverTokenEndpoint()
        const cfg = current()
        const res = await fetch(tokenEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: cfg.grokOidcClientId,
            refresh_token: token.refresh,
          }).toString(),
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) {
          const err = new Error(`令牌续期失败 (HTTP ${res.status})`)
          err.code = res.status === 400 || res.status === 401 ? 'reauth' : 'refresh'
          throw err
        }
        const next = toRefreshedToken(await res.json(), token.refresh)
        return persistGrokToken(token, next)
      })().finally(() => {
        refreshInFlight = null
      })
      return refreshInFlight
    }

    const ensureAccess = async (token) => {
      if (token.expires - Date.now() < 60_000) return refreshAccess(token)
      return token
    }

    const billingHeaders = (token) => ({
      authorization: `Bearer ${token.access}`,
      'x-xai-token-auth': TOKEN_AUTH_HEADER,
      'x-grok-client-mode': 'interactive',
      accept: 'application/json',
    })

    const fetchJson = async (url, token) => fetch(url, {
      headers: billingHeaders(token),
      signal: AbortSignal.timeout(15000),
    })

    const fetchSettingsTier = async (base, token) => {
      try {
        const res = await fetchJson(`${base}/settings`, token)
        if (!res.ok) return null
        const body = await res.json()
        const rec = body !== null && typeof body === 'object'
          ? /** @type {Record<string, unknown>} */ (body)
          : {}
        if (typeof rec.subscription_tier_display === 'string' && rec.subscription_tier_display !== '') {
          return rec.subscription_tier_display
        }
        if (typeof rec.subscriptionTier === 'string' && rec.subscriptionTier !== '') {
          return rec.subscriptionTier
        }
      } catch {
        // settings 失败不影响额度主路径。
      }
      return null
    }

    const fetchCredits = async (base, token) => {
      const res = await fetchJson(`${base}/billing?format=credits`, token)
      const text = await res.text()
      let body = null
      try {
        body = text === '' ? null : JSON.parse(text)
      } catch {
        body = null
      }
      return { res, body }
    }

    const refreshGrokOnce = async () => {
      if (disposed) return
      try {
        const token0 = await readGrokToken()
        if (token0 === undefined) {
          grokCache = { ...emptyGrok(), error: '未登录 Grok 订阅', at: Date.now() }
          return
        }
        let token = await ensureAccess(token0)
        const base = current().grokBillingBaseURL.replace(/\/+$/, '')
        let { res, body } = await fetchCredits(base, token)
        if (res.status === 401) {
          token = await refreshAccess(token)
          ;({ res, body } = await fetchCredits(base, token))
        }
        if (!res.ok) {
          if (res.status === 401) {
            grokCache = {
              ...emptyGrok(),
              error: '登录已失效,请在设置 → 订阅服务重新登录 Grok',
              at: Date.now(),
            }
            return
          }
          const detail = body !== null && typeof body === 'object' && typeof body.error === 'string'
            ? body.error
            : `HTTP ${res.status}`
          grokCache = { ...emptyGrok(), status: 'error', error: detail, at: Date.now() }
          return
        }
        const tier = await fetchSettingsTier(base, token)
        grokCache = { ...parseCreditsResponse(body, { subscriptionTier: tier }), error: null, at: Date.now() }
      } catch (err) {
        const reauth = err !== null && typeof err === 'object' && err.code === 'reauth'
        grokCache = {
          ...emptyGrok(),
          status: reauth ? 'unauthenticated' : 'error',
          error: reauth
            ? '登录已失效,请在设置 → 订阅服务重新登录 Grok'
            : String(err === null || err === undefined ? '' : err.message ?? err),
          at: Date.now(),
        }
      }
    }

    const refreshGrok = async () => {
      if (disposed) return
      if (quotaInFlight !== null) {
        quotaAgain = true
        return quotaInFlight
      }
      const run = async () => {
        await refreshGrokOnce()
        while (quotaAgain && !disposed) {
          quotaAgain = false
          await refreshGrokOnce()
        }
      }
      quotaInFlight = run().finally(() => {
        quotaInFlight = null
      })
      return quotaInFlight
    }

    const refreshAll = () => {
      void refreshDeepSeek()
      void refreshGrok()
    }

    const startTimer = () => {
      stopTimer = ctx.interval(refreshAll, current().refreshIntervalMs)
    }

    refreshAll()
    startTimer()

    let previous = current()
    const stopWatch = scope === undefined
      ? () => {}
      : scope.watch((next) => {
          if (next.refreshIntervalMs !== previous.refreshIntervalMs) {
            stopTimer?.()
            startTimer()
          }
          if (next.credentialName !== previous.credentialName) void refreshDeepSeek()
          if (
            next.grokCredentialName !== previous.grokCredentialName
            || next.grokBillingBaseURL !== previous.grokBillingBaseURL
            || next.grokOidcClientId !== previous.grokOidcClientId
          ) {
            void refreshGrok()
          }
          previous = next
        })

    const stopCredWatch = typeof ctx.on === 'function'
      ? ctx.on('credentials/updated', (ref) => {
          const name = String(ref)
          const cfg = current()
          if (name === cfg.credentialName) void refreshDeepSeek()
          if (name === cfg.grokCredentialName) void refreshGrok()
        })
      : () => {}

    const stopDsRoute = ctx.webServer.register({
      kind: 'exact',
      path: '/dizzy/balance',
      handler: async (req, res) => {
        if (!isSameOriginRequest(req)) {
          jsonRoute(res, { error: 'forbidden: cross-site request' }, 403)
          return
        }
        jsonRoute(res, dsCache)
      },
    })

    const stopGrokRoute = ctx.webServer.register({
      kind: 'exact',
      path: '/dizzy/grok-quota',
      handler: async (req, res) => {
        if (!isSameOriginRequest(req)) {
          jsonRoute(res, { error: 'forbidden: cross-site request' }, 403)
          return
        }
        jsonRoute(res, publicGrok(grokCache))
      },
    })

    const disposeDsTool = ctx.tools.register({
      name: 'balance_check',
      description: '查询当前 DeepSeek 官方账户的余额(人民币)。',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render(_args, value) {
          return [{ type: 'text', text: String(value) }]
        },
      },
      async execute() {
        const cny = dsCache.balanceCny
        if (dsCache.error) return `余额查询失败: ${dsCache.error}`
        if (cny === null) return '余额暂未获取到,请稍后重试'
        return `DeepSeek 账户余额: ¥${cny.toFixed(2)}(更新于 ${new Date(dsCache.at).toLocaleTimeString()})`
      },
    })

    const disposeGrokTool = ctx.tools.register({
      name: 'grok_quota_check',
      description: '查询当前 Grok 订阅账户的额度(已用/剩余百分比与重置时间;统一账本多为周额度)。凭证来自设置里的 Grok 订阅登录,不消耗额度。',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render(_args, value) {
          return [{ type: 'text', text: String(value) }]
        },
      },
      async execute() {
        await refreshGrok()
        return formatQuotaText(grokCache)
      },
    })

    return () => {
      disposed = true
      quotaAgain = false
      stopWatch()
      stopCredWatch()
      stopTimer?.()
      stopDsRoute()
      stopGrokRoute()
      disposeDsTool()
      disposeGrokTool()
    }
  },
}
