/**
 * dizzy-dsh-usage-card 汇总标记与增量:直接 apply 真实插件跑路由。
 *
 * 这个测试不 mock 聚合逻辑 —— 它 import 已安装的插件副本,用真的
 * webServer 路由契约调用 /dizzy/usage,所以能抓住只有运行时才暴露的问题
 * (缓存路径、变量遮蔽、节流窗口等)。
 *
 * 之所以 import 安装副本而不是仓库源码:插件 `import Schema from 'schemastery'`,
 * 仓库根没有 node_modules,只有 profile 里能解析到它。改了插件代码后先走
 * 「更新」仪式(删副本 → dsh plugin add)再跑本测试。
 *
 * 用法: node scripts/test-usage-scan.mjs
 * 退出码:全部断言通过 → 0。
 */
import { mkdtemp, mkdir, rm, appendFile, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { zstdCompressSync } from 'node:zlib'

const PROFILE = process.env.DSH_PROFILE_DIR ?? join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'web')
const installed = join(PROFILE, 'node_modules', 'dizzy-dsh-usage-card', 'index.js')
if (!existsSync(installed)) {
  console.error(`找不到已安装副本:${installed}\n先装合集或删副本重装:dsh plugin --profile web add file:<仓库>`)
  process.exit(2)
}

let failures = 0
function check(label, condition, extra) {
  if (condition) {
    console.log(`  ok  ${label}`)
  } else {
    failures += 1
    console.log(`FAIL  ${label}${extra === undefined ? '' : '  → ' + JSON.stringify(extra)}`)
  }
}

