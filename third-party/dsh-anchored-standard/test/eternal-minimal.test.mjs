import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, inject, name } from '../eternal-minimal/eternal-minimal.mjs'

/** The registry surface the gateway uses. */
function makeTools() {
  const executed = []
  const tools = {
    executed,
    schemas: () => [
      { name: 'bash', description: 'shell' },
      { name: 'str_replace_editor', description: 'editor' },
      { name: 'web_search', description: 'search the web' },
      { name: 'todo_write', description: 'write todos' },
    ],
    async execute(input) {
      executed.push(input)
      if (tools.nextResult) return tools.nextResult
      return {
        isError: false,
        value: { ok: true },
        content: [{ type: 'text', text: 'SEARCH RESULTS' }],
      }
    },
  }
  return tools
}

function register(config, tools = makeTools()) {
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
    tools,
  }
  apply(ctx, config)
  assert.equal(typeof listeners['system-prompt/assemble'], 'function')
  return { listeners, hookOptions, warns, tools }
}

async function assemble(listener, tools) {
  return listener(undefined, { agent: undefined }, async () => ({ system: 'minimal persona', tools }))
}

function bashExec(command, agent = undefined) {
  return {
    name: 'bash',
    arguments: { command },
    agent,
    signal: new AbortController().signal,
  }
}

const FULL_CATALOG = () => [
  { name: 'bash' }, { name: 'str_replace_editor' }, { name: 'read' },
  { name: 'web_search' }, { name: 'todo_write' }, { name: 'subagent' },
]

const allow = async () => ({ kind: 'allow' })

const userMessage = { id: 'u', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }
const catalogMessage = { id: 'c', content: [], source: { kind: 'skill-catalog' } }

test('exports a diagnostic plugin name and declares the tools inject', () => {
  assert.equal(name, 'eternal-minimal')
  assert.deepEqual(inject, ['tools'])
})

test('the visible catalog is exactly the Minimal pair on every request', async () => {
  const { listeners } = register()
  // No promotion concept: the same filter applies to any assembly.
  const result = await assemble(listeners['system-prompt/assemble'], FULL_CATALOG())
  assert.deepEqual(result.tools.map((tool) => tool.name).sort(), ['bash', 'str_replace_editor'])
})

test('both shells stay visible when present', async () => {
  const { listeners } = register()
  const result = await assemble(listeners['system-prompt/assemble'], [...FULL_CATALOG(), { name: 'pwsh' }])
  assert.deepEqual(result.tools.map((tool) => tool.name).sort(), ['bash', 'pwsh', 'str_replace_editor'])
})

test('the capability guide is appended to the system prompt by default', async () => {
  const { listeners } = register()
  const result = await assemble(listeners['system-prompt/assemble'], FULL_CATALOG())
  assert.ok(result.system.startsWith('minimal persona'))
  assert.ok(result.system.includes('dshx'))
})

test('guide: false keeps the system prompt byte-identical', async () => {
  const { listeners } = register({ guide: false })
  const result = await assemble(listeners['system-prompt/assemble'], FULL_CATALOG())
  assert.equal(result.system, 'minimal persona')
})

test('a missing editor degrades to the full catalog with one warning', async () => {
  const { listeners, warns } = register()
  const result = await assemble(listeners['system-prompt/assemble'], [{ name: 'bash' }, { name: 'read' }])
  assert.deepEqual(result.tools.map((tool) => tool.name).sort(), ['bash', 'read'])
  assert.equal(warns.length, 1)
})

test('auto-injected context is stripped on every request (no promotion boundary)', async () => {
  const { listeners } = register()
  const decision = await listeners['agent/pre-step'](
    { agent: { session: { id: 's', events: [{ type: 'assistant/message' }], header: {} } }, messages: [] },
    async () => ({ kind: 'enter', messages: [userMessage, catalogMessage] }),
  )
  assert.deepEqual(decision.messages.map((message) => message.id), ['u'])
})

test('the assemble and pre-step listeners register with prepend', () => {
  const { hookOptions } = register()
  assert.deepEqual(hookOptions['system-prompt/assemble'], { prepend: true })
  assert.deepEqual(hookOptions['agent/pre-step'], { prepend: true })
})

