import { MemoryClient } from '@tencentdb-agent-memory/memory-sdk-ts-v2/v3'
import { buildTools } from '../src/tools.js'

const cfg = {
  server: {
    url: 'http://127.0.0.1:8420',
    apiKey: 'local',
    instanceId: 'default',
    teamId: process.env.TEAM_ID || 'default',
    agentId: process.env.AGENT_ID || 'default',
    userId: process.env.USER_ID || 'default',
    timeoutMs: 30000,
  },
}
const client = new MemoryClient({
  endpoint: cfg.server.url,
  apiKey: cfg.server.apiKey,
  serviceId: cfg.server.instanceId,
  teamId: cfg.server.teamId,
  agentId: cfg.server.agentId,
  userId: cfg.server.userId,
  timeout: cfg.server.timeoutMs,
})

const sessionId = `dsh-e2e-${Date.now()}`
if (process.env.SKIP_ADD === '1') {
  const client2 = new MemoryClient({ endpoint: cfg.server.url, apiKey: cfg.server.apiKey, serviceId: cfg.server.instanceId, teamId: cfg.server.teamId, agentId: cfg.server.agentId, userId: cfg.server.userId, timeout: cfg.server.timeoutMs })
  const tools2 = buildTools({ current: () => cfg, getClient: async () => client2 })
  const byName2 = Object.fromEntries(tools2.map(t => [t.name, t]))
  const exec2 = { agent: { session: { header: { id: 'dsh-e2e-fast-1787117392294' } } } }
  console.log('=== tdai_memory_search ==='); console.log(await byName2.tdai_memory_search.execute({query:'数据库选型',limit:5}, exec2))
  console.log('=== tdai_memory_profile ==='); console.log(await byName2.tdai_memory_profile.execute({}, exec2))
  console.log('=== tdai_memory_status ==='); console.log(await byName2.tdai_memory_status.execute({}, exec2))
  process.exit(0)
}
const messages = [
  { role: 'user', content: '我是一名后端工程师，喜欢 TypeScript 和简洁的代码。', timestamp: new Date().toISOString() },
  { role: 'assistant', content: '收到。我会在后续协作中记住你偏好 TypeScript 与简洁代码。', timestamp: new Date().toISOString() },
  { role: 'user', content: '对了，请不要称呼我为老师，叫我老周就好。', timestamp: new Date().toISOString() },
  { role: 'assistant', content: '好的老周，以后都这么称呼你。', timestamp: new Date().toISOString() },
]
const added = await client.addConversation({ session_id: sessionId, messages })
console.log('L0 add:', JSON.stringify(added))

const tools = buildTools({ current: () => cfg, getClient: async () => client })
const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
const exec = { agent: { session: { header: { id: sessionId } } } }

const status = await byName.tdai_memory_status.execute({}, exec)
console.log('status:', status)

const conv = await byName.tdai_conversation_search.execute({ query: '叫我什么', limit: 5 }, exec)
console.log('conversation_search:', conv)

const l1 = await byName.tdai_memory_search.execute({ query: '用户偏好', limit: 5 }, exec)
console.log('memory_search(before extraction):', l1)

const profile = await byName.tdai_memory_profile.execute({}, exec)
console.log('profile:', profile)
