/**
 * dsh-subscription-auth 冒烟测试（bun 运行，直接 import src/*.ts）。
 *
 * 覆盖：
 *  1. 所有运行时依赖的命名导出可解析（load 期风险的最大来源）
 *  2. oauth.ts：PKCE 生成、授权 URL 构造、code 交换、refresh
 *  3. adapter.ts：Responses API 请求体序列化、SSE 翻译为 StreamChunk、
 *     HTTP 错误映射（用 mock fetch）
 *  4. waitForCallback：真实 localhost 回调服务器、state 校验、超时
 *  5. 插件入口模块加载 + CHANNELS 渠道注册表
 *  6. apply() 接线（provider/adapter 注册、配置中心路由）
 */
import assert from 'node:assert'

// ---------- 1. 依赖解析 ----------
const llm = await import('@deepseek-ai/dsh-llm')
assert.equal(typeof llm.LlmAdapter, 'function', 'dsh-llm.LlmAdapter')
assert.equal(typeof llm.LlmError, 'function', 'dsh-llm.LlmError')
assert.equal(typeof llm.CallId, 'function', 'dsh-llm.CallId')
assert.equal(typeof llm.attributionHeaders, 'function', 'dsh-llm.attributionHeaders')
assert.equal(typeof llm.LlmRuntime, 'function', 'dsh-llm.LlmRuntime')
const cred = await import('@deepseek-ai/dsh-credentials')
assert.equal(typeof cred.credentialRef, 'function', 'dsh-credentials.credentialRef')
const settings = await import('@deepseek-ai/dsh-settings')
assert.equal(typeof settings.settingsNamespace, 'function', 'dsh-settings.settingsNamespace')
const schemastery = await import('@deepseek-ai/schemastery')
assert.equal(typeof schemastery.default, 'function', '@deepseek-ai/schemastery default')
assert.equal(typeof schemastery.default.object, 'function', 'z.object')
console.log('✓ 1. 依赖导出全部可解析')

// ---------- 2. oauth.ts ----------
const oauth = await import('../src/oauth.ts')
assert.equal(oauth.CLIENT_ID, 'app_EMoamEEZ73f0CkXaXp7hrann')
assert.equal(oauth.REDIRECT_PORT, 1455)

const { verifier, challenge } = oauth.generatePkce()
assert.ok(typeof verifier === 'string' && verifier.length >= 40, 'verifier 长度')
assert.ok(typeof challenge === 'string' && challenge.length >= 40, 'challenge 长度')
assert.ok(/^[A-Za-z0-9\-_]+$/.test(verifier), 'verifier 为 base64url 字符集')

const authUrl = oauth.buildAuthorizeUrl(1455, challenge, 'state-abc')
const u = new URL(authUrl)
assert.equal(u.origin + u.pathname, 'https://auth.openai.com/oauth/authorize')
assert.equal(u.searchParams.get('client_id'), 'app_EMoamEEZ73f0CkXaXp7hrann')
assert.equal(u.searchParams.get('response_type'), 'code')
assert.equal(u.searchParams.get('redirect_uri'), 'http://localhost:1455/auth/callback')
assert.equal(u.searchParams.get('scope'), 'openid profile email offline_access api.connectors.read api.connectors.invoke')
assert.equal(u.searchParams.get('code_challenge'), challenge)
assert.equal(u.searchParams.get('code_challenge_method'), 'S256')
assert.equal(u.searchParams.get('codex_cli_simplified_flow'), 'true')
assert.equal(u.searchParams.get('state'), 'state-abc')
assert.equal(u.searchParams.get('originator'), 'pi')
console.log('✓ 2a. PKCE + 授权 URL 构造正确（scope 含 api.connectors.*，originator=pi）')

