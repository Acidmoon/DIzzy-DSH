/**
 * dizzy-dsh-usage-card 插件(Host 端)
 *
 * 职责:聚合本地会话日志(sessionRoot,默认 ~/.dsh/sessions)的每日 token
 *      用量,提供 GET /dizzy/usage?month=YYYY-MM —— 用量视图的数据源。
 *
 * DeepSeek 官方 API 没有按天用量接口,唯一官方数据源是每次响应的
 * usage 字段 —— DSH 已把它落进会话日志(session.jsonl.zstd 的
 * assistant/message 事件 data.usage),这里直接聚合本地日志。
 * 模型归属取同一事件的 data.message.source(provider/model)。
 *
 * 响应形状(后向兼容:days 保持「日期 → 总 tokens」数值映射,
 * 新增 detail 承载分项/分模型,旧 client 读 days 不受影响):
 *   {
 *     month, total, scannedAt, errors,
 *     days:   { 'YYYY-MM-DD': totalTokens },
 *     detail: {
 *       days:    { 'YYYY-MM-DD': { input, output, cacheRead } },   // 查看月逐日分项
 *       recent7: [{ date, input, output, cacheRead, total } ×7],   // 近 7 天(与查看月无关,含零用量天)
 *       today:   { date, models: { 'provider/model': { input, output, cacheRead, total } } },
 *     },
 *   }
 *
 * 配置化(与 dsh 官方插件同一模式):
 *   - Config(schemastery)声明可调字段(sessionRoot / scanThrottleMs),
 *     loader 挂载时校验并填默认值
 *   - settings 服务在场时注册命名空间 'dizzy-usage-card':settings.yaml
 *     同名分节热重载,watch 到变化即重置缓存、下次请求按新配置重扫
 *
 * 生命周期:全部可变聚合状态都在 apply 内(属于本 fiber);模块级只保留
 * 纯函数。文件是「多帧 zstd 拼接」:每次 append 写一帧,帧边界按 zstd
 * 规范遍历 block header 得到(不依赖 FCS 字段),逻辑复刻自
 * @deepseek-ai/dsh-session-persistence-jsonl 的 scanZstdFrames;逐帧用
 * node:zlib 的 zstdDecompressSync 解压(本机 Node ≥ 22.14)。
 *
 * Client 半区见 client.js:会话视图「用量」Tab(conversation.view)。
 */
import { readdir, stat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import Schema from 'schemastery'

/** 价格条目 schema(Config 与 POST /dizzy/usage-prices 共用同一校验)。 */
const PriceEntry = Schema.object({
  inputPerM: Schema.number().min(0).default(0),
  outputPerM: Schema.number().min(0).default(0),
  cachePerM: Schema.number().min(0).default(0),
})

/** 可调配置(loader 挂载时校验;settings 命名空间复用同一 schema)。 */
const Config = Schema.object({
  /** 会话日志根目录(DSH_HOME 非默认时在此覆盖)。 */
  sessionRoot: Schema.string().default(join(homedir(), '.dsh', 'sessions')),
  /** 增量扫描节流间隔(毫秒),1s ~ 10min。 */
  scanThrottleMs: Schema.number().min(1000).max(600000).default(30000),
  /** 金额计算的价格表:模型键 → 每百万 token 价格(货币单位见 currency)。
   *  键格式与日志模型归属一致:provider/model 或裸 model 名;
   *  本地价格优先于官方价,官方价优先于 OpenRouter 聚合价。 */
  prices: Schema.dict(PriceEntry).default({}),
  /** 金额显示货币符号(仅展示,不换算)。 */
  currency: Schema.string().default('¥'),
  /** USD→CNY 汇率:仅用于把 OpenRouter 美元价换算成 currency 计价。 */
  fxRate: Schema.number().min(0.01).max(100).default(6.8),
  /** OpenRouter 聚合价拉取节流(毫秒),1min ~ 24h;0 = 禁用聚合价。 */
  priceSyncMs: Schema.number().min(0).max(86400000).default(6 * 3600 * 1000),
})

/** 聚合价格源:OpenRouter 公开 models 目录(免 key,每日更新)。
 *  响应 data[].id = provider/model, pricing 单位为「美元/token」。 */
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

/**
 * 官方价格表(人民币/百万 token):DeepSeek 官网现行定价,含峰谷两档。
 * 高峰时段 = 北京时间 9:00-12:00 / 14:00-18:00,价格为空闲的 2 倍。
 * 来源:https://api-docs.deepseek.com/zh-cn/quick_start/pricing(2026-08-17 核对)。
 * 键为裸模型名,自动匹配日志里的 deepseek-official/deepseek-v4-* 等归属。
 */
const OFFICIAL_PRICES = {
  'deepseek-v4-flash': {
    inputPerM: 1.5, outputPerM: 4.5, cachePerM: 0.05,
    peak: { inputPerM: 3.0, outputPerM: 9.0, cachePerM: 0.10 },
  },
  'deepseek-v4-pro': {
    inputPerM: 4.5, outputPerM: 13.5, cachePerM: 0.15,
    peak: { inputPerM: 9.0, outputPerM: 27.0, cachePerM: 0.30 },
  },
}

/** 北京时间(Asia/Shanghai)是否为高峰时段(9-12 / 14-18,含端点)。 */
function isPeakHour(date) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit',
  }).format(date))
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

