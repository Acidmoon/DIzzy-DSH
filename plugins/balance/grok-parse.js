/**
 * Grok CLI `GET {proxy}/billing?format=credits` 响应的纯解析。
 *
 * 账本契约(与 xai-org/grok-build billing.rs 对齐):
 *   - 优先 `config.creditUsagePercent` + `config.currentPeriod`
 *   - 省略 percent 但 period 有效 = 真实 0%(proto3 省略零标量)
 *   - 有 period 时绝不回落到 deprecated 的 monthlyLimit/used(美分月账本)
 *   - 无 period、只有 monthlyLimit/used 时 percent 保持 null,标 legacy
 *   - productUsage 官方 CLI 表面未用,解析保留但不进入徽章/工具主文案
 *
 * 模块级只放纯函数与常量。
 * @module dizzy-dsh-balance/grok-parse
 */

/** 已核实的产品标签;未列入的 id 原样返回,不猜测。 */
export const PRODUCT_LABELS = Object.freeze({
  PRODUCT_GROK_BUILD: 'Build',
})

/**
 * 把上游 product 字段收成稳定 id。
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeProductId(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(Math.trunc(raw))
  if (typeof raw === 'string' && raw !== '') return raw
  return null
}

/**
 * @param {string} id
 * @returns {string}
 */
export function labelProduct(id) {
  return Object.hasOwn(PRODUCT_LABELS, id) ? PRODUCT_LABELS[id] : id
}

/**
 * proto3 JSON 的 Cent:`{ val }` 或省略零值的 `{}`。
 * @param {unknown} raw
 * @returns {number | null}
 */
export function readCentVal(raw) {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw !== 'object') return null
  const val = /** @type {{ val?: unknown }} */ (raw).val
  if (val === undefined) return 0
  if (typeof val === 'number' && Number.isFinite(val)) return val
  return null
}

/**
 * @param {unknown} raw
 * @returns {number | null}
 */
export function readFiniteNumber(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  return null
}

/**
 * @param {unknown} raw
 * @returns {string | null}
 */
export function readNonEmptyString(raw) {
  return typeof raw === 'string' && raw !== '' ? raw : null
}

/**
 * 已用百分比 → 展示用剩余百分比。官方 CLI 对已用做 floor,剩余 = 100 − floor(已用)。
 * @param {number} used
 * @returns {number}
 */
export function remainingFromUsed(used) {
  const clamped = Math.min(100, Math.max(0, used))
  return 100 - Math.floor(clamped)
}

/**
 * @param {unknown} raw
 * @returns {{ id: string, name: string, usagePercent: number }[]}
 */
export function parseProductUsage(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    const rec = /** @type {Record<string, unknown>} */ (item)
    const id = normalizeProductId(rec.product ?? rec.id ?? rec.productId)
    const usage = readFiniteNumber(rec.usagePercent ?? rec.percent ?? rec.creditUsagePercent)
    if (id === null || usage === null) continue
    out.push({ id, name: labelProduct(id), usagePercent: usage })
  }
  return out
}

/**
 * 把 CLI billing?format=credits 的 JSON 收成徽章/工具用的快照。
 * 不读 cookie、不混 2h 查询桶、不从月度美分反推周额度。
 *
 * @param {unknown} body
 * @param {{ subscriptionTier?: string | null }} [extra]
 * @returns {{
 *   status: 'ok' | 'legacy' | 'empty',
 *   creditUsagePercent: number | null,
 *   remainingPercent: number | null,
 *   periodStart: string | null,
 *   periodEnd: string | null,
 *   periodType: string | null,
 *   subscriptionTier: string | null,
 *   prepaidBalanceCents: number | null,
 *   isUnified: boolean | null,
 *   onDemandEnabled: boolean | null,
 *   products: { id: string, name: string, usagePercent: number }[],
 * }}
 */
