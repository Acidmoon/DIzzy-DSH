import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, name } from '../preset/context-gate.mjs'

function register(cfg) {
  const listeners = {}
  const hookOptions = {}
  const warns = []
  const ctx = {
    on(event, callback, options) {
      listeners[event] = callback
      hookOptions[event] = options
    },
    logger: {
      warn(message) {
        warns.push(message)
      },
    },
  }
  apply(ctx, cfg)
  return { listeners, hookOptions, warns }
}

const agent = (events, id = 's', header = {}) => ({ session: { id, events, header } })

function assemble(listener, events, contexts, id = 's', header = {}) {
  return listener(undefined, { agent: agent(events, id, header) }, async () => ({
    sections: [{ name: 'deployment:persona', text: 'You are a helpful software engineer assistant.' }],
    contexts,
    tools: [{ name: 'bash' }, { name: 'str_replace_editor' }],
    variables: {},
  }))
}

/** pre-step with an explicit claimed batch (the real payload carries it). */
function prestep(listener, events, decisionMessages, claimed, id = 's', header = {}) {
  return listener(
    { agent: agent(events, id, header), messages: claimed, turn: 1, step: 1, signal: {} },
    async () => ({ kind: 'enter', messages: decisionMessages }),
  )
}

const userMessage = { id: 'u', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }
const toolResultMessage = { id: 'tr', content: [{ type: 'tool-result' }] }
const instructionMessage = { id: 'i', content: [], source: { kind: 'agent-instructions' } }
const catalogMessage = { id: 'c', content: [], source: { kind: 'skill-catalog' } }
const gestureMessage = { id: 'g', content: [], source: { kind: 'skill-invocation' } }
const snapshotMessage = {
  id: 'snap',
  content: [],
  source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot' },
}
const thirdPartyMessage = { id: 'tp', content: [], source: { kind: 'plugin', plugin: 'dsh-claude-move' } }

const POLICY_CONTEXTS = [
  { name: 'sandbox-policy', text: 'sandbox: landlock confinement active' },
  { name: 'user-approval', text: 'approval: required for network access' },
  { name: 'claude-move-memory', text: 'project memory digest …' },
]

test('exports a diagnostic plugin name', () => {
  assert.equal(name, 'anchored-context-gate')
})

// ── path (a): runtime-context suppression on the assembly ───────────────────

test('unpromoted assembly has its contexts blanked', async () => {
  const { listeners } = register()
  const result = await assemble(listeners['system-prompt/assemble'], [], POLICY_CONTEXTS)
  assert.deepEqual(result.contexts, [])
  // Everything else on the assembly passes through untouched.
  assert.deepEqual(result.tools.map((tool) => tool.name), ['bash', 'str_replace_editor'])
  assert.equal(result.sections.length, 1)
})

test('a durable tool call opens the gate: contexts flow', async () => {
  const { listeners } = register()
  const result = await assemble(listeners['system-prompt/assemble'], [{ type: 'tool/call' }], POLICY_CONTEXTS)
  assert.deepEqual(result.contexts, POLICY_CONTEXTS)
})

test('a first assistant message opens the gate: contexts flow', async () => {
  const { listeners } = register()
  const result = await assemble(listeners['system-prompt/assemble'], [{ type: 'assistant/message' }], POLICY_CONTEXTS)
  assert.deepEqual(result.contexts, POLICY_CONTEXTS)
})

test('an assembly without contexts passes through unchanged', async () => {
  const { listeners } = register()
  const result = await assemble(listeners['system-prompt/assemble'], [], [])
  assert.deepEqual(result.contexts, [])
})

// ── path (b): claimed-baseline deny on the pre-step waterfall ───────────────

test('the pre-step gate registers with prepend before every other listener', () => {
  const { hookOptions } = register()
  assert.deepEqual(hookOptions['agent/pre-step'], { prepend: true })
})

test('unpromoted pre-step keeps the claimed batch and allowed kinds only', async () => {
  const { listeners } = register()
  const claimed = [userMessage, toolResultMessage]
  const decision = await prestep(
    listeners['agent/pre-step'],
    [],
    [userMessage, toolResultMessage, instructionMessage, catalogMessage, gestureMessage, snapshotMessage, thirdPartyMessage],
    claimed,
  )
  assert.equal(decision.kind, 'enter')
  // The claimed pair survives (a source-less tool-result continuation too);
  // the user gesture survives via the default allowlist; every automatic or
  // third-party injection is stripped regardless of source identity.
  assert.deepEqual(decision.messages.map((message) => message.id), ['u', 'tr', 'g'])
})

test('unpromoted pre-step keeps claimed messages when a listener clones them', async () => {
  const { listeners } = register()
  const claimed = [{ ...userMessage, source: { ...userMessage.source } }]
  const cloned = { ...claimed[0], content: [...claimed[0].content] }
  const decision = await prestep(
    listeners['agent/pre-step'],
    [],
    [cloned, instructionMessage],
    claimed,
  )
  assert.deepEqual(decision.messages.map((message) => message.id), ['u'])
})

test('promoted pre-step keeps every injected context message', async () => {
  const { listeners } = register()
  const messages = [userMessage, instructionMessage, catalogMessage, snapshotMessage, thirdPartyMessage]
  const decision = await prestep(listeners['agent/pre-step'], [{ type: 'tool/call' }], messages, [userMessage])
  assert.equal(decision.messages, messages)
})

