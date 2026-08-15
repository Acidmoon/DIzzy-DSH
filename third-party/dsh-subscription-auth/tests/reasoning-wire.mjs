/**
 * 思考强度（reasoning effort）测试（node 直接跑）：
 * 1. resolveModel 返回 reasoning 元数据（efforts + defaultEffort）→ 模型选择器
 *    显示「推理等级」菜单；
 * 2. ChatGptAdapter（ChatGPT/Grok）：显式 effort 序列化为 responses 请求的
 *    reasoning.effort；未选择/未声明渠道不发送该字段；
 * 3. AnthropicMessagesAdapter（Claude/Kimi）：effort 序列化为 thinking
 *    { type: 'enabled', budget_tokens }，档位预算来自渠道声明。
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
      ],
      defaultEffort: 'medium',
    },
  })
  const info = await adapter.resolveModel('chatgpt', 'gpt-5.5')
  assert.deepEqual(info.reasoning?.efforts.map((e) => e.id), ['minimal', 'low', 'medium', 'high'])
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
  await drain(adapter.stream({ ...callOptions, reasoningEffort: 'high' }))
  assert.deepEqual(cap.body().reasoning, { effort: 'high' }, 'Responses 请求体携带 reasoning.effort')
  console.log('✓ 2a. ChatGptAdapter 显式 effort=high → body.reasoning.effort=high')
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

// ---------- 3a. AnthropicMessagesAdapter：effort → thinking.budget_tokens ----------
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
        { id: 'low', name: 'Low', budgetTokens: 8_192 },
        { id: 'medium', name: 'Medium', budgetTokens: 16_384 },
        { id: 'high', name: 'High', budgetTokens: 32_000 },
      ],
      defaultEffort: 'medium',
    },
  })
  const cap = captureStream()
  await drain(adapter.stream({
    provider: 'claude',
    model: 'claude-sonnet-5',
    messages: [],
    reasoningEffort: 'high',
  }))
  assert.deepEqual(cap.body().thinking, { type: 'enabled', budget_tokens: 32_000 }, 'thinking 携带档位预算')
  console.log('✓ 3a. AnthropicMessagesAdapter effort=high → thinking.budget_tokens=32000')
}

// ---------- 3b. 档位未声明 budget → 兜底 16384；未选择 → 不发送 ----------
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
      efforts: [{ id: 'high', name: 'High' }], // 无 budgetTokens → 兜底
    },
  })
  const cap = captureStream()
  await drain(adapter.stream({ provider: 'kimi', model: 'k3', messages: [], reasoningEffort: 'high' }))
  assert.deepEqual(cap.body().thinking, { type: 'enabled', budget_tokens: 16_384 }, 'budget 兜底 16384')
  const cap2 = captureStream()
  await drain(adapter.stream({ provider: 'kimi', model: 'k3', messages: [] }))
  assert.equal(cap2.body().thinking, undefined, '未选择 effort 时不发送 thinking')
  console.log('✓ 3b. budget 兜底 16384；未选择 effort 不发送 thinking')
}

console.log('✓ 思考强度（reasoning effort）测试全部通过')
