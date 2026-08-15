/**
 * apply() 接线测试（node 直接跑，替代 bun smoke 的 section 6）：
 * 验证 provider/adapter 注册、按登录状态门控（未登录不注册）、settings
 * 命名空间注册、webServer 路由注册。
 * 运行：node tests/apply-wiring.mjs
 */
import assert from 'node:assert'

const plugin = await import('../lib/index.js')
assert.equal(plugin.name, 'dsh-subscription-auth')
assert.deepEqual(plugin.inject, ['llm'])

// 测试环境无网络：让模型发现立刻失败（discoverModels 内部会捕获并返回 []）。
globalThis.fetch = async () => {
  throw new Error('no network in wiring test')
}

/** 每次 apply 用全新的记录器 + mock。tokens：ref 名 → StoredToken JSON。
 *  credReadyAt：credentials 服务在 apply 后多少 ms 才可用（默认 0 = 立即）。 */
function freshHarness(tokens = {}, credReadyAt = 0) {
  const calls = {
    providers: [],
    adapters: [],
    providerReplaces: [],
    adapterReplaces: [],
    routes: [],
    routeHandlers: {},
    namespaces: [],
    effects: [],
    disposers: 0,
  }
  const disposers = []
  let credReady = credReadyAt <= 0
  if (credReadyAt > 0) setTimeout(() => { credReady = true }, credReadyAt)
  const mockCred = {
    resolve: async (ref) => {
      const raw = tokens[String(ref)]
      return raw === undefined ? undefined : { value: raw }
    },
    set: async () => {},
    unset: async () => {},
  }
  const mockCtx = {
    get: (name) => (name === 'credentials' && credReady ? mockCred : undefined),
    inject: (deps, fn) => {
      fn({
        effect: (cb, label) => {
          calls.effects.push(label)
          const d = cb()
          if (typeof d === 'function') {
            disposers.push(d)
            calls.disposers++
          }
        },
        settings: {
          register: (ns, schema, opts) => {
            calls.namespaces.push(ns)
            return { get: () => ({}), update: async () => {} }
          },
        },
        webServer: {
          register: (desc) => {
            calls.routes.push(desc.path)
            calls.routeHandlers[desc.path] = desc.handler
            return () => {}
          },
        },
      })
    },
    effect: (cb, label) => {
      calls.effects.push(label)
      const d = cb()
      if (typeof d === 'function') {
        disposers.push(d)
        calls.disposers++
      }
    },
    llm: {
      registerConfigurableProviders: (list) => {
        calls.providers.push(...list)
        return {
          replace: (next) => {
            calls.providerReplaces.push(next.map((e) => e.provider))
          },
        }
      },
      registerAdapter: (ids, adapter) => {
        calls.adapters.push({ ids, adapter })
        return {
          replace: (next) => {
            calls.adapterReplaces.push(next)
          },
        }
      },
    },
  }
  return { calls, mockCtx, disposers }
}

const waitSettle = () => new Promise((r) => setTimeout(r, 60))

// ============ 场景 A：完全没有令牌 → 4 个渠道全部不注册 ============
{
  const { calls, mockCtx } = freshHarness()
  plugin.apply(mockCtx)

  // 初始同步注册（API 要求至少一个条目）后，异步门控应全部撤销
  assert.deepEqual(
    calls.providers.map((p) => p.provider).sort(),
    ['chatgpt', 'claude', 'grok', 'kimi'],
    '4 个可配置 provider 初始注册',
  )
  assert.deepEqual(
    calls.adapters.map((a) => a.ids[0]).sort(),
    ['chatgpt', 'claude', 'grok', 'kimi'],
    '4 个 adapter 初始注册',
  )

  await waitSettle()

  assert.equal(calls.providerReplaces.length, 4, `未登录：4 个渠道都调用了 provider 撤销 (${calls.providerReplaces.length})`)
  assert.ok(
    calls.providerReplaces.every((list) => Array.isArray(list) && list.length === 0),
    `未登录：configurable provider 全部撤销 (${JSON.stringify(calls.providerReplaces)})`,
  )
  assert.equal(calls.adapterReplaces.length, 4, '未登录：4 个渠道都调用了 adapter 撤销')
  assert.ok(
    calls.adapterReplaces.every((list) => Array.isArray(list) && list.length === 0),
    '未登录：adapter 全部撤销',
  )
  console.log('✓ A. 未登录：4 个渠道的 provider + adapter 全部从模型列表撤销')
}