test('dshx list denies with the gateway catalog (shells and editor excluded)', async () => {
  const { listeners } = register()
  const decision = await listeners['tools/pre-execute'](bashExec('dshx list'), allow)
  assert.equal(decision.kind, 'deny')
  assert.ok(decision.reason.includes('web_search'))
  assert.ok(decision.reason.includes('todo_write'))
  assert.ok(!decision.reason.includes('- bash:'))
  assert.ok(!decision.reason.includes('str_replace_editor'))
})

test('dshx <tool> <json> executes the real tool and returns its output', async () => {
  const { listeners, tools } = register()
  const agent = { session: { id: 's', events: [], header: {} } }
  const decision = await listeners['tools/pre-execute'](
    bashExec(`dshx web_search '{"query": "zod v4"}'`, agent),
    allow,
  )
  assert.equal(decision.kind, 'deny')
  assert.ok(decision.reason.includes('executed successfully'))
  assert.ok(decision.reason.includes('SEARCH RESULTS'))
  assert.equal(tools.executed.length, 1)
  assert.equal(tools.executed[0].name, 'web_search')
  assert.deepEqual(tools.executed[0].arguments, { query: 'zod v4' })
  assert.equal(tools.executed[0].agent, agent)
})

test('a tool error is reported as an error in the gateway payload', async () => {
  const tools = makeTools()
  tools.nextResult = { isError: true, error: { code: 'UNKNOWN_TOOL' }, content: [{ type: 'text', text: 'no such tool' }] }
  const { listeners } = register({}, tools)
  const decision = await listeners['tools/pre-execute'](bashExec("dshx nope '{}'"), allow)
  assert.equal(decision.kind, 'deny')
  assert.ok(decision.reason.includes('reported an error'))
  assert.ok(decision.reason.includes('no such tool'))
})

test('malformed JSON arguments get a usage hint instead of executing', async () => {
  const { listeners, tools } = register()
  const decision = await listeners['tools/pre-execute'](bashExec("dshx web_search '{query: broken}'"), allow)
  assert.equal(decision.kind, 'deny')
  assert.ok(decision.reason.includes('not valid JSON'))
  assert.equal(tools.executed.length, 0)
})

test('gatewaying the shells or the editor is refused (recursion guard)', async () => {
  const { listeners, tools } = register()
  for (const command of ['dshx bash ls', "dshx str_replace_editor '{}'"]) {
    const decision = await listeners['tools/pre-execute'](bashExec(command), allow)
    assert.equal(decision.kind, 'deny')
    assert.ok(decision.reason.includes('invoke it directly'))
  }
  assert.equal(tools.executed.length, 0)
})

test('ordinary bash commands and non-shell tools pass through untouched', async () => {
  const { listeners, tools } = register()
  let passed = 0
  const counter = async () => {
    passed += 1
    return { kind: 'allow' }
  }
  assert.equal((await listeners['tools/pre-execute'](bashExec('ls -la'), counter)).kind, 'allow')
  assert.equal(
    (await listeners['tools/pre-execute']({ name: 'str_replace_editor', arguments: {}, signal: new AbortController().signal }, counter)).kind,
    'allow',
  )
  assert.equal(passed, 2)
  assert.equal(tools.executed.length, 0)
})

test('gateway: false never registers the interception listener', async () => {
  const { listeners, tools } = register({ gateway: false })
  assert.equal(listeners['tools/pre-execute'], undefined)
  assert.equal(tools.executed.length, 0)
})

test('a custom gatewayCommand changes the interception word', async () => {
  const { listeners } = register({ gatewayCommand: 'xtool' })
  const listed = await listeners['tools/pre-execute'](bashExec('xtool list'), allow)
  assert.equal(listed.kind, 'deny')
  // `dshx ...` no longer intercepts.
  let passed = 0
  const decision = await listeners['tools/pre-execute'](bashExec('dshx list'), async () => {
    passed += 1
    return { kind: 'allow' }
  })
  assert.equal(decision.kind, 'allow')
  assert.equal(passed, 1)
})

test('huge gateway output is capped', async () => {
  const tools = makeTools()
  tools.nextResult = { isError: false, value: {}, content: [{ type: 'text', text: 'x'.repeat(50_000) }] }
  const { listeners } = register({ maxGatewayChars: 100 }, tools)
  const decision = await listeners['tools/pre-execute'](bashExec("dshx web_search '{}'"), allow)
  assert.ok(decision.reason.length < 400)
  assert.ok(decision.reason.includes('truncated'))
})

test('invalid suppressedContextSources fails at apply time', () => {
  assert.throws(() => register({ suppressedContextSources: [42] }), /suppressedContextSources/)
})
