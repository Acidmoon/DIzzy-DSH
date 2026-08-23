import { extractMessageText, formatRecallInjection } from './format.js'

/** 从待进入步骤的消息里取最新一条真实用户输入作为召回查询。 */
function latestUserQuery(messages) {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.source?.kind !== 'user') continue
    const text = extractMessageText(message)
    if (text.length > 0) return text.slice(0, 2000)
  }
  return ''
}

/**
 * 每轮自动召回：监听 dsh 的 `agent/pre-step` waterfall。
 *
 * - 先 await next() 得到将要进入步骤的消息；
 * - 用最新用户消息查 Gateway 的 L1 原子记忆；
 * - 命中时把 <relevant-memories> 作为一条 plugin 来源的 user 消息追加到
 *   步骤消息末尾，模型无需主动调用 tdai_memory_search 也能看到相关记忆；
 * - Gateway 离线时指数退避，只在状态切换时打一条日志。
 */
export function attachAutoRecall(ctx, { current, getClient, warn }) {
  let gatewayDown = false
  let consecutiveFailures = 0
  let nextAttemptAt = 0

  const off = ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    const cfg = current()?.recall ?? {}
    if (!cfg.enabled || cfg.autoInject === false) return decision
    if (decision?.kind !== 'enter' || !Array.isArray(decision.messages)) return decision
    if (Date.now() < nextAttemptAt) return decision

    const query = latestUserQuery(decision.messages)
    if (!query) return decision

    try {
      const client = await getClient()
      const data = await client.searchAtomic({ query, limit: cfg.maxResults ?? 5 })
      const items = Array.isArray(data?.items) ? data.items : []
      if (items.length === 0) return decision

      // 手工构造 UserMessage（与 dsh-llm createUserMessage 同构），
      // 避免让插件包依赖宿主内部的 @deepseek-ai/dsh-llm。
      const recallMessage = {
        id: `tdai-recall-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        role: 'user',
        content: [{ type: 'text', text: formatRecallInjection(items) }],
        source: { kind: 'plugin', plugin: 'dsh-plugin-memory-tencentdb' },
      }
      if (gatewayDown) {
        gatewayDown = false
        consecutiveFailures = 0
        warn('自动记忆召回已恢复')
      }
      return { ...decision, messages: [...decision.messages, recallMessage] }
    } catch (err) {
      consecutiveFailures += 1
      nextAttemptAt = Date.now() + Math.min(120000, 2000 * 2 ** Math.min(consecutiveFailures, 6))
      if (!gatewayDown) {
        gatewayDown = true
        warn(`自动记忆召回暂不可用，进入退避：${String(err?.message ?? err)}`)
      }
      return decision
    }
  })

  return off
}
