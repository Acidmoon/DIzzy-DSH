import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, name, STEER_TEXT } from '../shared/wire-think.mjs'

const THINK_PROVIDER = 'deepseek-wire-think'

function register(config, options = {}) {
  const listeners = {}
  const hookOptions = {}
  const warns = []
  const ctx = {
    on(event, callback, opts) {
      listeners[event] = callback
      hookOptions[event] = opts
    },
    get(service) {
      if (service === 'llm' && options.providers !== undefined) {
        return { listProviders: () => options.providers }
      }
      return undefined
    },
    logger: {
      warn(message) {
        warns.push(message)
      },
    },
  }
  apply(ctx, config)
  assert.equal(typeof listeners['system-prompt/assemble'], 'function')
  assert.equal(typeof listeners['agent/request'], 'function')
  assert.equal(typeof listeners['agent/turn-stopping'], 'function')
  return { listeners, hookOptions, warns }
}

/** A minimal agent with a steerable inbox. */
function makeAgent(id = 's', events = [], header = {}) {
  const steered = []
  return {
    session: { id, events, header },
    steer(message) {
      steered.push(message)
    },
    steered,
  }
}

async function prestep(listener, agent, turn, step, messages = []) {
  return listener({ agent, turn, step, messages, signal: undefined }, async () => ({ kind: 'enter', messages }))
}

async function request(listener, agent, turn, step, config) {
  return listener({ agent, turn, step, signal: undefined }, async () => config)
}

async function assemble(listener, agent, tools) {
  return listener(undefined, { agent }, async () => ({ system: 'minimal persona', tools }))
}

const userMessage = { id: 'u', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }

const FULL_CATALOG = () => [
  { name: 'bash' }, { name: 'str_replace_editor' }, { name: 'dev_tool_search' },
  { name: 'skill_search' }, { name: 'skill_load' }, { name: 'read' }, { name: 'web_search' },
]

test('exports a diagnostic plugin name', () => {
  assert.equal(name, 'wire-think')
})

