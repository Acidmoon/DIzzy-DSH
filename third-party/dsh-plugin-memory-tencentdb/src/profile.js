import { formatProfileSection } from './format.js'

/**
 * L3 画像 + L2 场景导航缓存：
 * - systemPrompt.section 的 text 是同步函数，因此不能每次发请求；
 * - 启动时异步刷新一次，之后按 recall.refreshIntervalMs 轮询；
 * - 只有成功连上 Gateway 后（initialized=true）才向系统提示词注入内容。
 */
export function attachProfileInjection(ctx, { current, getClient, warn }) {
  const state = {
    initialized: false,
    persona: null,
    scenes: [],
    updatedAt: 0,
    error: null,
    refreshing: false,
  }
  let disposed = false
  let timer = null
  let gatewayDown = false
  let consecutiveFailures = 0
  let nextAttemptAt = 0

  async function refresh() {
    if (disposed || state.refreshing) return
    if (!current()?.recall?.enabled) return
    if (Date.now() < nextAttemptAt) return // Gateway 离线退避窗口
    state.refreshing = true
    try {
      const client = await getClient()
      const [core, scenarios] = await Promise.allSettled([
        client.readCore(),
        client.listScenarios({}),
      ])

      if (core.status === 'fulfilled' && typeof core.value?.content === 'string') {
        state.persona = core.value.content
      }
      if (scenarios.status === 'fulfilled') {
        state.scenes = scenarios.value?.entries ?? []
      }
      const errors = [
        core.status === 'rejected' ? String(core.reason?.message ?? core.reason) : null,
        scenarios.status === 'rejected' ? String(scenarios.reason?.message ?? scenarios.reason) : null,
      ].filter(Boolean)

      state.initialized = true
      state.error = errors.length > 0 ? errors.join('; ') : null
      state.updatedAt = Date.now()
      if (gatewayDown) {
        gatewayDown = false
        consecutiveFailures = 0
        warn('MemoryCore Gateway 已恢复，记忆上下文注入已启用')
      }
    } catch (err) {
      consecutiveFailures += 1
      nextAttemptAt = Date.now() + Math.min(120000, 2000 * 2 ** Math.min(consecutiveFailures, 6))
      state.error = String(err?.message ?? err)
      if (!gatewayDown) {
        gatewayDown = true
        warn(`MemoryCore Gateway 不可达，记忆上下文注入暂停（进入退避）：${state.error}`)
      }
    } finally {
      state.refreshing = false
    }
  }

  const disposeSection = ctx.systemPrompt.section({
    name: 'tdai-memory:profile',
    order: 60,
    text: () => formatProfileSection(state),
  })

  // 启动后先刷一次；之后定时刷新。递归 timeout 便于 dispose 后彻底停止。
  const schedule = () => {
    if (disposed) return
    const delay = Math.max(15000, current()?.recall?.refreshIntervalMs ?? 60000)
    timer = ctx.timeout(() => {
      void refresh().catch((err) => warn(String(err?.message ?? err)))
      schedule()
    }, delay)
  }
  void refresh().catch((err) => warn(String(err?.message ?? err)))
  schedule()

  return () => {
    disposed = true
    disposeSection()
    if (timer !== null) timer()
  }
}