export function parseCreditsResponse(body, extra = {}) {
  const root = body !== null && typeof body === 'object'
    ? /** @type {Record<string, unknown>} */ (body)
    : {}
  const configRaw = root.config
  const config = configRaw !== null && typeof configRaw === 'object'
    ? /** @type {Record<string, unknown>} */ (configRaw)
    : null

  const periodRaw = config?.currentPeriod
  const period = periodRaw !== null && typeof periodRaw === 'object'
    ? /** @type {Record<string, unknown>} */ (periodRaw)
    : null
  const periodStart = readNonEmptyString(period?.start)
  const periodEnd = readNonEmptyString(period?.end)
  const periodType = readNonEmptyString(period?.type ?? period?.periodType)
  const hasCurrentPeriod = period !== null

  const explicitPercent = readFiniteNumber(config?.creditUsagePercent)
  const creditUsagePercent = explicitPercent !== null
    ? explicitPercent
    : (hasCurrentPeriod ? 0 : null)

  const remainingPercent = creditUsagePercent === null
    ? null
    : remainingFromUsed(creditUsagePercent)

  const prepaidBalanceCents = readCentVal(config?.prepaidBalance)
  const isUnified = typeof config?.isUnifiedBillingUser === 'boolean'
    ? config.isUnifiedBillingUser
    : null
  const onDemandEnabled = typeof root.onDemandEnabled === 'boolean'
    ? root.onDemandEnabled
    : null

  const tierFromBody = readNonEmptyString(root.subscriptionTier)
    ?? readNonEmptyString(root.subscription_tier_display)
  const subscriptionTier = readNonEmptyString(extra.subscriptionTier) ?? tierFromBody

  const products = parseProductUsage(config?.productUsage)

  let status = 'ok'
  if (config === null) status = 'empty'
  else if (creditUsagePercent === null) status = 'legacy'

  return {
    status,
    creditUsagePercent,
    remainingPercent,
    periodStart,
    periodEnd,
    periodType,
    subscriptionTier,
    prepaidBalanceCents,
    isUnified,
    onDemandEnabled,
    products,
  }
}

/**
 * 订阅插件写入 credentials 的 JSON。损坏或缺字段视为未登录。
 * @param {string} value
 * @returns {{ refresh: string, access: string, expires: number, accountId?: string, email?: string } | undefined}
 */
export function parseStoredToken(value) {
  try {
    const t = JSON.parse(value)
    if (t === null || typeof t !== 'object') return undefined
    if (typeof t.refresh !== 'string' || t.refresh === '') return undefined
    if (typeof t.access !== 'string' || t.access === '') return undefined
    if (typeof t.expires !== 'number' || !Number.isFinite(t.expires)) return undefined
    return t
  } catch {
    return undefined
  }
}

/**
 * 工具/徽章共用的可读摘要。不含账号、邮箱、令牌。
 * @param {{
 *   status?: string,
 *   creditUsagePercent: number | null,
 *   remainingPercent: number | null,
 *   periodEnd: string | null,
 *   periodType?: string | null,
 *   subscriptionTier: string | null,
 *   products?: { id: string, name: string, usagePercent: number }[],
 *   error?: string | null,
 * }} cache
 * @returns {string}
 */
export function formatQuotaText(cache) {
  if (cache.status === 'unauthenticated') {
    if (typeof cache.error === 'string' && cache.error.includes('失效')) return cache.error
    return 'Grok 未登录。请在 设置 → 订阅服务 完成 Grok 授权后再查额度。'
  }
  if (cache.error && cache.creditUsagePercent === null) {
    return `Grok 额度查询失败: ${cache.error}`
  }
  if (cache.status === 'empty') {
    return 'Grok 上游未返回额度配置。'
  }
  if (cache.status === 'legacy') {
    return 'Grok 上游只返回了已弃用的月度美分账本,无法给出周额度。'
  }
  const used = cache.creditUsagePercent === null
    ? '?'
    : String(Math.floor(Math.min(100, Math.max(0, cache.creditUsagePercent))))
  const left = cache.remainingPercent === null ? '?' : String(cache.remainingPercent)
  const tier = cache.subscriptionTier ?? 'Grok'
  const until = cache.periodEnd
    ? new Date(cache.periodEnd).toLocaleString()
    : '未知'
  const windowLabel = periodWindowLabel(cache.periodType)
  return `${tier} ${windowLabel}: 已用 ${used}%(剩 ${left}%),周期至 ${until}`
}

/**
 * @param {string | null | undefined} periodType
 * @returns {string}
 */
export function periodWindowLabel(periodType) {
  if (periodType === 'USAGE_PERIOD_TYPE_MONTHLY') return '月额度'
  return '周额度'
}

/**
 * 把 OAuth 令牌响应归一为可写回 credentials 的片段。不丢调用方传入的旧字段。
 * @param {unknown} json
 * @param {string} fallbackRefresh
 * @returns {{ refresh: string, access: string, expires: number }}
 */
export function toRefreshedToken(json, fallbackRefresh) {
  const rec = json !== null && typeof json === 'object'
    ? /** @type {Record<string, unknown>} */ (json)
    : {}
  const access = typeof rec.access_token === 'string' ? rec.access_token : ''
  if (access === '') throw new Error('令牌响应缺少 access_token')
  const expiresIn = typeof rec.expires_in === 'number' && Number.isFinite(rec.expires_in)
    ? rec.expires_in
    : 600
  const refresh = typeof rec.refresh_token === 'string' && rec.refresh_token !== ''
    ? rec.refresh_token
    : fallbackRefresh
  if (refresh === '') throw new Error('令牌响应缺少 refresh_token')
  return { refresh, access, expires: Date.now() + expiresIn * 1000 }
}