test('with the route registered: think keeps the natural catalog and swaps the provider', async () => {
  const { listeners } = register({}, { providers: [THINK_PROVIDER] })
  const agent = makeAgent()
  await prestep(listeners['agent/pre-step'], agent, 1, 0, [userMessage])

  // Wire: the assembled request keeps its tools — the wire lever does the rest.
  const assembled = await assemble(listeners['system-prompt/assemble'], agent, FULL_CATALOG())
  assert.deepEqual(assembled.tools.map((tool) => tool.name).sort(), FULL_CATALOG().map((tool) => tool.name).sort())

  const swapped = await request(listeners['agent/request'], agent, 1, 0, { provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  assert.equal(swapped.provider, THINK_PROVIDER)
  assert.equal(swapped.model, 'deepseek-v4-pro')
})

test('execute steps restore the original provider even from a folded think header', async () => {
  const { listeners } = register({}, { providers: [THINK_PROVIDER] })
  const agent = makeAgent()
  await prestep(listeners['agent/pre-step'], agent, 1, 0, [userMessage])
  await request(listeners['agent/request'], agent, 1, 0, { provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  listeners['agent/turn-stopping']({ agent, turn: 1, signal: undefined })
  assert.equal(agent.steered.length, 1)

  // The folded header seeds the execute step with the think route; the
  // engine restores the captured original provider.
  await prestep(listeners['agent/pre-step'], agent, 1, 1, [agent.steered[0]])
  const restored = await request(listeners['agent/request'], agent, 1, 1, { provider: THINK_PROVIDER, model: 'deepseek-v4-pro' })
  assert.equal(restored.provider, 'deepseek-official')

  const assembled = await assemble(listeners['system-prompt/assemble'], agent, FULL_CATALOG())
  assert.deepEqual(assembled.tools.map((tool) => tool.name).sort(), [
    'bash', 'dev_tool_search', 'skill_load', 'skill_search', 'str_replace_editor',
  ])
})

test('without the route registered: think degrades to the zero-tool condition', async () => {
  const { listeners, warns } = register({}, { providers: [] })
  const agent = makeAgent()
  await prestep(listeners['agent/pre-step'], agent, 1, 0, [userMessage])
  const assembled = await assemble(listeners['system-prompt/assemble'], agent, FULL_CATALOG())
  assert.deepEqual(assembled.tools, [])

  // No provider swap on a route that does not exist.
  const kept = await request(listeners['agent/request'], agent, 1, 0, { provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  assert.equal(kept.provider, 'deepseek-official')
  assert.equal(warns.length, 1)
})

test('the provider probe turns positive once the route appears', async () => {
  const providers = []
  const { listeners } = register({}, {
    get providers() {
      return providers
    },
  })
  const agent = makeAgent()
  await prestep(listeners['agent/pre-step'], agent, 1, 0, [userMessage])
  assert.deepEqual((await assemble(listeners['system-prompt/assemble'], agent, FULL_CATALOG())).tools, [])

  providers.push(THINK_PROVIDER)
  await prestep(listeners['agent/pre-step'], agent, 2, 0, [userMessage])
  const assembled = await assemble(listeners['system-prompt/assemble'], agent, FULL_CATALOG())
  assert.deepEqual(assembled.tools.map((tool) => tool.name).sort(), FULL_CATALOG().map((tool) => tool.name).sort())
})

test('the think phase strips auto-injected context; execute keeps it', async () => {
  const { listeners } = register({}, { providers: [THINK_PROVIDER] })
  const instruction = { id: 'i', content: [], source: { kind: 'agent-instructions' } }
  const catalog = { id: 'c', content: [], source: { kind: 'skill-catalog' } }
  const thinkDecision = await prestep(listeners['agent/pre-step'], makeAgent(), 1, 0, [userMessage, instruction, catalog])
  assert.deepEqual(thinkDecision.messages.map((message) => message.id), ['u'])
  const executeDecision = await prestep(listeners['agent/pre-step'], makeAgent(), 1, 1, [userMessage, instruction, catalog])
  assert.equal(executeDecision.messages.length, 3)
})

test('steering happens exactly once per turn with the notice shape', async () => {
  const { listeners } = register({}, { providers: [THINK_PROVIDER] })
  const agent = makeAgent()
  await prestep(listeners['agent/pre-step'], agent, 1, 0, [userMessage])
  listeners['agent/turn-stopping']({ agent, turn: 1, signal: undefined })
  listeners['agent/turn-stopping']({ agent, turn: 1, signal: undefined })
  assert.equal(agent.steered.length, 1)
  const message = agent.steered[0]
  assert.equal(message.role, 'user')
  assert.equal(message.content[0].text, STEER_TEXT)
  assert.equal(message.source.plugin, 'wire-think')
})

test('a durable wire-think steering event prevents a post-restart double steer', async () => {
  const events = [
    { type: 'steering/message', seq: 2, data: { turn: 1, content: [], source: { kind: 'plugin', plugin: 'wire-think' } } },
  ]
  const { listeners } = register({}, { providers: [THINK_PROVIDER] })
  const agent = makeAgent('restart', events)
  await prestep(listeners['agent/pre-step'], agent, 1, 0, [userMessage])
  listeners['agent/turn-stopping']({ agent, turn: 1, signal: undefined })
  assert.equal(agent.steered.length, 0)
})

test('subagents never swap the route by default', async () => {
  const { listeners } = register({}, { providers: [THINK_PROVIDER] })
  const agent = makeAgent('sub', [], { delegationDepth: 1 })
  await prestep(listeners['agent/pre-step'], agent, 1, 0, [userMessage])
  const kept = await request(listeners['agent/request'], agent, 1, 0, { provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  assert.equal(kept.provider, 'deepseek-official')
  const assembled = await assemble(listeners['system-prompt/assemble'], agent, FULL_CATALOG())
  assert.deepEqual(assembled.tools.map((tool) => tool.name).sort(), [
    'bash', 'dev_tool_search', 'skill_load', 'skill_search', 'str_replace_editor',
  ])
})

test('mode: first-turn limits the think phase to the first user turn', async () => {
  const { listeners } = register({ mode: 'first-turn' }, { providers: [THINK_PROVIDER] })
  const later = makeAgent('later', [{ type: 'user/message', data: {} }])
  await prestep(listeners['agent/pre-step'], later, 2, 0, [userMessage])
  const kept = await request(listeners['agent/request'], later, 2, 0, { provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  assert.equal(kept.provider, 'deepseek-official')
})

test('a request outside a session keeps the resolved config untouched', async () => {
  const { listeners } = register({}, { providers: [THINK_PROVIDER] })
  const config = { provider: 'deepseek-official', model: 'deepseek-v4-pro' }
  const kept = await listeners['agent/request']({ agent: undefined, turn: 1, step: 0 }, async () => config)
  assert.equal(kept, config)
})

test('invalid config values fail at apply time', () => {
  assert.throws(() => register({ mode: 'sometimes' }), /mode/)
  assert.throws(() => register({ suppressedContextSources: [1] }), /suppressedContextSources/)
})