/** settings.yaml 中本插件的命名空间(规则同官方:/^[a-z][a-z0-9-]*$/)。 */
const SETTINGS_NS = 'dizzy-usage-card'

const ZSTD_MAGIC = 4247762216

/**
 * 同源校验:跨站浏览器请求(sec-fetch-site: cross-site 或 Origin 与 Host
 * 不符)拒绝;无 Origin 的非浏览器客户端(curl 等)放行。
 */
function isSameOriginRequest(req) {
  const fetchSite = req.headers['sec-fetch-site']
  if (fetchSite === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  const host = req.headers.host
  if (host === undefined) return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host
  } catch {
    return false
  }
}

// ── 纯函数(无状态,模块级)──────────────────────────────────────────────

// DayAgg = { input, output, cacheRead, models: Map<modelKey, ModelUsage> }
// ModelUsage = { input, output, cacheRead, peakInput, peakOutput, peakCacheRead }
// (peak* = 高峰时段部分,用于峰谷计价;其余为空闲时段)
function emptyAgg() {
  return { input: 0, output: 0, cacheRead: 0, models: new Map() }
}

function addUsage(agg, modelKey, usage, isPeak) {
  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  const cacheRead = usage.cacheReadTokens ?? 0
  agg.input += input
  agg.output += output
  agg.cacheRead += cacheRead
  let m = agg.models.get(modelKey)
  if (m === undefined) {
    m = { input: 0, output: 0, cacheRead: 0, peakInput: 0, peakOutput: 0, peakCacheRead: 0 }
    agg.models.set(modelKey, m)
  }
  m.input += input
  m.output += output
  m.cacheRead += cacheRead
  if (isPeak) {
    m.peakInput += input
    m.peakOutput += output
    m.peakCacheRead += cacheRead
  }
}

function mergeAgg(target, source) {
  target.input += source.input
  target.output += source.output
  target.cacheRead += source.cacheRead
  for (const [key, value] of source.models) {
    let m = target.models.get(key)
    if (m === undefined) {
      m = { input: 0, output: 0, cacheRead: 0, peakInput: 0, peakOutput: 0, peakCacheRead: 0 }
      target.models.set(key, m)
    }
    m.input += value.input
    m.output += value.output
    m.cacheRead += value.cacheRead
    m.peakInput += value.peakInput
    m.peakOutput += value.peakOutput
    m.peakCacheRead += value.peakCacheRead
  }
}

function aggTotal(agg) {
  return agg.input + agg.output + agg.cacheRead
}

// ── 价格解析与金额计算(纯函数,可测)──────────────────────────────

