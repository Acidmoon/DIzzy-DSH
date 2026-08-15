/**
 * Dizzy-DSH 自有插件冒烟测试(mock ctx,不起 DSH 进程)
 *
 * 验证 0.2.0 改造点:
 *   - Config(schemastery)校验与默认值
 *   - settings 命名空间注册(ns 正确,watch 返回 disposer)
 *   - webServer 路由同源校验(跨站 403,同源/无 Origin 200)
 *   - 工具注册与 agent 作用域披露(kimi-webbridge)
 *   - apply 返回的 disposer 完整清理
 *
 * 被测模块从 profile 安装副本导入(那里能解析 schemastery);
 * 改仓库代码后需先在 profile 里 pnpm install 同步,再跑本测试:
 *
 *   node scripts/smoke-plugins.mjs
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PROFILE = process.env.DSH_PROFILE_DIR ?? join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'web')

let failures = 0
function check(label, condition) {
  if (condition) {
    console.log(`  ok  ${label}`)
  } else {
    failures += 1
    console.log(`FAIL  ${label}`)
  }
}

// ── mock 设施 ──────────────────────────────────────────────────────────

function mockSettings() {
  const registrations = []
  return {
    registrations,
    register(ns, schema, options) {
      const resolved = schema(options?.base ?? undefined)
      const watchers = new Set()
      const scope = {
        get: () => resolved,
        watch: (cb) => { watchers.add(cb); return () => watchers.delete(cb) },
        update: async () => {},
        replace: async () => {},
      }
      registrations.push({ ns, scope })
      return scope
    },
  }
}

function mockWebServer() {
  const routes = new Map()
  return {
    routes,
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }
}

function mockRes() {
  return {
    status: 0,
    body: '',
    writeHead(status) { this.status = status },
    end(body) { this.body = body ?? '' },
  }
}

function mockTools() {
  const registered = new Map()
  return {
    registered,
    restricted: undefined,
    register(tool) {
      registered.set(tool.name, tool)
      return () => registered.delete(tool.name)
    },
    restrict(rule) {
      this.restricted = rule
      return () => {}
    },
  }
}

function mockCtx({ settings, credentials, tools, webServer } = {}) {
  const listeners = new Map()
  return {
    listeners,
    get: (name) => (name === 'settings' ? settings : undefined),
    credentials: credentials ?? { resolve: async () => undefined },
    interval: () => () => {},
    timeout: () => () => {},
    tools: tools ?? mockTools(),
    webServer: webServer ?? mockWebServer(),
    on(event, fn) {
      listeners.set(event, fn)
      return () => listeners.delete(event)
    },
    effect(fn) { return fn() },
  }
}

async function importPlugin(pkgName) {
  const mod = await import(pathToFileURL(join(PROFILE, 'node_modules', pkgName, 'index.js')).href)
  return mod.default
}

// ── balance ────────────────────────────────────────────────────────────

async function testBalance() {
  console.log('balance')
  const plugin = await importPlugin('dizzy-dsh-balance')
  check('Config 挂在默认导出对象上', typeof plugin.Config === 'function' || typeof plugin.Config?.['~standard']?.validate === 'function')
  const defaults = plugin.Config(undefined)
  check('Config(undefined) 填默认值', defaults.credentialName === 'DEEPSEEK_API_KEY' && defaults.refreshIntervalMs === 60000)
  let threw = false
  try { plugin.Config({ refreshIntervalMs: 100 }) } catch { threw = true }
  check('越界 refreshIntervalMs 加载期报错', threw)

  const settings = mockSettings()
  const tools = mockTools()
  const webServer = mockWebServer()
  const ctx = mockCtx({ settings, tools, webServer })
  const dispose = plugin.apply(ctx, defaults)

  check('注册 settings 命名空间 dizzy-balance', settings.registrations[0]?.ns === 'dizzy-balance')
  check('注册 balance_check 工具', tools.registered.has('balance_check'))
  const route = webServer.routes.get('/dizzy/balance')
  check('注册 /dizzy/balance 路由', route !== undefined)

  await new Promise((resolve) => setTimeout(resolve, 20)) // 等首次 refresh(无凭据路径)落定

  let res = mockRes()
  await route.handler({ url: '/dizzy/balance', headers: {} }, res)
  check('无 Origin 请求 200', res.status === 200)
  check('响应是余额 JSON', JSON.parse(res.body).balanceCny === null)

  res = mockRes()
  await route.handler({ url: '/dizzy/balance', headers: { 'sec-fetch-site': 'cross-site' } }, res)
  check('cross-site 请求 403', res.status === 403)

  res = mockRes()
  await route.handler({ url: '/dizzy/balance', headers: { origin: 'http://evil.example', host: '127.0.0.1:3080' } }, res)
  check('Origin 与 Host 不符 403', res.status === 403)

  res = mockRes()
  await route.handler({ url: '/dizzy/balance', headers: { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080' } }, res)
  check('同源请求 200', res.status === 200)

  const reply = await tools.registered.get('balance_check').execute()
  check('无凭据时工具返回可读错误', typeof reply === 'string' && reply.includes('未配置 DEEPSEEK_API_KEY'))

  dispose()
  check('dispose 后工具注销', !tools.registered.has('balance_check'))
  check('dispose 后路由摘除', !webServer.routes.has('/dizzy/balance'))
}

// ── usage-card ─────────────────────────────────────────────────────────

async function testUsageCard() {
  console.log('usage-card')
  const plugin = await importPlugin('dizzy-dsh-usage-card')
  check('Config 挂在默认导出对象上', typeof plugin.Config === 'function' || typeof plugin.Config?.['~standard']?.validate === 'function')

  // 造一份迷你会话日志夹具
  const root = await mkdtemp(join(tmpdir(), 'dizzy-usage-'))
  try {
    const eventTime = new Date('2026-08-20T10:00:00.000Z')
    const line = JSON.stringify({
      type: 'assistant/message',
      time: eventTime.toISOString(),
      data: {
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2 },
        message: { source: { provider: 'p', model: 'm' } },
      },
    })
    const dir = join(root, 'area-a', 'session-x')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'session.jsonl'), line + '\n', 'utf8')

    const config = plugin.Config({ sessionRoot: root })
    check('Config 接受 sessionRoot 覆盖', config.sessionRoot === root)

    const settings = mockSettings()
    const webServer = mockWebServer()
    const ctx = mockCtx({ settings, webServer })
    const dispose = plugin.apply(ctx, config)
    check('注册 settings 命名空间 dizzy-usage-card', settings.registrations[0]?.ns === 'dizzy-usage-card')

    const route = webServer.routes.get('/dizzy/usage')
    check('注册 /dizzy/usage 路由', route !== undefined)

    const month = `${eventTime.getFullYear()}-${String(eventTime.getMonth() + 1).padStart(2, '0')}`
    const dayKey = `${month}-${String(eventTime.getDate()).padStart(2, '0')}`

    let res = mockRes()
    await route.handler({ url: `/dizzy/usage?month=${month}`, headers: {} }, res)
    check('夹具月份 200', res.status === 200)
    const body = JSON.parse(res.body)
    check('聚合出夹具日用量(17 tokens)', body.days?.[dayKey] === 17)
    check('detail 分项正确', body.detail?.days?.[dayKey]?.input === 10 && body.detail?.days?.[dayKey]?.cacheRead === 2)

    res = mockRes()
    await route.handler({ url: '/dizzy/usage?month=20-08', headers: {} }, res)
    check('非法 month 400', res.status === 400)

    res = mockRes()
    await route.handler({ url: `/dizzy/usage?month=${month}`, headers: { 'sec-fetch-site': 'cross-site' } }, res)
    check('cross-site 请求 403', res.status === 403)

    dispose()
    check('dispose 后路由摘除', !webServer.routes.has('/dizzy/usage'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

// ── kimi-webbridge ─────────────────────────────────────────────────────

async function testKimiWebbridge() {
  console.log('kimi-webbridge')
  const plugin = await importPlugin('dizzy-dsh-kimi-webbridge')
  check('Config 挂在默认导出对象上', typeof plugin.Config === 'function' || typeof plugin.Config?.['~standard']?.validate === 'function')
  const defaults = plugin.Config(undefined)
  check('Config(undefined) 填默认值', defaults.daemonUrl === 'http://127.0.0.1:10086' && defaults.daemonTimeoutMs === 30000)

  const settings = mockSettings()
  const tools = mockTools()
  const ctx = mockCtx({ settings, tools })
  const dispose = plugin.apply(ctx, defaults)

  check('注册 settings 命名空间 dizzy-kimi-webbridge', settings.registrations[0]?.ns === 'dizzy-kimi-webbridge')
  check('全局仅注册引导工具', tools.registered.size === 1 && tools.registered.has('kimi_browser_activate'))

  const activation = tools.registered.get('kimi_browser_activate')
  const noAgent = await activation.execute({}, {})
  check('无 agent 上下文返回错误', typeof noAgent === 'string' && noAgent.includes('Agent'))

  const agentTools = mockTools()
  const agent = { ctx: { tools: agentTools }, session: { header: { id: 'sess-abc' } } }
  const first = JSON.parse(await activation.execute({}, { agent }))
  check('首次激活注入 9 个业务工具', first.activated === true && first.tools.length === 9)
  check('业务工具注册进 agent 作用域', agentTools.registered.has('kimi_browser_navigate') && agentTools.registered.has('kimi_browser_command'))
  check('引导工具被 restrict 隐藏', agentTools.restricted?.deny?.includes('kimi_browser_activate'))

  const again = JSON.parse(await activation.execute({}, { agent }))
  check('重复激活幂等', again.activated === false)

  ctx.listeners.get('agent/disposed')?.({ agent })
  check('agent/disposed 后业务工具释放', agentTools.registered.size === 0)

  dispose()
  check('dispose 后引导工具注销', !tools.registered.has('kimi_browser_activate'))
}

// ── 入口 ───────────────────────────────────────────────────────────────

console.log(`profile: ${PROFILE}`)
await testBalance()
await testUsageCard()
await testKimiWebbridge()
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
