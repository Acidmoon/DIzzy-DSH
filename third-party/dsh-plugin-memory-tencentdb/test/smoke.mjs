import assert from 'node:assert/strict'
import plugin from '../index.js'
import { buildTools } from '../src/tools.js'
import { attachCapture } from '../src/capture.js'
import { attachProfileInjection } from '../src/profile.js'
import { extractMessageText } from '../src/format.js'

const fullConfig = {
  server: { url: 'http://127.0.0.1:8420', apiKey: 'local', credentialName: '', instanceId: 'default', teamId: 't', agentId: 'a', userId: 'u', timeoutMs: 30000, rejectUnauthorized: false },
  recall: { enabled: false, refreshIntervalMs: 60000 },
  capture: { enabled: false, onlyUserSource: true, flushIntervalMs: 500, skipFailedTurns: true },
  runtime: { manageSidecars: false },
}

// 1) 插件整体 apply 不抛错，工具全部注册，dispose 正常。
{
  const registered = []
  const mockCtx = {
    get: () => undefined,
    tools: { register: (tool) => { registered.push(tool); return () => {} } },
    systemPrompt: { section: () => () => {} },
    credentials: { resolve: async () => undefined },
    timer: { timeout: (_cb, _ms) => () => {} },
    webServer: { register: () => () => {} },
    on: () => () => {},
  }
  const dispose = plugin.apply(mockCtx, fullConfig)
  assert.equal(registered.length, 12)
  assert.deepEqual(registered.map((t) => t.name).sort(), [
    'tdai_conversation_search',
    'tdai_knowledge_codegraph_explore',
    'tdai_knowledge_codegraph_files',
    'tdai_knowledge_codegraph_list',
    'tdai_knowledge_codegraph_search',
    'tdai_knowledge_wiki_list',
    'tdai_knowledge_wiki_pages',
    'tdai_knowledge_wiki_search',
    'tdai_memory_profile',
    'tdai_memory_search',
    'tdai_memory_status',
    'tdai_read_scenario',
  ])
  assert.doesNotThrow(dispose)
  console.log('ok: plugin apply / tools / dispose')
}

// 2) 工具 execute 走 MemoryClient；这里用 fake transport 验证参数与返回。
{
  const calls = []
  const tools = buildTools({ current: () => fullConfig, getClient: async () => ({ searchAtomic: async (p) => { calls.push(['atomic', p]); return { items: [{ id: '1', type: 'preference', content: '喜欢中文', score: 0.9, updated_at: 'x' }] } }, searchConversation: async (p) => { calls.push(['conv', p]); return { messages: [] } }, readCore: async () => ({ content: 'PERSONA', updated_at: 't' }), listScenarios: async () => ({ entries: [{ path: 'scene_blocks/a.md', summary: 's' }], total: 1 }), readScenario: async ({ path }) => ({ path, content: 'SCENE', updated_at: 't' }), countConversation: async () => ({ total: 1 }), countAtomic: async () => ({ total: 2 }), countScenario: async () => ({ total: 3 }) }) })

  const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
  const exec = { agent: { session: { header: { id: 'sess-1' } } } }

  assert.match(await byName.tdai_memory_search.execute({ query: '偏好' }, exec), /喜欢中文/)
  assert.match(await byName.tdai_conversation_search.execute({ query: 'x' }, exec), /count/)
  assert.equal(calls[1][1].session_id, 'sess-1')
  assert.match(await byName.tdai_memory_profile.execute({}, exec), /PERSONA/)
  assert.equal(await byName.tdai_read_scenario.execute({ path: 'scene_blocks/a.md' }, exec), 'SCENE')
  const status = JSON.parse(await byName.tdai_memory_status.execute({}, exec))
  assert.deepEqual([status.L0_conversations, status.L1_atomics, status.L2_scenarios], [1, 2, 3])
  console.log('ok: tool execute + session isolation')
}

// 3) 捕获：真实用户 + 模型回复进入 L0；插件注入的 user 上下文被过滤。
{
  const sent = []
  const listeners = {}
  const mockCtx = {
    on: (type, cb) => { (listeners[type] ??= []).push(cb); return () => {} },
  }
  const config = { ...fullConfig, capture: { enabled: true, onlyUserSource: true, flushIntervalMs: 50, skipFailedTurns: true } }
  const dispose = attachCapture(mockCtx, {
    current: () => config,
    getClient: async () => ({ addConversation: async (p) => { sent.push(p) } }),
    warn: () => {},
  })

  const session = { header: { id: 'sess-cap' } }
  const emit = (type, data) => { for (const cb of listeners['session/event'] ?? []) cb(session, { type, data }) }
  emit('user/message', { id: 'm1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '用户提问' }] })
  emit('user/message', { id: 'm2', role: 'user', source: { kind: 'plugin', plugin: 'x' }, content: [{ type: 'text', text: 'runtime context' }] })
  emit('assistant/message', { message: { id: 'm3', role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: '模型回答' }] } })
  emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0].messages.map((m) => m.role), ['user', 'assistant'])
  assert.equal(sent[0].messages[0].content, '用户提问')
  assert.equal(sent[0].messages[1].content, '模型回答')
  dispose()
  console.log('ok: L0 capture / filter / batch')
}

// 4) 画像注入 section 在 Gateway 就绪后返回记忆块。
{
  let sectionText = null
  const mockCtx = {
    systemPrompt: { section: ({ text }) => { sectionText = text; return () => {} } },
    timeout: (_cb, _ms) => () => {},
  }
  const dispose = attachProfileInjection(mockCtx, {
    current: () => ({ recall: { enabled: true, refreshIntervalMs: 60000 } }),
    getClient: async () => ({ readCore: async () => ({ content: 'PERSONA' }), listScenarios: async () => ({ entries: [{ path: 'scene_blocks/a.md' }], total: 1 }) }),
    warn: () => {},
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const rendered = sectionText()
  assert.match(rendered, /PERSONA/)
  assert.match(rendered, /scene_blocks\/a\.md/)
  assert.match(rendered, /tdai_memory_search/)
  dispose()
  console.log('ok: profile injection section')
}

// 5) 消息文本提取
{
  assert.equal(extractMessageText({ content: [{ type: 'text', text: ' hi ' }, { type: 'reasoning', text: 'no' }] }), 'hi')
  console.log('ok: text extraction')
}

console.log('ALL SMOKE TESTS PASSED')
