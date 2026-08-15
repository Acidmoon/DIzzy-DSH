/**
 * 思考强度（reasoning effort）测试（node 直接跑）：
 * 1. resolveModel 返回 reasoning 元数据（efforts + defaultEffort）→ 模型选择器
 *    显示「推理等级」菜单；
 * 2. ChatGptAdapter（ChatGPT/Grok）：显式 effort 序列化为 responses 请求的
 *    reasoning.effort；未选择/未声明渠道不发送该字段；
 * 3. AnthropicMessagesAdapter：Claude 发 output_config.effort（含 xhigh/max），
 *    Kimi 发顶层 reasoning_effort（含 max）；未声明 wireEffort 才回退 thinking。
 * 运行：node tests/reasoning-wire.mjs
 */
import assert from 'node:assert'
import { ChatGptAdapter } from '../lib/adapter.js'
import { AnthropicMessagesAdapter } from '../lib/adapters/anthropic.js'

/** 捕获 stream() 发出的请求体（mock fetch），返回 SSE 完成流。 */
function captureStream(fetchMock) {
  let captured = undefined
  globalThis.fetch = async (_url, init) => {
    captured = JSON.parse(String(init?.body ?? '{}'))
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(
          'event: response.completed\ndata: {"response":{"status":"completed"}}\n\n',
        ))
        c.close()
      },
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  return { body: () => captured }
}

const baseOptions = {
  apiBaseURL: 'https://example.com/v1/responses',
  maxTokens: 8192,
  models: [
    { id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 400_000 },
    { id: 'grok-4.3', name: 'Grok 4.3', contextWindow: 1_000_000 },
  ],
  defaultContextWindow: 400_000,
}

const callOptions = {
  provider: 'chatgpt',
  model: 'gpt-5.5',
  messages: [],
}

const drain = async (iter) => {
  for await (const _chunk of iter) {
    /* 只驱动生成器，不做断言 */
  }
}

// ---------- 1. resolveModel 的 reasoning 元数据 ----------
{
  const adapter = new ChatGptAdapter({
    options: () => baseOptions,
    resolveAccessToken: async () => ({ access: 't' }),
    reasoning: {
      efforts: [
        { id: 'minimal', name: 'Minimal' },
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
        { id: 'xhigh', name: 'Extra High' },
        { id: 'max', name: 'Max' },
      ],
      defaultEffort: 'medium',
    },
  })
  const info = await adapter.resolveModel('chatgpt', 'gpt-5.5')
  assert.deepEqual(info.reasoning?.efforts.map((e) => e.id), ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  assert.equal(info.reasoning?.defaultEffort, 'medium')
  assert.equal(info.reasoning?.efforts[2].name, 'Medium')
  assert.equal(info.context?.contextWindow, 400_000)
  assert.equal(info.defaultMaxTokens, 8192)
  console.log('✓ 1. resolveModel 返回 reasoning 元数据（efforts + defaultEffort）')
}

// ---------- 2a. ChatGptAdapter：显式 effort → reasoning.effort ----------
{
  const adapter = new ChatGptAdapter({
    options: () => baseOptions,
    resolveAccessToken: async () => ({ access: 't' }),
    reasoning: {
      efforts: [
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
      ],
    },
  })
  const cap = captureStream()
  await drain(adapter.stream({ ...callOptions, reasoningEffort: 'max' }))
  assert.deepEqual(cap.body().reasoning, { effort: 'max' }, 'Responses 请求体携带 reasoning.effort')
  console.log('✓ 2a. ChatGptAdapter 显式 effort=max → body.reasoning.effort=max')
}

// ---------- 2b. 未选择 effort → 不发送 reasoning 字段 ----------
{
  const adapter = new ChatGptAdapter({
    options: () => baseOptions,
    resolveAccessToken: async () => ({ access: 't' }),
    reasoning: {
      efforts: [{ id: 'high', name: 'High' }],
    },
  })
  const cap = captureStream()
  await drain(adapter.stream({ ...callOptions, model: 'grok-4.3' }))
  assert.equal(cap.body().reasoning, undefined, '未选择 effort 时不发送 reasoning')
  console.log('✓ 2b. 未选择 effort → 请求体无 reasoning 字段')
}

// ---------- 2c. 未声明 reasoning 的渠道 → 请求体无 reasoning ----------
{
  const adapter = new ChatGptAdapter({
    options: () => baseOptions,
    resolveAccessToken: async () => ({ access: 't' }),
  })
  const info = await adapter.resolveModel('chatgpt', 'gpt-5.5')
  assert.equal(info.reasoning, undefined, '未声明渠道的模型无 reasoning 元数据')
  const cap = captureStream()
  await drain(adapter.stream({ ...callOptions, reasoningEffort: 'high' }))
  assert.equal(cap.body().reasoning, undefined, '未声明渠道即使携带 effort 也不发送 reasoning')
  console.log('✓ 2c. 未声明 reasoning 的渠道：无元数据、请求体不发送')
}

// ---------- 3a. Claude：effort → output_config.effort ----------
{
  const adapter = new AnthropicMessagesAdapter({
    options: () => ({
      apiBaseURL: 'https://example.com/v1/messages',
      maxTokens: 64000,
      models: [{ id: 'claude-sonnet-5', name: 'Claude Sonnet 5', contextWindow: 1_000_000 }],
      defaultContextWindow: 1_000_000,
    }),
    resolveAccessToken: async () => ({ access: 't' }),
    reasoning: {
      efforts: [
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
        { id: 'xhigh', name: 'Extra High' },
        { id: 'max', name: 'Max' },
      ],
      defaultEffort: 'high',
    },
    wireEffort: 'output_config',
  })
  const cap = captureStream()
  await drain(adapter.stream({
    provider: 'claude',
    model: 'claude-sonnet-5',
    messages: [],
    reasoningEffort: 'max',
  }))
  assert.deepEqual(cap.body().output_config, { effort: 'max' }, 'Claude 发 output_config.effort')
  assert.equal(cap.body().thinking, undefined, '不再发 thinking.budget_tokens')
  console.log('✓ 3a. Claude effort=max → output_config.effort=max')
}

// ---------- 3b. Kimi：effort → reasoning_effort；未选择 → 不发送 ----------
{
  const adapter = new AnthropicMessagesAdapter({
    options: () => ({
      apiBaseURL: 'https://example.com/v1/messages',
      maxTokens: 32768,
      models: [{ id: 'k3', name: 'Kimi K3', contextWindow: 1_048_576 }],
      defaultContextWindow: 262_144,
    }),
    resolveAccessToken: async () => ({ access: 't' }),
    reasoning: {
      efforts: [
        { id: 'low', name: 'Low' },
        { id: 'high', name: 'High' },
        { id: 'max', name: 'Max' },
      ],
      defaultEffort: 'max',
    },
    wireEffort: 'reasoning_effort',
  })
  const cap = captureStream()
  await drain(adapter.stream({ provider: 'kimi', model: 'k3', messages: [], reasoningEffort: 'max' }))
  assert.equal(cap.body().reasoning_effort, 'max', 'Kimi 发顶层 reasoning_effort')
  assert.equal(cap.body().thinking, undefined, 'K3 不发 thinking')
  const cap2 = captureStream()
  await drain(adapter.stream({ provider: 'kimi', model: 'k3', messages: [] }))
  assert.equal(cap2.body().reasoning_effort, undefined, '未选择 effort 时不发送 reasoning_effort')
  console.log('✓ 3b. Kimi effort=max → reasoning_effort=max；未选择不发送')
}

console.log('✓ 思考强度（reasoning effort）测试全部通过')
