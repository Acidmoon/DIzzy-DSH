import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, name } from '../preset/tool-bootstrap.mjs'

const config = {
  commonTools: ['read'],
  shellTools: ['bash', 'pwsh'],
}

function register() {
  let listener
  const ctx = {
    on(event, callback) {
      assert.equal(event, 'system-prompt/assemble')
      listener = callback
    },
  }
  apply(ctx, config)
  assert.equal(typeof listener, 'function')
  return listener
}

async function assemble(listener, events, tools) {
  return listener(
    undefined,
    { agent: { session: { events } } },
    async () => ({ system: 'minimal persona', tools }),
  )
}

test('exports a diagnostic plugin name', () => {
  assert.equal(name, 'anchored-tool-bootstrap')
})

test('first request exposes one platform shell and read', async () => {
  const listener = register()
  const tools = [
    { name: 'pwsh' },
    { name: 'read' },
    { name: 'edit' },
  ]
  const result = await assemble(listener, [], tools)
  assert.deepEqual(result.tools.map(tool => tool.name), ['pwsh', 'read'])
})

test('a durable tool call promotes the complete catalog', async () => {
  const listener = register()
  const tools = [
    { name: 'pwsh' },
    { name: 'read' },
    { name: 'edit' },
    { name: 'grep' },
  ]
  const events = [{ type: 'tool/call', data: { name: 'read' } }]
  const result = await assemble(listener, events, tools)
  assert.deepEqual(result.tools, tools)
})

test('sessions derive promotion independently from their own events', async () => {
  const listener = register()
  const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'write' }]
  const promoted = await assemble(listener, [{ type: 'tool/call' }], tools)
  const fresh = await assemble(listener, [], tools)
  assert.deepEqual(promoted.tools, tools)
  assert.deepEqual(fresh.tools.map(tool => tool.name), ['bash', 'read'])
})

test('misconfigured bootstrap catalogs fail loudly', async () => {
  const listener = register()
  await assert.rejects(
    assemble(listener, [], [{ name: 'read' }, { name: 'edit' }]),
    /expected exactly one bootstrap shell/,
  )
})