/** 聚合源价格表:modelKey → { inputPerM, outputPerM, cachePerM }(美元/百万 token)。 */
async function fetchOpenRouterPrices() {
  const response = await fetch(OPENROUTER_MODELS_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`openrouter ${response.status}`)
  const body = await response.json()
  const models = new Map()
  for (const item of body.data ?? []) {
    if (typeof item?.id !== 'string' || item.pricing === null || typeof item.pricing !== 'object') continue
    const p = item.pricing
    const num = (value) => {
      const n = Number(value)
      return Number.isFinite(n) && n >= 0 ? n * 1e6 : undefined // $/token → $/百万 token
    }
    const inputPerM = num(p.prompt)
    const outputPerM = num(p.completion)
    const cachePerM = num(p.input_cache_read) ?? num(p.prompt)
    if (inputPerM === undefined && outputPerM === undefined && cachePerM === undefined) continue
    models.set(item.id, {
      inputPerM: inputPerM ?? 0,
      outputPerM: outputPerM ?? 0,
      cachePerM: cachePerM ?? 0,
    })
  }
  return models
}

/**
 * 解析某个模型键的价格:本地 prices → 官方价表 → OpenRouter(先精确 id,
 * 再按裸 model 名兜底)。返回
 * { inputPerM, outputPerM, cachePerM, peak?, source: 'local'|'official'|'openrouter'|'none' }。
 *
 * 本地与官方均按裸名兜底:用户键可写 provider/model 或裸 model 名,两种写法
 * 都能命中日志里的 provider/model(即使 provider 前缀不同,
 * 如 deepseek-official/deepseek-chat ↔ deepseek/deepseek-chat)。
 * OpenRouter 价为美元,按 fxRate 换算成 currency 计价。
 */
function priceFor(modelKey, localPrices, openRouter, fxRate) {
  const bareModel = modelKey.split('/').pop()
  const local = localPrices[modelKey]
    ?? localPrices[bareModel]
    ?? Object.entries(localPrices).find(([key]) => key.split('/').pop() === bareModel)?.[1]
  if (local !== undefined) {
    return { ...local, source: 'local' }
  }
  const official = OFFICIAL_PRICES[bareModel]
  if (official !== undefined) {
    return { ...official, source: 'official' }
  }
  const rate = fxRate ?? 1
  const scale = (entry) => entry === undefined ? undefined : {
    inputPerM: entry.inputPerM * rate,
    outputPerM: entry.outputPerM * rate,
    cachePerM: entry.cachePerM * rate,
  }
  const exact = openRouter.get(modelKey)
  if (exact !== undefined) return { ...scale(exact), source: 'openrouter' }
  const fallback = [...openRouter.entries()].find(([id]) => id.split('/').pop() === bareModel)?.[1]
  if (fallback !== undefined) return { ...scale(fallback), source: 'openrouter' }
  return { inputPerM: 0, outputPerM: 0, cachePerM: 0, source: 'none' }
}

/**
 * 按价格表计算金额(tokens / 1e6 × 每百万价格)。
 * 价格带 peak 两档时,按 tokens 的 peak* 分项分段计价(官方峰谷价);
 * 单档价格(本地/OpenRouter)忽略 peak 拆分。
 */
function costOf(tokens, price) {
  const peak = price.peak
  if (peak !== undefined) {
    const offInput = tokens.input - tokens.peakInput
    const offOutput = tokens.output - tokens.peakOutput
    const offCache = tokens.cacheRead - tokens.peakCacheRead
    return (
      (offInput / 1e6) * price.inputPerM + (tokens.peakInput / 1e6) * peak.inputPerM +
      (offOutput / 1e6) * price.outputPerM + (tokens.peakOutput / 1e6) * peak.outputPerM +
      (offCache / 1e6) * price.cachePerM + (tokens.peakCacheRead / 1e6) * peak.cachePerM
    )
  }
  return (
    (tokens.input / 1e6) * price.inputPerM +
    (tokens.output / 1e6) * price.outputPerM +
    (tokens.cacheRead / 1e6) * price.cachePerM
  )
}

/** 金额格式化:两位小数,去除无意义的 .00。 */
function formatCost(value) {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
}

function localDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// 模型归属:provider/model 全限定,缺省记 unknown(不丢弃用量)
function modelKeyOf(data) {
  const source = data.message !== null && typeof data.message === 'object' ? data.message.source : undefined
  const provider = source !== null && typeof source === 'object' && typeof source.provider === 'string' ? source.provider : ''
  const model = source !== null && typeof source === 'object' && typeof source.model === 'string' ? source.model : ''
  if (model === '') return 'unknown'
  return provider === '' ? model : `${provider}/${model}`
}

