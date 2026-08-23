import { extractMessageText } from './format.js'
import { headerSessionIdOf } from './client.js'

/**
 * 监听 dsh 的 session/event，把真实用户消息与模型回复文本写入
 * MemoryCore Gateway 的 L0（/v3/conversation/add）。
 *
 * - 只捕获 surface 事件：user/message + assistant/message；
 * - 用户消息默认只收 source.kind === 'user'，避免把插件注入的
 *   runtime-context / system-reminder 等合成上下文写进记忆；
 * - 按会话分桶，flushIntervalMs 静默窗口后批量提交，减少 HTTP 次数；
 * - turn/end 时立即 flush；skipFailedTurns 开启时丢弃 error turn 的桶。
 */
export function attachCapture(ctx, { current, getClient, warn }) {
  const pending = new Map() // sessionId -> items[]
  const timers = new Map() // sessionId -> timeout handle
  const inflight = new Map() // sessionId -> Promise
  const MAX_PENDING_PER_SESSION = 200
  let disposed = false
  // Gateway 离线退避：失败后指数退避，只在状态切换时打一条日志，
  // 避免 Gateway 宕机时每条消息都刷 "fetch failed"。
  let gatewayDown = false
  let consecutiveFailures = 0
  let nextAttemptAt = 0

  const cap = (sid) => {
    const list = pending.get(sid)
    if (!Array.isArray(list)) return
    while (list.length > MAX_PENDING_PER_SESSION) list.shift()
  }

  const retryDelay = () => Math.min(120000, 2000 * 2 ** Math.min(consecutiveFailures, 6))

  function scheduleFlush(sid) {
    if (disposed) return
    const existing = timers.get(sid)
    if (existing !== undefined) clearTimeout(existing)
    const timer = setTimeout(() => {
      timers.delete(sid)
      void flush(sid)
    }, Math.max(500, current()?.capture?.flushIntervalMs ?? 2000))
    timers.set(sid, timer)
  }

  async function flush(sid) {
    const items = pending.get(sid)
    if (!Array.isArray(items) || items.length === 0) return
    if (inflight.has(sid)) return // 上一批还没提交完；新消息仍留在 pending，由后续 flush 带走
    if (Date.now() < nextAttemptAt) {
      cap(sid)
      return // 离线退避窗口内，不做网络请求
    }
    pending.set(sid, [])
    const batch = items.splice(0, items.length)

    const task = (async () => {
      try {
        const client = await getClient()
        await client.addConversation({ session_id: sid, messages: batch })
        if (gatewayDown) {
          gatewayDown = false
          consecutiveFailures = 0
          warn(`L0 capture 已恢复（session=${sid}）`)
        }
      } catch (err) {
        consecutiveFailures += 1
        if (!gatewayDown) {
          gatewayDown = true
          warn(`L0 capture 暂时不可用，进入退避：${String(err?.message ?? err)}`)
        }
        nextAttemptAt = Date.now() + retryDelay()
        // 失败批次放回队首，Gateway 恢复后补交；超长时按 cap 丢弃最旧消息。
        const list = pending.get(sid) ?? []
        list.unshift(...batch)
        pending.set(sid, list)
        cap(sid)
        const delay = Math.max(500, nextAttemptAt - Date.now())
        const timer = setTimeout(() => {
          timers.delete(sid)
          void flush(sid)
        }, delay)
        timers.set(sid, timer)
      } finally {
        inflight.delete(sid)
        if (Array.isArray(pending.get(sid)) && pending.get(sid).length > 0 && Date.now() >= nextAttemptAt) {
          scheduleFlush(sid)
        }
      }
    })()
    inflight.set(sid, task)
    await task
  }

  function messageToItem(message, onlyUserSource) {
    const text = extractMessageText(message)
    if (text.length === 0) return null
    if (message?.role === 'user') {
      // tool 结果永远不写进 L0 对话流。
      if (message?.source?.kind === 'tool') return null
      // onlyUserSource=true 时只收真实用户输入；false 时也收插件注入的 user 上下文。
      if (message?.source?.kind === 'user' || !onlyUserSource) {
        return { role: 'user', content: text, timestamp: new Date().toISOString() }
      }
      return null
    }
    if (message?.source?.kind === 'model') {
      return { role: 'assistant', content: text, timestamp: new Date().toISOString() }
    }
    return null
  }

  function enqueue(session, message) {
    const cfg = current()?.capture ?? {}
    const sid = headerSessionIdOf(session)
    if (!sid) return
    const item = messageToItem(message, cfg.onlyUserSource !== false)
    if (!item) return

    const list = pending.get(sid) ?? []
    list.push(item)
    pending.set(sid, list)
    cap(sid)
    scheduleFlush(sid)
  }

  const offEvent = ctx.on('session/event', (session, event) => {
    if (!current()?.capture?.enabled) return
    const type = event?.type
    if (type === 'user/message') enqueue(session, event.data)
    else if (type === 'assistant/message') enqueue(session, event.data?.message)
  })

  const offTurn = ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/end') return
    const cfg = current()?.capture ?? {}
    const sid = headerSessionIdOf(session)
    if (!sid) return
    const reason = event.data?.reason?.kind
    if (cfg.skipFailedTurns && reason === 'error') {
      pending.delete(sid)
      const timer = timers.get(sid)
      if (timer !== undefined) clearTimeout(timer)
      timers.delete(sid)
      return
    }
    void flush(sid)
  })

  return () => {
    disposed = true
    offEvent()
    offTurn()
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    // 尽力把残留桶提交出去（dispose 时 event loop 仍可用）。
    for (const sid of [...pending.keys()]) void flush(sid)
  }
}
