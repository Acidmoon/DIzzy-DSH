import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, inject, name, parseSseStream, serializeThinkRequest } from '../shared/toolchoice-adapter.mjs'

function registerAdapterCtx(config, registerError = undefined) {
  const registered = []
  const infos = []
  const logs = []
  const warns = []
  const ctx = {
    get(service) {
      if (service === 'settings') return { describe: () => [] }
      return undefined
    },
    llm: {
      registerAdapter(providers, adapter) {
        if (registerError !== undefined) throw registerError
        registered.push({ providers, adapter })
      },
    },
    logger: {
      warn(message) {
        warns.push(message)
      },
      info(message) {
        logs.push(message)
      },
    },
  }
  apply(ctx, config)
  assert.ok(registered.length <= 1)
  return { registration: registered[0], infos, logs, warns, ctx }
}

function sseStream(chunks) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

const OPTIONS = () => ({
  provider: 'deepseek-wire-think',
  model: 'deepseek-v4-pro',
  reasoningEffort: 'max',
  system: 'You are a helpful software engineer assistant.',
  messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }],
  tools: [{ name: 'bash', description: 'shell', parameters: { type: 'object' } }],
  sessionId: 's1',
})

const REAL_ENV_KEY = process.env.DEEPSEEK_API_KEY

test('exports a diagnostic plugin name and the llm inject', () => {
  assert.equal(name, 'toolchoice-adapter')
  assert.deepEqual(inject, ['llm'])
})

test('registers a duck-typed adapter under its own provider id', () => {
  const { registration } = registerAdapterCtx({ provider: 'my-think-route' })
  assert.deepEqual(registration.providers, ['my-think-route'])
  assert.equal(registration.adapter.providerInfo('my-think-route').id, 'my-think-route')
  assert.equal(typeof registration.adapter.stream, 'function')
})

test('a duplicate registration is caught and warned, never thrown', () => {
  const { registration, warns } = registerAdapterCtx({}, new Error('an adapter for provider "x" is already registered'))
  assert.equal(registration, undefined)
  assert.equal(warns.length, 1)
  assert.ok(warns[0].includes('degrade'))
})

test('the wire request carries tool_choice none exactly when tools are present', () => {
  const withTools = serializeThinkRequest(OPTIONS(), {})
  assert.equal(withTools.tool_choice, 'none')
  assert.ok(Array.isArray(withTools.tools))
  assert.equal(withTools.tools[0].function.name, 'bash')

  const withoutTools = serializeThinkRequest({ ...OPTIONS(), tools: [] }, {})
  assert.equal(withoutTools.tool_choice, undefined)
  assert.equal(withoutTools.tools, undefined)

  assert.equal(serializeThinkRequest(OPTIONS(), { toolChoice: 'auto' }).tool_choice, 'auto')
})

test('thinking and sampling map like the official wire format', () => {
  const body = serializeThinkRequest(OPTIONS(), {})
  assert.deepEqual(body.thinking, { type: 'enabled' })
  assert.equal(body.reasoning_effort, 'max')
  assert.equal(body.stream, true)
  assert.deepEqual(body.stream_options, { include_usage: true })
  assert.equal(body.model, 'deepseek-v4-pro')
  assert.equal(body.messages[0].role, 'system')

  const off = serializeThinkRequest({ ...OPTIONS(), reasoningEffort: 'off' }, {})
  assert.deepEqual(off.thinking, { type: 'disabled' })
  assert.equal(off.reasoning_effort, undefined)

  const title = serializeThinkRequest({ ...OPTIONS(), purpose: 'session-title' }, {})
  assert.deepEqual(title.thinking, { type: 'disabled' })
})

test('history serialization follows the official nuances', () => {
  const messages = [
    { id: 'm1', role: 'assistant', content: [
      { type: 'reasoning', text: 'think' },
      { type: 'text', text: 'plan' },
      { type: 'tool-call', id: 'call1', name: 'bash', arguments: '{"command":"ls"}' },
    ], source: { kind: 'user' } },
    { id: 'u2', role: 'user', content: [
      { type: 'tool-result', toolCallId: 'call1', content: [] },
    ], source: { kind: 'user' } },
    { id: 'm2', role: 'assistant', content: [{ type: 'text', text: '' }], source: { kind: 'user' } },
  ]
  const body = serializeThinkRequest({ ...OPTIONS(), messages }, {})
  const [assistant, tool, bare] = body.messages.slice(1)
  assert.equal(assistant.role, 'assistant')
  assert.equal(assistant.content, 'plan')
  assert.equal(assistant.reasoning_content, 'think')
  assert.deepEqual(assistant.tool_calls, [{ id: 'call1', type: 'function', function: { name: 'bash', arguments: '{"command":"ls"}' } }])
  assert.equal(tool.role, 'tool')
  assert.equal(tool.tool_call_id, 'call1')
  assert.equal(tool.content, '(no output)')
  assert.equal(bare.role, 'assistant')
  assert.equal(bare.content, '')
})