test('reject decisions pass through the gate untouched', async () => {
  const { listeners } = register()
  const decision = { kind: 'reject', messages: [userMessage] }
  const result = await listeners['agent/pre-step'](
    { agent: agent([]), messages: [userMessage], turn: 1, step: 1, signal: {} },
    async () => decision,
  )
  assert.equal(result, decision)
})

test('a missing claimed payload degrades to keeping every message', async () => {
  const { listeners } = register()
  const messages = [userMessage, instructionMessage, catalogMessage]
  const decision = await prestep(listeners['agent/pre-step'], [], messages, undefined)
  assert.equal(decision.messages, messages)
})

// ── compaction epoch ────────────────────────────────────────────────────────

test('a compaction boundary re-closes the gate until a new promotion signal', async () => {
  const { listeners } = register()
  const events = [
    { type: 'assistant/message', seq: 1, data: {} },
    { type: 'compaction/end', seq: 2 },
  ]
  const gatedContexts = await assemble(listeners['system-prompt/assemble'], events, POLICY_CONTEXTS)
  assert.deepEqual(gatedContexts.contexts, [])
  const gatedMessages = await prestep(
    listeners['agent/pre-step'], events,
    [userMessage, instructionMessage, snapshotMessage], [userMessage],
  )
  assert.deepEqual(gatedMessages.messages.map((message) => message.id), ['u'])
  // The live harness feeds new events through session/event; emulate that.
  listeners['session/event']({ id: 's', events }, { type: 'tool/call', seq: 3, data: { name: 'bash' } })
  const openContexts = await assemble(listeners['system-prompt/assemble'], events, POLICY_CONTEXTS)
  assert.deepEqual(openContexts.contexts, POLICY_CONTEXTS)
})

// ── subagents ───────────────────────────────────────────────────────────────

test('subagents skip the gate by default', async () => {
  const { listeners } = register()
  const sub = { delegationDepth: 1 }
  const contexts = await assemble(listeners['system-prompt/assemble'], [], POLICY_CONTEXTS, 'sub', sub)
  assert.deepEqual(contexts.contexts, POLICY_CONTEXTS)
  const messages = [userMessage, instructionMessage, catalogMessage]
  const decision = await prestep(listeners['agent/pre-step'], [], messages, [userMessage], 'sub', sub)
  assert.equal(decision.messages, messages)
})

test('includeSubagents gates a subagent until its own promotion signal', async () => {
  const { listeners } = register({ includeSubagents: true })
  const sub = { delegationDepth: 1 }
  const gatedContexts = await assemble(listeners['system-prompt/assemble'], [], POLICY_CONTEXTS, 'sub', sub)
  assert.deepEqual(gatedContexts.contexts, [])
  const gatedMessages = await prestep(
    listeners['agent/pre-step'], [], [userMessage, instructionMessage], [userMessage], 'sub', sub,
  )
  assert.deepEqual(gatedMessages.messages.map((message) => message.id), ['u'])
  const open = await assemble(
    listeners['system-prompt/assemble'], [{ type: 'assistant/message' }], POLICY_CONTEXTS, 'sub-replied', sub,
  )
  assert.deepEqual(open.contexts, POLICY_CONTEXTS)
})

// ── config surface ──────────────────────────────────────────────────────────

test('enabled: false disables both interception paths', async () => {
  const { listeners } = register({ enabled: false })
  const contexts = await assemble(listeners['system-prompt/assemble'], [], POLICY_CONTEXTS)
  assert.deepEqual(contexts.contexts, POLICY_CONTEXTS)
  const messages = [userMessage, instructionMessage, catalogMessage]
  const decision = await prestep(listeners['agent/pre-step'], [], messages, [userMessage])
  assert.equal(decision.messages, messages)
})

test('allowKinds is configurable', async () => {
  const { listeners } = register({ allowKinds: ['skill-invocation', 'instruction-hint'] })
  const decision = await prestep(
    listeners['agent/pre-step'], [],
    [userMessage, instructionMessage, catalogMessage, gestureMessage, { id: 'h', content: [], source: { kind: 'instruction-hint' } }],
    [userMessage],
  )
  assert.deepEqual(decision.messages.map((message) => message.id), ['u', 'g', 'h'])
})

test('an explicitly empty allowKinds keeps ONLY the claimed batch', async () => {
  const { listeners } = register({ allowKinds: [] })
  const decision = await prestep(
    listeners['agent/pre-step'], [],
    [userMessage, instructionMessage, gestureMessage], [userMessage],
  )
  assert.deepEqual(decision.messages.map((message) => message.id), ['u'])
})

test('invalid allowKinds values fail at apply time', () => {
  assert.throws(() => register({ allowKinds: 'skill-invocation' }), /allowKinds/)
  assert.throws(() => register({ allowKinds: ['skill-invocation', 42] }), /allowKinds/)
})

test('invalid promoteOn values fail at apply time', () => {
  assert.throws(() => register({ promoteOn: 'bogus' }), /promoteOn/)
})

test('invalid boolean flags fail at apply time', () => {
  assert.throws(() => register({ includeSubagents: 'yes' }), /includeSubagents/)
  assert.throws(() => register({ enabled: 0 }), /enabled/)
})

test('unknown config keys reject at apply time', () => {
  assert.throws(() => register({ suppressedContextSources: [] }), /unknown config key/)
  assert.throws(() => register(null), /config must be an object/)
  assert.throws(() => register([]), /config must be an object/)
})
