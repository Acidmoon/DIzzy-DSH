/**
 * 验证 bun 转译产物 lib/*.js 与 src/*.ts 等价（加载 + 关键行为）。
 * 运行：bun tests/lib-check.mjs
 */
import assert from 'node:assert'

// ---------- 入口 + 渠道注册表 ----------
const plugin = await import('../lib/index.js')
assert.equal(plugin.name, 'dsh-subscription-auth')
assert.deepEqual(plugin.inject, ['llm'])
assert.equal(typeof plugin.apply, 'function')
assert.ok(Array.isArray(plugin.CHANNELS) && plugin.CHANNELS.length === 4, 'lib 里 CHANNELS 有 4 个渠道')
assert.deepEqual(plugin.CHANNELS.map((c) => c.id).sort(), ['chatgpt', 'claude', 'grok', 'kimi'])

// ---------- oauth 行为 ----------
const oauth = await import('../lib/oauth.js')
const { verifier, challenge } = oauth.generatePkce()
const url = oauth.buildAuthorizeUrl(1455, challenge, 'st')
assert.ok(url.startsWith('https://auth.openai.com/oauth/authorize?'))
assert.ok(url.includes('client_id=app_EMoamEEZ73f0CkXaXp7hrann'))

// ---------- Responses 适配器行为（mock fetch 一次流式调用） ----------
const adapterMod = await import('../lib/adapter.js')
const llm = await import('@deepseek-ai/dsh-llm')
globalThis.fetch = async () => {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(
        'event: response.output_text.delta\ndata: {"delta":"ok","output_index":0}\n\n' +
        'event: response.completed\ndata: {"response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
      ))
      c.close()
    },
  })
  return new Response(stream, { status: 200 })
}
const adapter = new adapterMod.ChatGptAdapter({
  options: () => ({ apiBaseURL: 'https://chatgpt.com/backend-api/codex/responses', maxTokens: 8192, models: [], defaultContextWindow: 400000 }),
  resolveAccessToken: async () => ({ access: 't' }),
})
const chunks = []
for await (const c of adapter.stream({ provider: 'chatgpt', model: 'gpt-5.5', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })) {
  chunks.push(c)
}
assert.equal(chunks[0].type, 'block-start')
assert.equal(chunks.find((c) => c.type === 'text-delta').text, 'ok')
assert.equal(chunks.at(-1).type, 'finish')
assert.equal(chunks.at(-1).reason.kind, 'stop')

// ---------- Anthropic Messages 适配器行为 ----------
const anthropicMod = await import('../lib/adapters/anthropic.js')
globalThis.fetch = async () => {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n' +
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n' +
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n' +
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n' +
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n' +
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ))
      c.close()
    },
  })
  return new Response(stream, { status: 200 })
}
const anth = new anthropicMod.AnthropicMessagesAdapter({
  options: () => ({ apiBaseURL: 'https://api.anthropic.com/v1/messages', maxTokens: 64000, models: [], defaultContextWindow: 1000000 }),
  resolveAccessToken: async () => ({ access: 't' }),
})
const anthChunks = []
for await (const c of anth.stream({ provider: 'claude', model: 'claude-sonnet-5', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })) {
  anthChunks.push(c)
}
assert.equal(anthChunks.find((c) => c.type === 'text-delta').text, 'hi')
assert.equal(anthChunks.at(-1).type, 'finish')
assert.equal(anthChunks.at(-1).reason.kind, 'stop')

// ---------- 渠道模块 + 设备流辅助 ----------
const claude = await import('../lib/channels/claude.js')
const grok = await import('../lib/channels/grok.js')
const kimi = await import('../lib/channels/kimi.js')
const deviceFlow = await import('../lib/device-flow.js')
assert.equal(claude.claudeChannel.id, 'claude')
assert.equal(grok.grokChannel.id, 'grok')
assert.equal(kimi.kimiChannel.id, 'kimi')
assert.equal(typeof deviceFlow.pollDeviceFlow, 'function')
assert.equal(typeof deviceFlow.sleep, 'function')

console.log('✓ lib/*.js 加载与行为正确（4 渠道 + Responses/Anthropic 适配器）')