/** 一帧 = 一个 turn/step 的 message usage;与真实日志同形。 */
function frame(step, input, output, time, model = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, cacheRead = 0) {
  const line = JSON.stringify({
    type: 'assistant/message',
    seq: 100 + step,
    time,
    data: {
      turn: 1,
      step,
      usage: { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead },
      message: { source: model },
    },
  })
  return zstdCompressSync(Buffer.from(line + '\n', 'utf8'))
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

function mockCtx(webServer, base) {
  return {
    get: (name) => (name === 'settings'
      ? {
          register: (_ns, schema) => ({
            get: () => schema(base),
            watch: () => () => {},
            update: async () => {},
            replace: async () => {},
          }),
        }
      : undefined),
    webServer,
    on: () => () => {},
    effect: (fn) => fn(),
  }
}

async function callUsage(route, month) {
  const res = mockRes()
  await route.handler({ url: `/dizzy/usage?month=${month}`, headers: {} }, res)
  if (res.status !== 200) throw new Error(`route status ${res.status}: ${res.body}`)
  return JSON.parse(res.body)
}

const root = await mkdtemp(join(tmpdir(), 'dizzy-usage-scan-'))
try {
  const dir = join(root, 'fix--area', 'session-synth-0001')
  await mkdir(dir, { recursive: true })
  // 用 DSH 0.1.5 的新日志名 session.v3.jsonl.zstd —— 旧实现写死了
  // `session.jsonl.zstd` 白名单,曾因此把整个九月的会话漏掉。
  const file = join(dir, 'session.v3.jsonl.zstd')

  const day = '2026-08-01'
  const timeOf = (hour) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00.000Z`).getTime()

  writeFile(file, frame(1, 1000, 10, timeOf(1)))

  const plugin = (await import(pathToFileURL(installed).href)).default
  const webServer = mockWebServer()
  // 节流设成 1s(Config 下限),测试里用真实等待跨过它。
  const dispose = plugin.apply(mockCtx(webServer, { sessionRoot: root, scanThrottleMs: 1000, priceSyncMs: 0 }), plugin.Config({ sessionRoot: root, scanThrottleMs: 1000, priceSyncMs: 0 }))
  const route = webServer.routes.get('/dizzy/usage')
  check('注册 /dizzy/usage 路由', route !== undefined)

  console.log('第一次汇总(基线,1010 tokens)')
  const first = await callUsage(route, '2026-08')
  check('基线 total = 1010', first.total === 1010, { total: first.total })
  check('基线 deltaTokens = 0', first.deltaTokens === 0, { delta: first.deltaTokens })
  check('基线 previousScannedAt = 0', first.previousScannedAt === 0, { prev: first.previousScannedAt })
  check('基线 scannedAt 有效', typeof first.scannedAt === 'number' && first.scannedAt > 0, { at: first.scannedAt })
  check('基线 monthsWithData 含 2026-08', Array.isArray(first.monthsWithData) && first.monthsWithData.includes('2026-08'), { m: first.monthsWithData })

  console.log('追加一帧(step2, 2500 input → 2520 tokens),等过节流后汇总')
  appendFile(file, frame(2, 2500, 20, timeOf(2)))
  const now = new Date()
  utimes(file, now, now)
  await new Promise((resolve) => setTimeout(resolve, 1100))

  const second = await callUsage(route, '2026-08')
  check('增量 total = 3530', second.total === 3530, { total: second.total })
  check('增量 deltaTokens = 2520', second.deltaTokens === 2520, { delta: second.deltaTokens, debug: second.deltaDebug })
  check('previousScannedAt = 基线的 scannedAt', second.previousScannedAt === first.scannedAt, { prev: second.previousScannedAt, first: first.scannedAt })
  check('scannedAt 前进', second.scannedAt > first.scannedAt, { a: first.scannedAt, b: second.scannedAt })

  console.log('节流窗口内重复请求:不应重算,delta 保持 0')
  const third = await callUsage(route, '2026-08')
  check('被节流时 scannedAt 不变', third.scannedAt === second.scannedAt, { a: second.scannedAt, b: third.scannedAt })
  check('被节流时 deltaTokens = 0', third.deltaTokens === 0, { delta: third.deltaTokens })
  check('被节流时 total 仍是 3530', third.total === 3530, { total: third.total })

  console.log('文件名兼容:同一会话目录里 v3 与旧名并存 → 只算最新的那个(不叠加)')
  const legacyDir = join(root, 'legacy--area', 'session-legacy-0001')
  await mkdir(legacyDir, { recursive: true })
  await writeFile(join(legacyDir, 'session.jsonl.zstd'), frame(1, 5000, 50, timeOf(3)))
  await new Promise((resolve) => setTimeout(resolve, 1100))
  const legacyOnly = await callUsage(route, '2026-08')
  check('旧名日志被识别(+5050)', legacyOnly.total === 3530 + 5050, { total: legacyOnly.total })

  // 同一目录再加一份更新的 v3:应取代旧名,不再叠加
  await writeFile(join(legacyDir, 'session.v3.jsonl.zstd'), frame(1, 7000, 70, timeOf(4)))
  const newer = new Date(Date.now() + 5000)
  await utimes(join(legacyDir, 'session.v3.jsonl.zstd'), newer, newer)
  await new Promise((resolve) => setTimeout(resolve, 1100))
  const both = await callUsage(route, '2026-08')
  check('v3 取代旧名(总增量 = 7070 − 5050 = 2020)', both.total === 3530 + 7070, { total: both.total, delta: both.deltaTokens })

  console.log('空月倒着找:请求 2026-09(不早于当前月)→ 应回落到 2026-08')
  const back = await callUsage(route, '2026-09')
  check('回落到 2026-08', back.month === '2026-08', { month: back.month })
  check('backScan = true', back.backScan === true, { backScan: back.backScan })
  check('保留请求月', back.requestedMonth === '2026-09', { requested: back.requestedMonth })

  console.log('显式过去的空月:请求 2026-06 → 尊重选择,不回跳')
  const past = await callUsage(route, '2026-06')
  check('保持 2026-06', past.month === '2026-06', { month: past.month })
  check('backScan = false', past.backScan === false, { backScan: past.backScan })
  check('total = 0', past.total === 0, { total: past.total })
  check('monthsWithData 报出有数据的月份', Array.isArray(past.monthsWithData) && past.monthsWithData.includes('2026-08'),
    { monthsWithData: past.monthsWithData })

  dispose()
} finally {
  await rm(root, { recursive: true, force: true })
}

// ── 价格解析:官方路由 vs 第三方网关 + Flash 峰谷 ──────────────────────────
// 官方 2026-09-15 价目(人民币/百万 token)的 Flash 档:
//   缓存未命中 空闲 1 / 高峰 2;输出 空闲 4 / 高峰 8;缓存命中 空闲 0.02 / 高峰 0.04
// 每个 provider 各给 1,000,000 缓存未命中输入 + 0 输出,放在北京时间高峰时段。
const priceRoot = await mkdtemp(join(tmpdir(), 'dizzy-usage-price-'))
try {
  // 2026-08-03 是周一;02:00 UTC = 10:00 北京时间 → 高峰时段。
  const peakTime = Date.parse('2026-08-03T02:00:00.000Z')
  const cases = [
    ['official--area', 'session-a', { provider: 'deepseek-official', model: 'deepseek-flash' }],
    ['legacy--alias', 'session-b', { provider: 'deepseek-official', model: 'deepseek-v4-flash' }],
    ['gateway--area', 'session-c', { provider: 'opencode-go', model: 'deepseek-v4-flash' }],
  ]
  for (const [area, session, model] of cases) {
    const dir = join(priceRoot, area, session)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'session.v3.jsonl.zstd'), frame(1, 1_000_000, 0, peakTime, model))
  }

  const plugin = (await import(pathToFileURL(installed).href)).default
  const webServer = mockWebServer()
  const base = { sessionRoot: priceRoot, scanThrottleMs: 1000, priceSyncMs: 0 }
  plugin.apply(mockCtx(webServer, base), plugin.Config(base))
  const route = webServer.routes.get('/dizzy/usage')
  const month = '2026-08'
  const res = mockRes()
  await route.handler({ url: `/dizzy/usage?month=${month}`, headers: {} }, res)
  const data = JSON.parse(res.body)

  const near = (a, b) => Math.abs(a - b) < 1e-6
  // detail.today 只装「今天」的分模型,夹具日期在 8 月所以那里是空的;
  // 金额断言走查看月的 cost.total 与 detail.recent7 的定日金额 ——
  // 它们都经过同一个 priceFor。
  check('官方新名 + 历史别名各 ¥2,网关无价按 0 → 本月合计 ¥4',
    near(data.cost?.total ?? -1, 4), { total: data.cost?.total, detail: data.cost })
  const dayRow = (data.detail?.recent7 ?? []).find((row) => row.date === '2026-08-03')
  check('官方新名 deepseek-flash 计入官网价(校验单模型 ¥2 基线)',
    near(data.detail?.days?.['2026-08-03']?.input ?? -1, 3_000_000) && (dayRow === undefined || near(dayRow.cost, 4)),
    { day: data.detail?.days?.['2026-08-03'], recent7Row: dayRow })
  check('provider 网关照旧计入 token(不因无价而丢用量)', data.total === 3_000_000, { total: data.total })

  // 逐模型档位核对:每个场景一份独立的 root + 插件实例(扫描有节流,
  // 同一实例里连续追加文件不会立刻重新汇总)。
  const soloRoots = []
  async function soloUsage(model) {
    const soloRoot = await mkdtemp(join(tmpdir(), 'dizzy-usage-price-solo-'))
    soloRoots.push(soloRoot)
    const dir = join(soloRoot, 'a--area', 'session-a')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'session.v3.jsonl.zstd'), frame(1, 1_000_000, 0, peakTime, model))
    const soloBase = { sessionRoot: soloRoot, scanThrottleMs: 1000, priceSyncMs: 0 }
    const soloRoutes = mockWebServer()
    plugin.apply(mockCtx(soloRoutes, soloBase), plugin.Config(soloBase))
    const res = mockRes()
    await soloRoutes.routes.get('/dizzy/usage').handler({ url: '/dizzy/usage?month=2026-08', headers: {} }, res)
    return JSON.parse(res.body)
  }

  // 1) 官方新名,高峰 → ¥2
  const official = await soloUsage({ provider: 'deepseek-official', model: 'deepseek-flash' })
  check('官方 deepseek-flash 高峰 100 万输入 = ¥2', near(official.cost?.total ?? -1, 2), { total: official.cost?.total })

  // 2) 历史别名,同一时刻 → 同为 ¥2(旧表会是 ¥3)
  const alias = await soloUsage({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  check('历史别名 deepseek-v4-flash 亦为 ¥2(已归一,不是旧价 ¥3)', near(alias.cost?.total ?? -1, 2), { total: alias.cost?.total })

  // 3) 同一模型走第三方网关 → 官方价不适用,按 0 计
  const gateway = await soloUsage({ provider: 'opencode-go', model: 'deepseek-v4-flash' })
  check('第三方网关同名模型不套官方价(¥0)', near(gateway.cost?.total ?? -1, 0), { total: gateway.cost?.total })
  for (const dir of soloRoots) await rm(dir, { recursive: true, force: true })

  // 价格表(设置页数据源)
  const pricesRoute = webServer.routes.get('/dizzy/usage-prices')
  const priceRes = mockRes()
  await pricesRoute.handler({ url: '/dizzy/usage-prices', method: 'GET', headers: {} }, priceRes)
  const catalog = JSON.parse(priceRes.body)
  const flash = catalog.prices.find((item) => item.key === 'deepseek-flash')
  const pro = catalog.prices.find((item) => item.key === 'deepseek-v4-pro')
  check('价目表含 deepseek-flash 空闲价 1/4/0.02', flash !== undefined
    && near(flash.inputPerM, 1) && near(flash.outputPerM, 4) && near(flash.cachePerM, 0.02), { flash })
  check('deepseek-flash 峰价 2/8/0.04', flash !== undefined
    && near(flash.peak.inputPerM, 2) && near(flash.peak.outputPerM, 8) && near(flash.peak.cachePerM, 0.04), { peak: flash?.peak })
  check('价目表含 deepseek-v4-pro 空闲价 4.5/13.5/0.15', pro !== undefined
    && near(pro.inputPerM, 4.5) && near(pro.outputPerM, 13.5) && near(pro.cachePerM, 0.15), { pro })
  check('deepseek-v4-pro 峰价 9/27/0.3', pro !== undefined
    && near(pro.peak.inputPerM, 9) && near(pro.peak.outputPerM, 27) && near(pro.peak.cachePerM, 0.3), { peak: pro?.peak })
  check('价目表带出历史别名映射', catalog.aliases?.['deepseek-v4-flash'] === 'deepseek-flash', { aliases: catalog.aliases })
} finally {
  await rm(priceRoot, { recursive: true, force: true })
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)