function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`corrupt zstd session log: invalid frame magic at byte ${offset}`)
    offset += 4
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    for (;;) {
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      offset += blockType === 1 ? 1 : blockSize
      if (lastBlock) break
    }
    if (checksum) offset += 4
    frames.push({ start, end: offset })
  }
  return frames
}

async function parseSessionFile(file) {
  const buffer = await readFile(file)
  if (file.endsWith('.jsonl')) return parseSessionText(buffer.toString('utf8'))
  const frames = scanZstdFrames(buffer)
  const parts = []
  for (const frame of frames) {
    parts.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end)))
  }
  return parseSessionText(Buffer.concat(parts).toString('utf8'))
}

function parseSessionText(text) {
  const days = new Map()
  for (const line of text.split('\n')) {
    if (line === '') continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type !== 'assistant/message' || event.data === null || event.data === undefined) continue
    const usage = event.data.usage
    if (usage === null || usage === undefined) continue
    const tokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cacheReadTokens ?? 0)
    if (tokens <= 0) continue
    const key = localDayKey(new Date(event.time))
    let agg = days.get(key)
    if (agg === undefined) {
      agg = emptyAgg()
      days.set(key, agg)
    }
    addUsage(agg, modelKeyOf(event.data), usage, isPeakHour(new Date(event.time)))
  }
  return days
}