// code 交换（mock fetch）
const originalFetch = globalThis.fetch
globalThis.fetch = async (_url, init) => {
  assert.equal(init.method, 'POST')
  const body = init.body
  assert.ok(body.includes('grant_type=authorization_code'), 'grant_type')
  assert.ok(body.includes('client_id=app_EMoamEEZ73f0CkXaXp7hrann'), 'client_id')
  assert.ok(body.includes('code_verifier='), 'code_verifier')
  return new Response(JSON.stringify({
    access_token: 'access-123',
    refresh_token: 'refresh-456',
    expires_in: 600,
    id_token: 'header.' + Buffer.from(JSON.stringify({ chatgpt_account_id: 'acct-9' })).toString('base64url') + '.sig',
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}
const token = await oauth.exchangeCode('the-code', 1455, verifier)
assert.equal(token.access, 'access-123')
assert.equal(token.refresh, 'refresh-456')
assert.equal(token.accountId, 'acct-9')
assert.ok(token.expires > Date.now())
globalThis.fetch = originalFetch
console.log('✓ 2b. code 交换 + accountId 提取正确')

// refresh（mock fetch）
globalThis.fetch = async (_url, init) => {
  assert.ok(init.body.includes('grant_type=refresh_token'), 'refresh grant_type')
  assert.ok(init.body.includes('refresh_token=refresh-456'), 'refresh_token 传递')
  return new Response(JSON.stringify({ access_token: 'access-new', expires_in: 600 }), { status: 200 })
}
const refreshed = await oauth.refreshAccessToken('refresh-456')
assert.equal(refreshed.access, 'access-new')
assert.equal(refreshed.refresh, 'refresh-456') // 未返回新 refresh 时保留旧的
globalThis.fetch = originalFetch
console.log('✓ 2c. refresh 流程正确')

// ---------- 3. adapter.ts（mock fetch 全链路） ----------
const adapterMod = await import('../src/adapter.ts')

// 构造一段真实的 Responses API SSE 流
function sseResponse(events) {
  const text = events.join('\n\n') + '\n\n'
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

let captured = null
globalThis.fetch = async (url, init) => {
  captured = { url, init }
  return sseResponse([
    'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","id":"fc_1","call_id":"call_123","name":"get_weather","arguments":""}}',
    'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hello","output_index":0,"content_index":0,"sequence_number":1}',
    'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":" world","output_index":0,"content_index":0,"sequence_number":2}',
    'event: response.reasoning_summary_text.delta\ndata: {"type":"response.reasoning_summary_text.delta","delta":"thinking...","sequence_number":3}',
    'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","output_index":1,"delta":"{\\"city\\":\\"Beijing\\"}","sequence_number":4}',
    'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":100,"output_tokens":42,"input_tokens_details":{"cached_tokens":30},"output_tokens_details":{"reasoning_tokens":5}}}}',
  ])
}

const adapter = new adapterMod.ChatGptAdapter({
  options: () => ({
    apiBaseURL: 'https://chatgpt.com/backend-api/codex/responses',
    maxTokens: 8192,
    models: [{ id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 400000 }],
    defaultContextWindow: 400000,
  }),
  resolveAccessToken: async () => ({ access: 'oauth-access-token' }),
})

const messages = [
  { role: 'system', content: [{ type: 'text', text: 'Be terse.' }] },
  { role: 'user', content: [{ type: 'text', text: 'What is the weather in Beijing?' }] },
  { role: 'assistant', content: [
    { type: 'text', text: 'Let me check.' },
    { type: 'tool-call', id: 'call_prev', name: 'get_weather', arguments: '{"city":"Beijing"}' },
  ] },
  { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call_prev', content: [{ type: 'text', text: '20°C sunny' }] }] },
]

const chunks = []
for await (const chunk of adapter.stream({
  provider: 'chatgpt',
  model: 'gpt-5.5',
  system: 'System prompt here',
  messages,
  tools: [{ name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }],
  temperature: 0.7,
  maxTokens: 4096,
})) {
  chunks.push(chunk)
}

// 请求体序列化断言
assert.ok(captured, 'fetch 被调用')
assert.equal(captured.url, 'https://chatgpt.com/backend-api/codex/responses')
assert.equal(captured.init.method, 'POST')
assert.equal(captured.init.headers.authorization, 'Bearer oauth-access-token')
assert.equal(captured.init.headers.accept, 'text/event-stream')
assert.ok(captured.init.headers['user-agent'].startsWith('deepseek-harness/'), 'attribution user-agent')
const body = JSON.parse(captured.init.body)
assert.equal(body.model, 'gpt-5.5')
assert.equal(body.stream, true)
assert.equal(body.store, false)
// codex 端点不支持 temperature / stop / max_output_tokens（实测 400），不发送
assert.equal(body.max_output_tokens, undefined)
assert.equal(body.temperature, undefined)
assert.equal(body.stop, undefined)
assert.equal(body.instructions, 'System prompt here\n\nBe terse.')
assert.equal(body.tools[0].type, 'function')
assert.equal(body.tools[0].name, 'get_weather')
// input 序列化（顺序很重要：保持对话原序，assistant 文本消息先于 function_call）
assert.deepEqual(body.input, [
  { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'What is the weather in Beijing?' }] },
  { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Let me check.' }] },
  { type: 'function_call', call_id: 'call_prev', name: 'get_weather', arguments: '{"city":"Beijing"}' },
  { type: 'function_call_output', call_id: 'call_prev', output: '20°C sunny' },
])
console.log('✓ 3a. Responses API 请求序列化正确')

// StreamChunk 断言
const textDeltas = chunks.filter((c) => c.type === 'text-delta').map((c) => c.text)
assert.deepEqual(textDeltas, ['Hello', ' world'])
const reasoningDeltas = chunks.filter((c) => c.type === 'reasoning-delta').map((c) => c.text)
assert.deepEqual(reasoningDeltas, ['thinking...'])
const toolDeltas = chunks.filter((c) => c.type === 'tool-call-delta')
assert.equal(toolDeltas.length, 1)
assert.equal(toolDeltas[0].id, 'call_123')
assert.equal(toolDeltas[0].name, 'get_weather')
assert.equal(toolDeltas[0].argumentsDelta, '{"city":"Beijing"}')
const blockEnds = chunks.filter((c) => c.type === 'block-end')
assert.equal(blockEnds.length, 3) // text + reasoning + tool-call
const toolBlock = blockEnds.find((c) => c.block.type === 'tool-call').block
assert.equal(toolBlock.id, 'call_123')
assert.equal(toolBlock.name, 'get_weather')
assert.equal(toolBlock.arguments, '{"city":"Beijing"}')
const usage = chunks.find((c) => c.type === 'usage')
assert.deepEqual(usage.usage, { inputTokens: 70, outputTokens: 42, cacheReadTokens: 30, reasoningTokens: 5 })
const finish = chunks.find((c) => c.type === 'finish')
assert.equal(finish.reason.kind, 'stop')
assert.ok(chunks[chunks.length - 1].type === 'finish', 'finish 是最后一个 chunk')
console.log('✓ 3b. SSE 翻译为 StreamChunk 正确')

// HTTP 错误映射
globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Incorrect API key' } }), {
  status: 401,
  headers: { 'content-type': 'application/json' },
})
let authErr = null
try {
  for await (const _ of adapter.stream({ provider: 'chatgpt', model: 'gpt-5.5', messages: [] })) {}
} catch (e) {
  authErr = e
}
assert.ok(authErr instanceof llm.LlmError, '抛出 LlmError')
assert.equal(authErr.code, 'AUTH')
assert.equal(authErr.failure.status, 401)
globalThis.fetch = originalFetch
console.log('✓ 3c. HTTP 错误映射正确')

// ---------- 4. waitForCallback 真实 localhost 回调 ----------
// 用独立端口测试：1455 是 OpenAI 回调专用端口，且可能被运行中的 dsh 占用。
const callbackPromise = oauth.waitForCallback(18655, 'state-abc')
const cbRes = await fetch('http://127.0.0.1:18655/auth/callback?code=cb-code&state=state-abc')
assert.equal(cbRes.status, 200)
const cbCode = await callbackPromise
assert.equal(cbCode, 'cb-code')
console.log('✓ 4. localhost 回调服务器真实可用')

// state 不匹配应当 reject
const badPromise = oauth.waitForCallback(18656, 'expected-state')
badPromise.catch(() => {}) // 预先挂 noop，避免 bun 把稍后才 await 的 rejection 当 unhandled
const badRes = await fetch('http://127.0.0.1:18656/auth/callback?code=x&state=wrong')
assert.equal(badRes.status, 400)
let badErr = null
try { await badPromise } catch (e) { badErr = e }
assert.ok(badErr && /state/.test(badErr.message), 'state 不匹配 reject')
console.log('✓ 5. state 校验正确')

// 超时应当 reject 并释放端口
const timeoutPromise = oauth.waitForCallback(18657, 'timeout-state', undefined, 300)
timeoutPromise.catch(() => {})
let timeoutErr = null
try { await timeoutPromise } catch (e) { timeoutErr = e }
assert.ok(timeoutErr && /timed out|timeout/.test(timeoutErr.message), '等待回调超时 reject')
console.log('✓ 5b. 回调超时自动关闭服务器')

// ---------- 6. 插件入口模块 + 渠道注册表 ----------
const plugin = await import('../src/index.ts')
assert.equal(plugin.name, 'dsh-subscription-auth')
assert.deepEqual(plugin.inject, ['llm'])
assert.equal(typeof plugin.apply, 'function')
assert.ok(Array.isArray(plugin.CHANNELS) && plugin.CHANNELS.length === 4, 'CHANNELS 有 4 个渠道')
assert.deepEqual(plugin.CHANNELS.map((c) => c.id).sort(), ['chatgpt', 'claude', 'grok', 'kimi'])
for (const c of plugin.CHANNELS) {
  assert.ok(c.id && c.displayName && c.name && c.tokenRefName && c.defaultApiBaseURL, `渠道 ${c.id} 字段完整`)
  assert.ok(Array.isArray(c.defaultModels) && c.defaultModels.length > 0, `渠道 ${c.id} 有默认模型`)
  assert.equal(typeof c.create, 'function', `渠道 ${c.id} 有 create`)
}
assert.equal(plugin.CHANNELS.find((c) => c.id === 'chatgpt').displayName, 'ChatGPT (订阅)')
assert.equal(plugin.CHANNELS.find((c) => c.id === 'claude').displayName, 'Claude (订阅)')
assert.equal(plugin.CHANNELS.find((c) => c.id === 'grok').displayName, 'Grok (订阅)')
assert.equal(plugin.CHANNELS.find((c) => c.id === 'kimi').displayName, 'Kimi (订阅)')
console.log('✓ 6. 插件入口模块加载 + CHANNELS 注册表（4 渠道）正确')

// ---------- 7. apply() 接线（mock ctx，settings/webServer 服务未挂载） ----------
const registeredProviders = []
const registeredAdapters = []
const fakeLlm = {
  registerConfigurableProviders: (entries) => { registeredProviders.push(...entries); return () => {} },
  registerAdapter: (providers, adapter) => { registeredAdapters.push({ providers, adapter }); return { replace: () => {} } },
}
const fakeCtx = {
  llm: fakeLlm,
  get: () => undefined, // credentials / settings / webServer 未挂载
  inject: () => {}, // 服务未挂载 → 回调不执行
  effect: (fn) => fn() ?? (() => {}),
  logger: console,
}
plugin.apply(fakeCtx, {})
assert.equal(registeredProviders.length, 4, '注册 4 个 provider')
assert.deepEqual(registeredProviders.map((p) => p.provider).sort(), ['chatgpt', 'claude', 'grok', 'kimi'])
assert.equal(registeredProviders.find((p) => p.provider === 'chatgpt').displayName, 'ChatGPT (订阅)')
assert.equal(registeredProviders.find((p) => p.provider === 'claude').displayName, 'Claude (订阅)')
assert.equal(registeredAdapters.length, 4, '注册 4 个 adapter')
for (const a of registeredAdapters) {
  assert.equal(typeof a.adapter.stream, 'function')
  assert.equal(typeof a.adapter.listModels, 'function')
  assert.equal(typeof a.adapter.resolveModel, 'function')
  assert.equal(typeof a.adapter.providerInfo, 'function')
}
console.log('✓ 7a. apply() 接线正确（4 provider + 4 adapter，服务未挂载时不抛错）')

// ---------- 8. apply() 在 webServer 挂载时注册三个路由 ----------
const registeredRoutes = []
const webServerCtx = {
  llm: fakeLlm,
  get: () => undefined,
  inject: (names, cb) => {
    // settings 未挂载（第一个 inject 不执行），webServer 挂载（执行 cb）
    if (names.includes('webServer')) {
      const fakeWebCtx = {
        webServer: {
          register: (route) => {
            registeredRoutes.push(route.path)
            return () => {}
          },
        },
        effect: (fn) => fn() ?? (() => {}),
      }
      cb(fakeWebCtx)
    }
  },
  effect: (fn) => fn() ?? (() => {}),
  logger: console,
}
plugin.apply(webServerCtx, {})
assert.deepEqual([...registeredRoutes].sort(), [
  '/subscription-auth/auth/login',
  '/subscription-auth/auth/logout',
  '/subscription-auth/providers',
])
console.log('✓ 8. apply() 注册配置中心路由（providers / login / logout）')

// ---------- 9. Anthropic Messages API 适配器（Claude/Kimi 共用） ----------
const anthropicMod = await import('../src/adapters/anthropic.ts')
const anthAdapter = new anthropicMod.AnthropicMessagesAdapter({
  options: () => ({
    apiBaseURL: 'https://api.anthropic.com/v1/messages',
    maxTokens: 64000,
    models: [{ id: 'claude-sonnet-5', name: 'Claude Sonnet 5', contextWindow: 1000000 }],
    defaultContextWindow: 1000000,
    headers: () => ({ 'anthropic-version': '2023-06-01' }),
  }),
  resolveAccessToken: async () => ({ access: 'claude-token' }),
  label: 'claude',
  displayName: 'Claude (订阅)',
})

let anthCaptured = null
globalThis.fetch = async (url, init) => {
  anthCaptured = { url, init }
  return sseResponse([
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":100,"output_tokens":0,"cache_read_input_tokens":30}}}',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
    'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather"}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\\"city\\":\\\"Beijing\\\"}"}}',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}',
    'event: message_stop\ndata: {"type":"message_stop"}',
  ])
}

const anthChunks = []
for await (const c of anthAdapter.stream({
  provider: 'claude',
  model: 'claude-sonnet-5',
  system: 'Be terse.',
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'What is the weather?' }] },
    { role: 'assistant', content: [
      { type: 'text', text: 'Let me check.' },
      { type: 'tool-call', id: 'toolu_prev', name: 'get_weather', arguments: '{"city":"Beijing"}' },
    ] },
    { role: 'user', content: [{ type: 'tool-result', toolCallId: 'toolu_prev', content: [{ type: 'text', text: '20°C sunny' }] }] },
  ],
  tools: [{ name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }],
})) {
  anthChunks.push(c)
}

