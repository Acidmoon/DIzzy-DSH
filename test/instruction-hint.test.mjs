import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, name } from '../shared/instruction-hint.mjs'

const PROJ_FILES = ['AGENTS.md', 'CLAUDE.md']
const GLOBAL_FILES = []

function register(cfg = {}) {
  const listeners = {}
  const hookOptions = {}
  const fs = {
    async resolve(target) {
      return target
    },
    async stat(target) {
      const base = target.replace(/\\/g, '/').split('/').pop()
      if (PROJ_FILES.includes(base)) return { type: 'file' }
      if (GLOBAL_FILES.includes(base)) return { type: 'file' }
      if (base === '.git' || base === '.hg' || base === '.svn') return { type: 'directory' }
      throw new Error('ENOENT')
    },
  }
  const ctx = {
    on(event, callback, options) {
      listeners[event] = callback
      hookOptions[event] = options
    },
    get(service) {
      if (service === 'fs') return fs
      return undefined
    },
    logger: { warn() {} },
  }
  apply(ctx, { promoteOn: 'either', ...cfg })
  return { listeners, hookOptions }
}

const session = (events, header = {}, id = 's') => ({ id, events, header: { cwd: 'C:/work', ...header } })

const decision = () => ({ kind: 'enter', messages: [{ id: 'u', role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }] })

test('exports a diagnostic plugin name', () => {
  assert.equal(name, 'instruction-hint')
})

test('pre-promotion requests get NO hint', async () => {
  const { listeners } = register()
  const d = decision()
  const result = await listeners['agent/pre-step'](
    { agent: { session: session([]) } },
    async () => d,
  )
  assert.equal(result, d)
})

test('after promotion ONE hint is injected once per session', async () => {
  const { listeners } = register()
  const agent = { session: session([{ type: 'assistant/message', seq: 1, data: {} }]) }
  const first = await listeners['agent/pre-step']({ agent }, async () => decision())
  assert.equal(first.messages.length, 2)
  const hint = first.messages[1]
  assert.equal(hint.source.kind, 'instruction-hint')
  assert.match(hint.content[0].text, /AGENTS\.md, CLAUDE\.md/)
  // Second call for the same session: no duplicate hint.
  const second = await listeners['agent/pre-step']({ agent }, async () => decision())
  assert.equal(second.messages.length, 1)
})

test('a process restart does not re-inject: the guard is durable', async () => {
  // A fresh plugin instance (new process) over a session log that already
  // carries one hint message — the same deterministic id twice would break
  // history replay.
  const { listeners } = register()
  const agent = { session: session([
    { type: 'assistant/message', seq: 1, data: {} },
    { type: 'user/message', seq: 2, data: { id: 'instruction-hint-s', content: [], source: { kind: 'instruction-hint' } } },
  ]) }
  const result = await listeners['agent/pre-step']({ agent }, async () => decision())
  assert.equal(result.messages.length, 1)
})

test('subagents get the hint immediately by default (they count as promoted)', async () => {
  const { listeners } = register()
  const agent = { session: session([], { delegationDepth: 1 }) }
  const result = await listeners['agent/pre-step']({ agent }, async () => decision())
  assert.equal(result.messages.length, 2)
  assert.equal(result.messages[1].source.kind, 'instruction-hint')
})

test('includeSubagents waits for the subagent own promotion signal', async () => {
  const { listeners } = register({ promoteOn: 'either', includeSubagents: true })
  const fresh = { session: session([], { delegationDepth: 1 }, 'sub-fresh') }
  const none = await listeners['agent/pre-step']({ agent: fresh }, async () => decision())
  assert.equal(none.messages.length, 1)
  const replied = { session: session([{ type: 'assistant/message', seq: 1, data: {} }], { delegationDepth: 1 }, 'sub-replied') }
  const hint = await listeners['agent/pre-step']({ agent: replied }, async () => decision())
  assert.equal(hint.messages.length, 2)
  assert.equal(hint.messages[1].source.kind, 'instruction-hint')
})

test('unknown config keys reject at apply time', () => {
  assert.throws(() => register({ promoteOn: 'either', includeSubagent: true }), /unknown config key/)
  assert.throws(() => register({ includeSubagents: 'yes' }), /includeSubagents/)
})

test('no instruction files found → no hint message', async () => {
  const listeners = {}
  const fs = {
    async resolve(target) { return target },
    async stat() { throw new Error('ENOENT') },
  }
  const ctx = {
    on(event, callback) { listeners[event] = callback },
    get(service) { return service === 'fs' ? fs : undefined },
    logger: { warn() {} },
  }
  apply(ctx, { promoteOn: 'either' })
  const agent = { session: session([{ type: 'assistant/message', seq: 1, data: {} }]) }
  const result = await listeners['agent/pre-step']({ agent }, async () => decision())
  assert.equal(result.messages.length, 1)
})

test('missing fs service degrades to no hint (never throws)', async () => {
  const listeners = {}
  const ctx = {
    on(event, callback) { listeners[event] = callback },
    get() { return undefined },
    logger: { warn() {} },
  }
  apply(ctx, { promoteOn: 'either' })
  const agent = { session: session([{ type: 'assistant/message', seq: 1, data: {} }]) }
  const result = await listeners['agent/pre-step']({ agent }, async () => decision())
  assert.equal(result.messages.length, 1)
})

test('the hint registers with prepend', () => {
  const { hookOptions } = register()
  assert.deepEqual(hookOptions['agent/pre-step'], { prepend: true })
})