export default {
  name: 'dizzy-dsh-usage-card',
  inject: ['webServer'],
  Config,
  apply(ctx, config) {
    // settings 命名空间:schema 默认值 ← entry config(base) ← settings.yaml
    // 用户层;settings 服务不在场时退回已校验的 entry config,行为不变。
    const settings = ctx.get('settings')
    const scope = settings === undefined
      ? undefined
      : settings.register(SETTINGS_NS, Config, { base: config })
    const current = () => (scope === undefined ? config : scope.get())

    // 全部可变聚合状态都属于本 fiber:卸载/重挂后从干净的缓存重新开始。
    const fileStates = new Map() // path -> { key, days: Map<'YYYY-MM-DD', DayAgg> }
    let dayTotals = new Map()    // 'YYYY-MM-DD' -> DayAgg
    let scanAt = 0
    let scanErrors = 0

    // 增量扫描:只重读 (mtime, size) 变化的文件,其余沿用缓存的分日结果
    async function refreshUsage() {
      const cfg = current()
      if (Date.now() - scanAt < cfg.scanThrottleMs) return
      const totals = new Map()
      let errors = 0
      const seen = new Set()
      const mergeInto = (day, agg) => {
        let target = totals.get(day)
        if (target === undefined) {
          target = emptyAgg()
          totals.set(day, target)
        }
        mergeAgg(target, agg)
      }
      try {
        for (const area of await readdir(cfg.sessionRoot)) {
          const areaPath = join(cfg.sessionRoot, area)
          let areaStat
          try {
            areaStat = await stat(areaPath)
          } catch {
            continue
          }
          if (!areaStat.isDirectory()) continue
          for (const sessionId of await readdir(areaPath)) {
            for (const name of ['session.jsonl.zstd', 'session.jsonl']) {
              const file = join(areaPath, sessionId, name)
              let fileStat
              try {
                fileStat = await stat(file)
              } catch {
                continue
              }
              if (!fileStat.isFile()) continue
              seen.add(file)
              const key = `${fileStat.mtimeMs}:${fileStat.size}`
              const cached = fileStates.get(file)
              if (cached !== undefined && cached.key === key) {
                for (const [day, agg] of cached.days) mergeInto(day, agg)
                break
              }
              try {
                const days = await parseSessionFile(file)
                fileStates.set(file, { key, days })
                for (const [day, agg] of days) mergeInto(day, agg)
              } catch {
                errors += 1
              }
              break
            }
          }
        }
      } catch (err) {
        // 顶层失败(如 sessionRoot 不可读):dayTotals 保留上次良好快照,
        // 错误计数计入本次已累积 errors + 本次顶层失败
        scanErrors = errors + 1
        scanAt = Date.now()
        return
      }
      for (const file of fileStates.keys()) {
        if (!seen.has(file)) fileStates.delete(file)
      }
      dayTotals = totals
      scanAt = Date.now()
      scanErrors = errors
    }

    // 配置热应用:日志根或节流间隔变化 → 重置缓存,下次请求按新配置全量重扫。
    const stopWatch = scope === undefined
      ? () => {}
      : scope.watch(() => {
          fileStates.clear()
          dayTotals = new Map()
          scanAt = 0
        })

    // ── 价格表:OpenRouter 聚合价(节流拉取,失败静默降级)+ 本地覆盖 ──
    let openRouterPrices = new Map()
    let openRouterAt = 0
    let openRouterError = null
    async function ensureOpenRouterPrices() {
      const cfg = current()
      if (cfg.priceSyncMs <= 0) return
      if (Date.now() - openRouterAt < cfg.priceSyncMs) return
      openRouterAt = Date.now()
      try {
        openRouterPrices = await fetchOpenRouterPrices()
        openRouterError = null
      } catch (error) {
        openRouterError = error instanceof Error ? error.message : String(error)
      }
    }

    // ── 金额汇总:月度/近7天/今日 各处统一从价格表派生,不污染 token 聚合 ──
    function summarizeCost(agg) {
      const cfg = current()
      let total = 0
      let priced = 0
      for (const [key, value] of agg.models) {
        const price = priceFor(key, cfg.prices, openRouterPrices, cfg.fxRate)
        const cost = costOf(value, price)
        if (price.source !== 'none') priced += 1
        total += cost
      }
      return { total, priced, modelCount: agg.models.size }
    }

    const stopUsageRoute = ctx.webServer.register({
      kind: 'exact',
      path: '/dizzy/usage',
      handler: async (req, res) => {
        if (!isSameOriginRequest(req)) {
          res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'forbidden: cross-site request' }))
          return
        }
        const url = new URL(req.url ?? '/', 'http://dizzy.local')
        const month = url.searchParams.get('month') ?? ''
        if (!/^\d{4}-\d{2}$/.test(month)) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'month must be YYYY-MM' }))
          return
        }
        await refreshUsage()
        await ensureOpenRouterPrices()
        const cfg = current()

        // 查看月:逐日总量(兼容旧 client)+ 输入/输出/缓存分项(悬浮弹窗)
        const days = {}
        const detailDays = {}
        let total = 0
        for (const [day, agg] of dayTotals) {
          if (!day.startsWith(`${month}-`)) continue
          const tokens = aggTotal(agg)
          if (tokens <= 0) continue
          days[day] = tokens
          detailDays[day] = { input: agg.input, output: agg.output, cacheRead: agg.cacheRead }
          total += tokens
        }

        // 近 7 天与今日分模型:与查看月无关,固定相对「今天」
        const now = new Date()
        const recent7 = []
        for (let i = 6; i >= 0; i -= 1) {
          const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
          const key = localDayKey(date)
          const agg = dayTotals.get(key)
          recent7.push({
            date: key,
            input: agg?.input ?? 0,
            output: agg?.output ?? 0,
            cacheRead: agg?.cacheRead ?? 0,
            total: agg === undefined ? 0 : aggTotal(agg),
            cost: agg === undefined || agg.models.size === 0 ? 0 : summarizeCost(agg).total,
          })
        }
        const todayAgg = dayTotals.get(localDayKey(now))
        const models = {}
        let todayCost = 0
        if (todayAgg !== undefined) {
          for (const [key, value] of todayAgg.models) {
            const price = priceFor(key, cfg.prices, openRouterPrices, cfg.fxRate)
            const cost = costOf(value, price)
            todayCost += cost
            models[key] = {
              input: value.input,
              output: value.output,
              cacheRead: value.cacheRead,
              peakInput: value.peakInput,
              peakOutput: value.peakOutput,
              peakCacheRead: value.peakCacheRead,
              total: value.input + value.output + value.cacheRead,
              cost,
              price: {
                source: price.source,
                inputPerM: price.inputPerM,
                outputPerM: price.outputPerM,
                cachePerM: price.cachePerM,
                peak: price.peak ?? null,
              },
            }
          }
        }

        // 月度金额:对查看月逐日累计
        let monthCost = 0
        let monthPriced = 0
        for (const [day, agg] of dayTotals) {
          if (!day.startsWith(`${month}-`)) continue
          if (aggTotal(agg) <= 0) continue
          const summary = summarizeCost(agg)
          monthCost += summary.total
          monthPriced += summary.priced
        }

        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(JSON.stringify({
          month,
          days,
          total,
          detail: {
            days: detailDays,
            recent7,
            today: { date: localDayKey(now), models, cost: todayCost },
          },
          cost: {
            total: monthCost,
            currency: cfg.currency,
            priced: monthPriced,
          },
          pricing: {
            source: openRouterError === null && openRouterPrices.size > 0 ? 'openrouter' : (Object.keys(cfg.prices).length > 0 ? 'local' : 'none'),
            asOf: openRouterAt,
            modelCount: openRouterPrices.size,
            localCount: Object.keys(cfg.prices).length,
            error: openRouterError,
          },
          scannedAt: scanAt,
          errors: scanErrors,
        }))
      },
    })

    // ── 价格管理路由:设置页读取完整价目表 / 写回本地覆盖价 ──
    // GET  /dizzy/usage-prices → 完整价目表(官方 + OpenRouter + 本地覆盖)
    // POST /dizzy/usage-prices → { prices } 写回 settings.yaml(scope.update
    //   保留注释,watch 自动触发缓存重置 → 下一次 /dizzy/usage 实时按新价计算)
    const stopPricesRoute = ctx.webServer.register({
      kind: 'exact',
      path: '/dizzy/usage-prices',
      handler: async (req, res) => {
        if (!isSameOriginRequest(req)) {
          res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'forbidden: cross-site request' }))
          return
        }
        const method = req.method ?? 'GET'
        if (method === 'GET') {
          await ensureOpenRouterPrices()
          const cfg = current()
          // 目录 = 官方表 + OpenRouter 目录 + 本地覆盖(本地标记 source local)
          const catalog = []
          const seen = new Set()
          for (const [id, price] of OFFICIAL_PRICES) {
            catalog.push({ key: id, name: id, source: 'official', ...price })
            seen.add(id)
          }
          for (const [id, price] of openRouterPrices) {
            if (seen.has(id)) continue
            seen.add(id)
            catalog.push({
              key: id,
              name: id,
              source: 'openrouter',
              inputPerM: price.inputPerM * cfg.fxRate,
              outputPerM: price.outputPerM * cfg.fxRate,
              cachePerM: price.cachePerM * cfg.fxRate,
            })
          }
          for (const [key, price] of Object.entries(cfg.prices)) {
            const bare = key.split('/').pop()
            if (seen.has(bare)) {
              const existing = catalog.find((item) => item.key === bare || item.key.split('/').pop() === bare)
              if (existing !== undefined) {
                existing.source = 'local'
                existing.inputPerM = price.inputPerM
                existing.outputPerM = price.outputPerM
                existing.cachePerM = price.cachePerM
              }
              continue
            }
            catalog.push({ key, name: key, source: 'local', ...price })
            seen.add(bare)
          }
          catalog.sort((a, b) => a.name.localeCompare(b.name))
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(JSON.stringify({
            currency: cfg.currency,
            fxRate: cfg.fxRate,
            prices: catalog,
          }))
          return
        }
        if (method === 'POST') {
          if (scope === undefined) {
            res.writeHead(409, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: 'settings 服务不可用,无法保存价格' }))
            return
          }
          let body
          try {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          } catch {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: 'invalid JSON body' }))
            return
          }
          const prices = body?.prices
          if (prices === null || typeof prices !== 'object' || Array.isArray(prices)) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: 'prices must be an object' }))
            return
          }
          // 用 PriceEntry 校验用户写入的每个条目(拒绝负数/非数字),再整体写入
          const clean = {}
          for (const [key, value] of Object.entries(prices)) {
            const entry = PriceEntry({ ...value })
            clean[key] = {
              inputPerM: entry.inputPerM,
              outputPerM: entry.outputPerM,
              cachePerM: entry.cachePerM,
            }
          }
          try {
            await scope.update({ prices: clean })
          } catch (error) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({
              error: '写入 settings.yaml 失败:' + (error instanceof Error ? error.message : String(error)),
            }))
            return
          }
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(JSON.stringify({ ok: true, saved: Object.keys(clean).length }))
          return
        }
        res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: 'method not allowed' }))
      },
    })

    return () => {
      stopWatch()
      stopUsageRoute()
      stopPricesRoute()
    }
  },
}
