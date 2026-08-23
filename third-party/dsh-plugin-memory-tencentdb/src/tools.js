import { formatAtomicSearch, formatConversationSearch, formatScenarioList, textOutput } from './format.js'
import { resolvePersonalIdentity, sessionIdOf } from './client.js'

/**
 * 注册到 dsh 工具目录的记忆工具。
 * 所有工具都是纯客户端：调用 MemoryCore Gateway 的 /v3/* HTTP API。
 */
export function buildTools({ current, getClient }) {
  const text = textOutput

  const memorySearch = {
    name: 'tdai_memory_search',
    description:
      '搜索 TencentDB Agent Memory 的结构化长期记忆（L1）。用于回忆当前用户的偏好、历史事件、决策、规则等被提取过的记忆。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '自然语言查询，例如 "用户喜欢的代码风格" 或 "关于登录模块的决定"。' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: '返回条数上限，默认 5。' },
        type: { type: 'string', description: '可选：按记忆类型过滤（如 preference / decision / fact）。' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output: text('JSON：匹配到的 L1 记忆数组（含 id/type/content/score）。'),
    async execute(args, _exec) {
      const client = await getClient()
      const params = { query: String(args.query) }
      if (Number.isInteger(args.limit)) params.limit = args.limit
      if (typeof args.type === 'string' && args.type.length > 0) params.type = args.type
      const data = await client.searchAtomic(params)
      return formatAtomicSearch(data)
    },
  }

  const conversationSearch = {
    name: 'tdai_conversation_search',
    description:
      '搜索 TencentDB Agent Memory 的原始对话记录（L0）。用于查找用户或助手具体说过的话、时间线等未被提取的细节。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '自然语言查询。' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: '返回条数上限，默认 5。' },
        session_id: {
          type: 'string',
          description: "可选：要搜索的会话 id；缺省=当前 dsh 会话；传 'all'=当前 team+agent+user 的跨会话聚合。",
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output: text('JSON：匹配到的 L0 消息数组（含 role/content/timestamp/score）。'),
    async execute(args, exec) {
      const client = await getClient()
      const params = { query: String(args.query) }
      if (Number.isInteger(args.limit)) params.limit = args.limit
      const sid = args.session_id === 'all' ? undefined : (args.session_id ?? sessionIdOf(exec))
      if (typeof sid === 'string' && sid.length > 0) params.session_id = sid
      const data = await client.searchConversation(params)
      return formatConversationSearch(data)
    },
  }

  const memoryProfile = {
    name: 'tdai_memory_profile',
    description:
      '读取当前 team+agent 的长期画像（L3，用户偏好/背景/人设）与场景索引（L2）。适合在会话开始时或用户问"你记得我什么"时主动调用。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: text('JSON：persona（L3 全文）与 scenes（L2 路径索引）。'),
    async execute(_args, _exec) {
      const client = await getClient()
      const [core, scenarios] = await Promise.all([
        client.readCore(),
        client.listScenarios({}),
      ])
      return JSON.stringify({
        persona: core.content,
        persona_updated_at: core.updated_at,
        scenes: formatScenarioList(scenarios).entries,
      })
    },
  }

  const readScenario = {
    name: 'tdai_read_scenario',
    description:
      '按路径读取 TencentDB Agent Memory 的 L2 场景文件全文。路径来自 tdai_memory_profile 返回的 scenes[].path。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '场景文件相对路径，例如 scene_blocks/travel-plan.md。' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    output: text('场景文件内容；不存在时返回提示。'),
    async execute(args, _exec) {
      const client = await getClient()
      const file = await client.readScenario({ path: String(args.path) })
      if (file.content === null) return `场景文件不存在：${file.path}`
      return file.content
    },
  }

  const memoryStatus = {
    name: 'tdai_memory_status',
    description:
      '查看当前 team+agent 在 TencentDB Agent Memory 中的存储概况（L0 对话条数 / L1 记忆条数 / L2 场景数）。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: text('JSON：各层计数与配置的连接信息。'),
    async execute(_args, _exec) {
      const client = await getClient()
      const cfg = current()
      const identity = resolvePersonalIdentity(cfg?.server ?? {})
      const [conversation, atomic, scenario] = await Promise.allSettled([
        client.countConversation({}),
        client.countAtomic({}),
        client.countScenario({}),
      ])
      return JSON.stringify({
        connected: true,
        mode: cfg?.server?.autoIdentity === false ? 'explicit' : 'personal-auto',
        instance: cfg?.server?.instanceId ?? 'default',
        team: identity.teamId,
        agent: identity.agentId,
        user: identity.userId,
        L0_conversations: conversation.status === 'fulfilled' ? conversation.value.total : `error: ${conversation.reason?.message}`,
        L1_atomics: atomic.status === 'fulfilled' ? atomic.value.total : `error: ${atomic.reason?.message}`,
        L2_scenarios: scenario.status === 'fulfilled' ? scenario.value.total : `error: ${scenario.reason?.message}`,
      })
    },
  }

  return [memorySearch, conversationSearch, memoryProfile, readScenario, memoryStatus]
}