// ============ 场景 B：只有 chatgpt 有令牌 → 仅 chatgpt 保持注册 ============
{
  const token = JSON.stringify({ refresh: 'r', access: 'a', expires: Date.now() + 3600_000 })
  const { calls, mockCtx } = freshHarness({ CHATGPT_SUBSCRIPTION_TOKEN: token })
  plugin.apply(mockCtx)
  await waitSettle()

  // chatgpt：registered 状态未变（true），门控直接跳过 → 无 replace 调用
  assert.equal(
    calls.providerReplaces.filter((l) => l.length > 0).length,
    0,
    'chatgpt 保持注册（无需 replace）',
  )
  // 其余三个渠道撤销
  const withdrawn = calls.providerReplaces.filter((l) => l.length === 0).length
  assert.equal(withdrawn, 3, `其余 3 个渠道的 provider 撤销 (${withdrawn})`)
  const withdrawnAdapters = calls.adapterReplaces.filter((l) => l.length === 0).length
  assert.equal(withdrawnAdapters, 3, `其余 3 个渠道的 adapter 撤销 (${withdrawnAdapters})`)
  console.log('✓ B. 仅 chatgpt 已登录：chatgpt 保持注册，其余 3 个渠道撤销')
}

// ============ 场景 D：credentials 服务晚于插件激活（启动竞态） ============
// chatgpt 有令牌，但 credentials 在 apply 后 500ms 才可用。修复前门控一次性
// 执行会误判「未登录」而撤销 chatgpt；修复后门控轮询等待服务就绪，chatgpt
// 绝不撤销（只有无令牌的 3 个渠道被撤销）。
{
  const token = JSON.stringify({ refresh: 'r', access: 'a', expires: Date.now() + 3600_000 })
  const { calls, mockCtx } = freshHarness({ CHATGPT_SUBSCRIPTION_TOKEN: token }, 500)
  plugin.apply(mockCtx)
  await new Promise((r) => setTimeout(r, 1400)) // 等待 credentials 就绪 + 门控轮询收敛

  assert.equal(
    calls.providerReplaces.filter((l) => l.length === 0).length,
    3,
    `竞态下 chatgpt 不应被撤销（实际撤销 ${calls.providerReplaces.filter((l) => l.length === 0).length} 个）`,
  )
  assert.equal(
    calls.adapterReplaces.filter((l) => l.length === 0).length,
    3,
    '竞态下 chatgpt 的 adapter 不应被撤销',
  )
  assert.equal(
    calls.providerReplaces.filter((l) => l.length > 0).length,
    0,
    'chatgpt 保持注册（无重注册调用）',
  )
  console.log('✓ D. credentials 晚就绪（启动竞态）：门控轮询等待，chatgpt 不被误撤销')
}

// ============ 接线基础断言（路由 / settings / effect） ============
{
  const { calls, mockCtx } = freshHarness()
  plugin.apply(mockCtx)

  assert.deepEqual(
    calls.routes.sort(),
    ['/subscription-auth/auth/login', '/subscription-auth/auth/logout', '/subscription-auth/providers'],
    '3 条路由已注册',
  )
  assert.deepEqual(
    calls.namespaces.sort(),
    ['subscription-auth-chatgpt', 'subscription-auth-claude', 'subscription-auth-grok', 'subscription-auth-kimi'],
    '4 个 settings 命名空间已注册',
  )
  assert.ok(calls.effects.length >= 2, `effect 已注册 (${calls.effects.join(', ')})`)

  // 路由 handler 冒烟：providers GET 应返回 4 个渠道卡片（未登录状态）
  const providerHandler = calls.routeHandlers['/subscription-auth/providers']
  assert.ok(typeof providerHandler === 'function', 'providers 路由 handler 存在')
  const req = { method: 'GET' }
  let resBody = ''
  const res = {
    writeHead: (code, headers) => {
      res.status = code
      res.headers = headers
    },
    end: (body) => {
      resBody = body
    },
  }
  await providerHandler(req, res)
  assert.equal(res.status, 200, 'providers 返回 200')
  const payload = JSON.parse(resBody)
  assert.equal(payload.providers.length, 4, 'providers 返回 4 个渠道')
  assert.deepEqual(payload.providers.map((p) => p.id).sort(), ['chatgpt', 'claude', 'grok', 'kimi'])
  assert.ok(payload.providers.every((p) => p.status === 'not-logged-in'), '未登录状态')

  // 未知 provider 应 404
  const loginHandler = calls.routeHandlers['/subscription-auth/auth/login']
  let badStatus = 0
  await loginHandler(
    { method: 'POST', [Symbol.asyncIterator]: (async function* () { yield '{"provider":"nope"}' })() },
    { writeHead: (code) => { badStatus = code }, end: () => {} },
  )
  assert.equal(badStatus, 404, '未知 provider 返回 404')

  console.log('✓ C. 接线基础：3 路由 + 4 settings 命名空间；providers 返回 4 卡片（含未登录态），未知 provider 404')
}

console.log('✓ apply() 接线测试全部通过')
