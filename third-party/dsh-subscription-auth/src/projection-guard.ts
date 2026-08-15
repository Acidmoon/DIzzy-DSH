/**
 * 只修本插件写下的脏 usage，不改 DSH 内核、不重写整个投影表。
 *
 * Kimi 可能把 input_tokens 报成已扣除 cache 的净增量，再减 cache_read
 * 会得到负数。写入侧 mapUsage 已钳零；旧日志里的负值仍会在
 * tokenUsage / contextPressure 的 nonnegative schema 上炸掉 session.history。
 *
 * 这里只包装这两个 unit 的 view：读路径一律把计数收成非负整数。
 * snapshot / restore / drive / viewCheckpoint 都会走 view，其它投影不动。
 */
type Logger = (message: string) => void

type UsageDef = {
  key: string
  view: (state: unknown) => unknown
  __subscriptionUsageClamped?: boolean
}

type ProjectionRegistry = {
  registrations: Map<string, { def: UsageDef }>
  register: (definition: UsageDef) => () => void
}

const USAGE_KEYS = new Set(['tokenUsage', 'contextPressure'])
const COUNT_FIELDS = [
  'uncachedInputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'pressureTokens',
  'projectedTokens',
] as const

function clampCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(n)))
}

function clampView(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  const input = value as Record<string, unknown>
  const output: Record<string, unknown> = { ...input }
  for (const field of COUNT_FIELDS) {
    if (field in output && output[field] !== undefined) {
      output[field] = clampCount(output[field])
    }
  }
  return output
}

function wrapUsageView(def: UsageDef, log: Logger): void {
  if (!USAGE_KEYS.has(def.key) || def.__subscriptionUsageClamped) return
  const original = def.view.bind(def)
  def.view = (state: unknown) => {
    try {
      return clampView(original(state))
    } catch (error) {
      log(`session projection ${def.key} view failed: ${String(error)}`)
      throw error
    }
  }
  def.__subscriptionUsageClamped = true
}

export function installProjectionGuard(
  ctx: {
    inject(deps: string[], fn: (injected: { sessionProjections: ProjectionRegistry }) => void): void
  },
  log: Logger,
): void {
  ctx.inject(['sessionProjections'], (projCtx) => {
    const registry = projCtx.sessionProjections
    if (registry === undefined || typeof registry.register !== 'function') return

    for (const registration of registry.registrations.values()) {
      wrapUsageView(registration.def, log)
    }

    const originalRegister = registry.register.bind(registry)
    registry.register = (definition) => {
      wrapUsageView(definition, log)
      return originalRegister(definition)
    }
    const injected = projCtx as { effect?: (fn: () => () => void, name?: string) => void }
    injected.effect?.(() => () => {
      registry.register = originalRegister
    }, 'subscription-auth.projection-guard')
  })
}