test('logprobs lands on the wire only when opted in', () => {
  assert.equal(serializeThinkRequest(OPTIONS(), {}).logprobs, undefined)
  const withLogprobs = serializeThinkRequest(OPTIONS(), { logprobs: true })
  assert.equal(withLogprobs.logprobs, true)
  assert.equal(withLogprobs.top_logprobs, 1)
})

test('the SSE parser handles split frames, CRLF, and yields [DONE] last', async () => {
  const stream = sseStream([
    'data: {"choices":[{"delta":{"reasoning_con',
    'tent":"We"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\r\n\r\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
    'data: [DONE]\n\n',
  ])
  const payloads = []
  for await (const payload of parseSseStream(stream)) payloads.push(payload)
  assert.equal(payloads.length, 4)
  assert.deepEqual(JSON.parse(payloads[0]).choices[0].delta, { reasoning_content: 'We' })
  assert.equal(payloads[3], '[DONE]')
})

test('stream() translates a full think response into harness chunks', async () => {
  process.env.DEEPSEEK_API_KEY = 'test-key'
  const { registration, logs } = registerAdapterCtx({ baseURL: 'https://example.test', logprobs: false })
  const bodies = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    bodies.push({ url, init })
    return new Response(sseStream([
      'data: {"choices":[{"delta":{"reasoning_content":"We need"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":" to plan"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Here is the plan"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":7,"prompt_cache_hit_tokens":4,"completion_tokens_details":{"reasoning_tokens":6}}}\n\n',
      'data: [DONE]\n\n',
    ]), { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  try {
    const chunks = []
    for await (const chunk of registration.adapter.stream(OPTIONS())) chunks.push(chunk)

    assert.equal(bodies[0].url, 'https://example.test/chat/completions')
    const sentBody = JSON.parse(bodies[0].init.body)
    assert.equal(sentBody.tool_choice, 'none')
    assert.equal(bodies[0].init.headers.authorization, 'Bearer test-key')
    assert.equal(bodies[0].init.headers.accept, 'text/event-stream')

    const starts = chunks.filter((chunk) => chunk.type === 'block-start')
    assert.deepEqual(starts.map((chunk) => chunk.blockType), ['reasoning', 'text'])
    const reasoningDeltas = chunks.filter((chunk) => chunk.type === 'reasoning-delta').map((chunk) => chunk.text).join('')
    assert.equal(reasoningDeltas, 'We need to plan')
    const textDeltas = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('')
    assert.equal(textDeltas, 'Here is the plan')
    const ends = chunks.filter((chunk) => chunk.type === 'block-end')
    assert.deepEqual(ends.map((end) => end.block.type).sort(), ['reasoning', 'text'])
    const usage = chunks.find((chunk) => chunk.type === 'usage')
    assert.deepEqual(usage.usage, { inputTokens: 6, outputTokens: 7, cacheReadTokens: 4, reasoningTokens: 6 })
    const finish = chunks.find((chunk) => chunk.type === 'finish')
    assert.deepEqual(finish.reason, { kind: 'stop' })
    assert.equal(chunks.indexOf(finish), chunks.length - 1)
    assert.equal(logs.length, 0)
  } finally {
    globalThis.fetch = originalFetch
    if (REAL_ENV_KEY === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = REAL_ENV_KEY
  }
})

test('stream() summarizes logprobs when the opt-in flag is set', async () => {
  process.env.DEEPSEEK_API_KEY = 'test-key'
  const { registration, logs } = registerAdapterCtx({ baseURL: 'https://example.test', logprobs: true })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(sseStream([
    'data: {"choices":[{"delta":{"content":"Hi"},"logprobs":{"content":[{"token":"Hi","logprob":-0.5}]}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ]), { status: 200 })
  try {
    const chunks = []
    for await (const chunk of registration.adapter.stream(OPTIONS())) chunks.push(chunk)
    assert.ok(chunks.some((chunk) => chunk.type === 'finish'))
    assert.equal(logs.length, 1)
    assert.ok(logs[0].includes('mean='))
  } finally {
    globalThis.fetch = originalFetch
    if (REAL_ENV_KEY === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = REAL_ENV_KEY
  }
})

test('HTTP failures map to coded errors', async () => {
  process.env.DEEPSEEK_API_KEY = 'test-key'
  const { registration } = registerAdapterCtx({ baseURL: 'https://example.test' })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 })
  try {
    await assert.rejects(
      () => registration.adapter.stream(OPTIONS()).next(),
      (error) => error.code === 'AUTH' && /bad key/.test(error.message),
    )
  } finally {
    globalThis.fetch = originalFetch
    if (REAL_ENV_KEY === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = REAL_ENV_KEY
  }
})

test('a missing API key fails with MISSING_CREDENTIAL before any fetch', async () => {
  const savedKey = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  const { registration } = registerAdapterCtx({ baseURL: 'https://example.test', apiKeyEnv: 'TOOLCHOICE_TEST_KEY' })
  try {
    await assert.rejects(
      () => registration.adapter.stream(OPTIONS()).next(),
      (error) => error.code === 'MISSING_CREDENTIAL',
    )
  } finally {
    if (savedKey !== undefined) process.env.DEEPSEEK_API_KEY = savedKey
  }
})
