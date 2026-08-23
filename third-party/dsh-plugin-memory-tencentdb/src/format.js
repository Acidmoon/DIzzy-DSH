/** 与 MemoryCore / MemoryProxy 保持一致的注入标签。 */

export const MEMORY_TOOLS_GUIDE = `<memory-tools-guide>
## 记忆工具调用指南

本会话已接入 TencentDB Agent Memory（独立 MemoryCore Gateway）。

当注入的记忆片段不足以回答用户问题时，可主动调用以下工具：

- **tdai_memory_search**：搜索结构化长期记忆（L1），适合回忆用户偏好、历史事件、决策、规则。
- **tdai_conversation_search**：搜索原始对话记录（L0），适合查找具体说过的话和时间线。
- **tdai_memory_profile**：读取当前 team+agent 的用户画像（L3）与场景索引（L2）。
- **tdai_read_scenario**：按路径读取场景详情。

### ⚠️ 调用次数限制
每轮对话中 tdai_memory_search 与 tdai_conversation_search **合计最多调用 3 次**。
- 首次搜索无结果时可换关键词重试一次，但总调用次数不要超过 3 次。
- 仍无结果说明该信息不在记忆中，直接基于现有信息回答，不要反复搜索。
</memory-tools-guide>`

export function formatProfileSection(state) {
  if (!state.initialized) return ''

  const parts = []

  if (state.persona) {
    parts.push('<tdai_profile_memory>\n' + state.persona.trim() + '\n</tdai_profile_memory>')
  }

  if (Array.isArray(state.scenes) && state.scenes.length > 0) {
    const lines = [
      '<tdai_scene_navigation>',
      '以下是当前 team+agent 的场景记忆索引；需要细节时用 tdai_read_scenario 读取。',
      '',
    ]
    for (const scene of state.scenes) {
      const summary = scene?.summary ? ` — ${scene.summary}` : ''
      lines.push(`- \`${scene.path}\`${summary}`)
    }
    lines.push('</tdai_scene_navigation>')
    parts.push(lines.join('\n'))
  }

  parts.push(MEMORY_TOOLS_GUIDE)
  return parts.join('\n\n')
}

/** 把 L1 召回结果格式化为注入模型历史的消息文本。 */
export function formatRecallInjection(items) {
  if (!Array.isArray(items) || items.length === 0) return ''
  const lines = [
    '<relevant-memories>',
    '以下是 TencentDB Agent Memory 自动召回的相关长期记忆：',
    '',
  ]
  for (const item of items) {
    const tag = item.type ? `[${item.type}] ` : ''
    lines.push(`- ${tag}${item.content}`)
  }
  lines.push('</relevant-memories>')
  return lines.join('\n')
}

export function formatAtomicSearch(data) {
  const items = Array.isArray(data?.items) ? data.items : []
  if (items.length === 0) return JSON.stringify({ count: 0, items: [], hint: '未找到相关 L1 记忆，可换关键词重试一次。' })
  return JSON.stringify({
    count: items.length,
    items: items.map((item) => ({
      id: item.id,
      type: item.type,
      content: item.content,
      background: item.background,
      score: item.score,
      updated_at: item.updated_at,
    })),
  })
}

export function formatConversationSearch(data) {
  const messages = Array.isArray(data?.messages) ? data.messages : []
  if (messages.length === 0) return JSON.stringify({ count: 0, messages: [], hint: '未找到相关 L0 对话记录。' })
  return JSON.stringify({
    count: messages.length,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      score: m.score,
    })),
  })
}

export function formatScenarioList(data) {
  const entries = Array.isArray(data?.entries) ? data.entries : []
  return {
    total: data?.total ?? entries.length,
    entries: entries.map((e) => ({
      path: e.path,
      summary: e.summary,
      updated_at: e.updated_at,
    })),
  }
}

export function textOutput(description) {
  return {
    schema: { type: 'string', description },
    render(_args, value) {
      return [{ type: 'text', text: String(value) }]
    },
  }
}

/** 把 dsh 消息 content blocks 里的可见文本提取出来。 */
export function extractMessageText(message) {
  if (!Array.isArray(message?.content)) return ''
  return message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}