// 请求体序列化断言
assert.ok(anthCaptured, 'fetch 被调用')
assert.equal(anthCaptured.url, 'https://api.anthropic.com/v1/messages')
assert.equal(anthCaptured.init.headers.authorization, 'Bearer claude-token')
assert.equal(anthCaptured.init.headers['anthropic-version'], '2023-06-01')
const anthBody = JSON.parse(anthCaptured.init.body)
assert.equal(anthBody.model, 'claude-sonnet-5')
assert.equal(anthBody.system, 'Be terse.')
assert.equal(anthBody.max_tokens, 64000)
assert.equal(anthBody.stream, true)
assert.equal(anthBody.tools[0].name, 'get_weather')
assert.equal(anthBody.tools[0].input_schema.type, 'object')
// messages：user 文本 / assistant 文本+tool_use / user tool_result（同角色合并）
assert.deepEqual(anthBody.messages, [
  { role: 'user', content: [{ type: 'text', text: 'What is the weather?' }] },
  { role: 'assistant', content: [
    { type: 'text', text: 'Let me check.' },
    { type: 'tool_use', id: 'toolu_prev', name: 'get_weather', input: { city: 'Beijing' } },
  ] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_prev', content: '20°C sunny' }] },
])
// StreamChunk 断言
const anthTextDeltas = anthChunks.filter((c) => c.type === 'text-delta').map((c) => c.text)
assert.deepEqual(anthTextDeltas, ['Hello', ' world'])
const anthToolDeltas = anthChunks.filter((c) => c.type === 'tool-call-delta')
assert.equal(anthToolDeltas.length, 1)
assert.equal(anthToolDeltas[0].id, 'toolu_1')
assert.equal(anthToolDeltas[0].name, 'get_weather')
assert.equal(anthToolDeltas[0].argumentsDelta, '{"city":"Beijing"}')
const anthUsage = anthChunks.find((c) => c.type === 'usage')
assert.deepEqual(anthUsage.usage, { inputTokens: 70, outputTokens: 42, cacheReadTokens: 30 })
const anthFinish = anthChunks.find((c) => c.type === 'finish')
assert.equal(anthFinish.reason.kind, 'stop')
assert.ok(anthChunks[anthChunks.length - 1].type === 'finish', 'finish 是最后一个 chunk')
console.log('✓ 9. Anthropic Messages 适配器序列化 + SSE 翻译正确')

// Kimi 会把 input_tokens 报成已扣除 cache 的净增量；再减 cache_read 会变负。
// 写入侧必须钳零，否则 DSH tokenUsage schema 会把整段历史打成 unavailable。
globalThis.fetch = async () => sseResponse([
  'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":876,"output_tokens":0,"cache_read_input_tokens":127488}}}',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":8}}',
  'event: message_stop\ndata: {"type":"message_stop"}',
])
const kimiUsageChunks = []
for await (const c of anthAdapter.stream({
  provider: 'kimi',
  model: 'k3',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
})) {
  kimiUsageChunks.push(c)
}
const kimiUsage = kimiUsageChunks.find((c) => c.type === 'usage')
assert.deepEqual(kimiUsage.usage, { inputTokens: 0, outputTokens: 8, cacheReadTokens: 127488 })
assert.ok(kimiUsage.usage.inputTokens >= 0, '负 inputTokens 不得写入会话日志')
console.log('✓ 9b. Kimi 净增量 usage 钳零，不写负 inputTokens')
globalThis.fetch = originalFetch

// ---------- 10. 渠道模块：Claude OAuth URL / Grok·Kimi 设备流结构 ----------
const claudeMod = await import('../src/channels/claude.ts')
const grokMod = await import('../src/channels/grok.ts')
const kimiMod = await import('../src/channels/kimi.ts')
assert.equal(claudeMod.claudeChannel.id, 'claude')
assert.equal(grokMod.grokChannel.id, 'grok')
assert.equal(kimiMod.kimiChannel.id, 'kimi')
assert.equal(claudeMod.claudeChannel.tokenRefName, 'CLAUDE_SUBSCRIPTION_TOKEN')
assert.equal(grokMod.grokChannel.tokenRefName, 'GROK_SUBSCRIPTION_TOKEN')
assert.equal(kimiMod.kimiChannel.tokenRefName, 'KIMI_SUBSCRIPTION_TOKEN')
// Claude 用授权码+回调（redirectPort 54545），Grok/Kimi 用设备流（redirectPort 0）
assert.equal(claudeMod.claudeChannel.defaultRedirectPort, 54545)
assert.equal(grokMod.grokChannel.defaultRedirectPort, 0)
assert.equal(kimiMod.kimiChannel.defaultRedirectPort, 0)
// Grok 走 Responses API（复用 ChatGptAdapter），Kimi 走 Anthropic Messages API
const grokRuntime = grokMod.grokChannel.create({
  id: 'grok', tokenRefName: 'GROK_SUBSCRIPTION_TOKEN',
  options: () => ({ apiBaseURL: 'https://api.x.ai/v1/responses', redirectPort: 0, models: [], defaultContextWindow: 1000000, maxTokens: 8192 }),
  getConfig: () => ({}), updateConfig: async () => {}, credentials: () => undefined,
  log: () => {}, notifyModelsChanged: () => {}, readToken: async () => undefined,
  writeToken: async () => {}, clearToken: async () => {}, afterLogin: () => {},
})
assert.equal(typeof grokRuntime.adapter.stream, 'function')
assert.equal(typeof grokRuntime.discoverModels, 'function')
const kimiRuntime = kimiMod.kimiChannel.create({
  id: 'kimi', tokenRefName: 'KIMI_SUBSCRIPTION_TOKEN',
  options: () => ({ apiBaseURL: 'https://api.kimi.com/coding/v1/messages', redirectPort: 0, models: [], defaultContextWindow: 262144, maxTokens: 32768 }),
  getConfig: () => ({}), updateConfig: async () => {}, credentials: () => undefined,
  log: () => {}, notifyModelsChanged: () => {}, readToken: async () => undefined,
  writeToken: async () => {}, clearToken: async () => {}, afterLogin: () => {},
})
assert.equal(typeof kimiRuntime.adapter.stream, 'function')
assert.equal(typeof kimiRuntime.discoverModels, 'function')
console.log('✓ 10. 渠道模块结构正确（Claude 授权码 / Grok·Kimi 设备流）')

console.log('\n全部冒烟测试通过 ✔')
