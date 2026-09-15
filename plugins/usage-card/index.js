/**
 * dizzy-dsh-usage-card 插件(Host 端)
 *
 * 职责:聚合本地会话日志(sessionRoot,默认 ~/.dsh/sessions)的每日 token
 *      用量,提供 GET /dizzy/usage?month=YYYY-MM —— 用量视图的数据源。
 *
 * DeepSeek 官方 API 没有按天用量接口。DSH token-meter 以
 * `assistant/message.usage`(或 assistant/attempt 的 stream 末尾 usage)为样本,
 * 按 turn/step 末次覆盖,`llm/retry-started` 清槽让重试累加(0.1.1-rc.2 起,
 * 0.1.5-rc.1 实测未变;核对见 scripts/verify-usage-accounting.mjs);旧日志只有
 * message.usage 时同样按条累计。模型归属取 assistant/message 的
 * data.message.source。
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
 * DeepSeek 官方价(人民币/百万 token),含峰谷两档。
 *
 * 高峰时段 = 北京时间周一至周五 9:00-12:00 / 14:00-18:00,价格为空闲的 2 倍;
 * 其余时段(含周末)为空闲价。
 * 来源:https://api-docs.deepseek.com/zh-cn/quick_start/pricing(2026-09-15 核对)
 *
 * | 模型(api 名)      | 版本                 | 缓存命中 空闲/高峰 | 缓存未命中 空闲/高峰 | 输出 空闲/高峰 |
 * | deepseek-flash     | DeepSeek-V4.1-Flash  | 0.02 / 0.04       | 1 / 2                | 4 / 8          |
 * | deepseek-v4-pro    | DeepSeek-V4-Pro-0813 | 0.15 / 0.30       | 4.5 / 9              | 13.5 / 27      |
 *
 * 键必须是**官方现行 api 名**;日志里出现过的历史名(`deepseek-v4-flash`、
 * `deepseek-v4-flash-vision-exp`)走 OFFICIAL_PRICE_ALIASES 归一到同一档
 * —— 官方明确说明这些旧名仍可调用,由 V4.1-Flash 提供服务并按 Flash 价格计费。
 */
const OFFICIAL_PRICES = {
  'deepseek-flash': {
    inputPerM: 1, outputPerM: 4, cachePerM: 0.02,
    peak: { inputPerM: 2, outputPerM: 8, cachePerM: 0.04 },
  },
  'deepseek-v4-pro': {
    inputPerM: 4.5, outputPerM: 13.5, cachePerM: 0.15,
    peak: { inputPerM: 9, outputPerM: 27, cachePerM: 0.3 },
  },
}

/** 官方价只适用于 DeepSeek 官方路由;同一模型经第三方网关(如 opencode-go)走聚合价。 */
const OFFICIAL_PROVIDER = 'deepseek-official'

/**
 * 历史/变体模型名 → 现行官方价条目。长名优先匹配,避免
 * `deepseek-v4-flash-vision-exp` 被更短的 `deepseek-v4-flash` 抢走。
 */
const OFFICIAL_PRICE_ALIASES = [
  ['deepseek-v4-flash-vision-exp', 'deepseek-flash'],
  ['deepseek-v4-flash', 'deepseek-flash'],
  ['deepseek-v4-pro-0813', 'deepseek-v4-pro'],
  ['deepseek-v3.2', 'deepseek-flash'],
]

function peakHour(entry, base) {
  return entry.peak ?? {
    inputPerM: base.inputPerM * 2,
    outputPerM: base.outputPerM * 2,
    cachePerM: base.cachePerM * 2,
  }
}

/**
 * 把日志里的 provider/model 键归一到官方价条目;不是官方路由、或名字不认识
 * 时返回 undefined(交给本地价 / OpenRouter 兜底)。
 */
function officialPriceFor(provider, bareModel) {
  if (provider !== OFFICIAL_PROVIDER) return undefined
  if (Object.hasOwn(OFFICIAL_PRICES, bareModel)) return OFFICIAL_PRICES[bareModel]
  for (const [alias, canonical] of OFFICIAL_PRICE_ALIASES) {
    if (bareModel === alias || bareModel.startsWith(`${alias}-`)) return OFFICIAL_PRICES[canonical]
  }
  return undefined
}

/** 北京时间(Asia/Shanghai)是否为高峰时段(周一~周五 9-12 / 14-18,含端点)。 */
function isPeakHour(date) {
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(date)
  if (weekday === 'Sat' || weekday === 'Sun') return false
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
  // DSH TokenUsage uses inputTokens; the token-meter projection view
  // names the same bucket uncachedInputTokens. Accept both so older and
  // newer logs fold into one input column.
  const input = usage.inputTokens ?? usage.uncachedInputTokens ?? 0
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
 * 解析某个模型键的价格:本地 prices → DeepSeek 官方价(仅官方路由)→
 * OpenRouter(先精确 id,再按裸 model 名兜底)。返回
 * { inputPerM, outputPerM, cachePerM, peak?, source: 'local'|'official'|'openrouter'|'none' }。
 *
 * 本地价按裸名兜底:用户键可写 provider/model 或裸 model 名,两种写法都能命中
 * 日志里的 provider/model(即使 provider 前缀不同)。
 * 官方价则**必须** provider 是 `deepseek-official` —— 同一模型经第三方网关
 * 跑的时候按网关的价算,不能套官方价。
 * OpenRouter 价为美元,按 fxRate 换算成 currency 计价。
 */
function priceFor(modelKey, localPrices, openRouter, fxRate) {
  const slash = modelKey.indexOf('/')
  const provider = slash < 0 ? '' : modelKey.slice(0, slash)
  const bareModel = slash < 0 ? modelKey : modelKey.slice(slash + 1)
  const local = localPrices[modelKey]
    ?? localPrices[bareModel]
    ?? Object.entries(localPrices).find(([key]) => key.split('/').pop() === bareModel)?.[1]
  if (local !== undefined) {
    return { ...local, source: 'local' }
  }
  const official = officialPriceFor(provider, bareModel)
  if (official !== undefined) {
    return { ...official, peak: peakHour(official, official), source: 'official' }
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

/**
 * Normalize one usage payload. Empty / missing samples are dropped so they
 * do not create a day bucket.
 */
function usageBuckets(usage) {
  if (usage === null || typeof usage !== 'object') return null
  const input = usage.inputTokens ?? usage.uncachedInputTokens ?? 0
  const output = usage.outputTokens ?? 0
  const cacheRead = usage.cacheReadTokens ?? 0
  if (input === 0 && output === 0 && cacheRead === 0) return null
  return usage
}

/**
 * Fold one session log into per-day aggregates.
 *
 * DSH token accounting (token-meter) folds `assistant/attempt` /
 * `assistant/message` samples with a last-wins slot keyed by turn/step:
 * a sample for the same turn/step replaces the previous one, and
 * `llm/retry-started` clears that slot so the retried attempt ADDS to the
 * total instead of replacing the failed one. A chunk sample and an identical
 * final message are therefore not counted twice, while a failed request that
 * only left a chunk still counts. This fold mirrors that rule against the
 * session log: every `assistant/chunk { type: 'usage' }` is one sample (the
 * same value the attempt carries in its stream), `assistant/message.usage`
 * commits the same key, and `llm/retry-started` drops the key. Older logs
 * with only `assistant/message.usage` keep working (anonymous keys when
 * turn/step are missing).
 */
function parseSessionText(text) {
  const days = new Map()
  const byStep = new Map()
  let anon = 0
  for (const line of text.split('\n')) {
    if (line === '') continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const data = event.data
    if (data === null || data === undefined) continue
    const turn = data.turn
    const step = data.step
    const hasKey = Number.isFinite(turn) && Number.isFinite(step)
    const stepKey = hasKey ? `${turn}/${step}` : `anon:${anon++}`

    // 重试:官方 token-meter 清掉该 turn/step 的覆盖槽,让重试的尝试累加。
    if (event.type === 'llm/retry-started') {
      if (hasKey) byStep.delete(stepKey)
      continue
    }

    if (event.type === 'assistant/chunk' && data.chunk !== null && typeof data.chunk === 'object' && data.chunk.type === 'usage') {
      const usage = usageBuckets(data.chunk.usage)
      if (usage === null) continue
      const prev = byStep.get(stepKey)
      byStep.set(stepKey, {
        usage,
        modelKey: prev?.modelKey ?? 'unknown',
        time: event.time ?? prev?.time,
      })
      continue
    }

    if (event.type !== 'assistant/message') continue
    const modelKey = modelKeyOf(data)
    const usage = usageBuckets(data.usage)
    const prev = byStep.get(stepKey)
    if (usage !== null) {
      byStep.set(stepKey, {
        usage,
        modelKey: modelKey === 'unknown' ? (prev?.modelKey ?? 'unknown') : modelKey,
        time: event.time ?? prev?.time,
      })
    } else if (prev !== undefined && modelKey !== 'unknown') {
      byStep.set(stepKey, { ...prev, modelKey })
    }
  }

  for (const rec of byStep.values()) {
    if (rec.time === undefined) continue
    const key = localDayKey(new Date(rec.time))
    let agg = days.get(key)
    if (agg === undefined) {
      agg = emptyAgg()
      days.set(key, agg)
    }
    addUsage(agg, rec.modelKey, rec.usage, isPeakHour(new Date(rec.time)))
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
    // 纯数字索引:'YYYY-MM-DD' -> token 合计。增量只从这里算 —— 它与
    // dayTotals 同步写入,但结构简单(只装数字),不会和聚合对象混淆。
    let dayTokenTotals = new Map()
    let scanAt = 0               // 上次真正汇总完成的时刻
    let previousScanAt = 0       // 再上一次汇总完成的时刻
    let scanDeltaTokens = 0      // 本轮汇总相对上一次新增的 token
    let scanErrors = 0
    let lastScanFresh = false    // 本次请求是否真的跑了汇总(被节流跳过则为 false)

    /** 从一份 dayTotals 派生纯数字索引。 */
    function tokenIndexOf(totals) {
      const out = new Map()
      for (const [day, agg] of totals) out.set(day, aggTotal(agg))
      return out
    }

    /**
     * 增量扫描:只重读 (mtime, size) 变化的文件,其余沿用缓存的分日结果。
     *
     * 「增量」有两层含义,本函数把两层都记下来:
     *   - 文件层:缓存 key 未变的文件直接用上一次的分日结果,不重新解压;
     *   - 汇总层:本轮 dayTotals 与上一轮逐日相减,得到新增 token
     *     (只增不减,因此差值非负),作为「上次汇总 → 现在」的增量。
     */
    async function refreshUsage() {
      const cfg = current()
      if (Date.now() - scanAt < cfg.scanThrottleMs) {
        // 节流窗口内:沿用上一次汇总结果。标记为「非新鲜」,让路由不要把
        // 同一批增量反复报成「本轮新增」。
        lastScanFresh = false
        return false
      }
      const beforeTokens = dayTokenTotals
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
            const sessionPath = join(areaPath, sessionId)
            let entries
            try {
              entries = await readdir(sessionPath, { withFileTypes: true })
            } catch {
              continue
            }
            // 会话日志的文件名随内核版本变:老的是 session.jsonl.zstd,
            // DSH 0.1.5 起是 session.v3.jsonl.zstd。**不能写死白名单** ——
            // 曾因此漏掉整个九月的会话(只有 v3 日志)。这里按后缀认,
            // 显式排除备份/单帧修复产物(*.bak、*.singleframe-*、*.old)。
            const candidates = []
            for (const entry of entries) {
              if (!entry.isFile()) continue
              const name = entry.name
              if (!name.startsWith('session') || !name.includes('.jsonl')) continue
              if (name.endsWith('.bak') || name.includes('.singleframe-') || name.endsWith('.old')) continue
              let fileStat
              try {
                fileStat = await stat(join(sessionPath, name))
              } catch {
                continue
              }
              if (!fileStat.isFile()) continue
              candidates.push({ file: join(sessionPath, name), stat: fileStat })
            }
            // 一个会话目录理论上只有一个日志;若并存(迁移期)取 mtime 最新的那个,
            // 绝不把同一会话的两份日志叠加计费。
            candidates.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)
            for (const candidate of candidates) {
              const file = candidate.file
              const fileStat = candidate.stat
              seen.add(file)
              const key = `${fileStat.mtimeMs}:${fileStat.size}`
              const cached = fileStates.get(file)
              if (cached !== undefined && cached.key === key) {
                for (const [day, agg] of cached.days) mergeInto(day, agg)
                break
              }
              // 先取旧值:解析失败时保留它,让下次请求还能重试这个文件。
              const previousDays = cached === undefined ? undefined : cached.days
              try {
                const days = await parseSessionFile(file)
                fileStates.set(file, { key, days })
                for (const [day, agg] of days) mergeInto(day, agg)
              } catch {
                errors += 1
                if (previousDays !== undefined) {
                  for (const [day, agg] of previousDays) mergeInto(day, agg)
                }
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
        scanDeltaTokens = 0
        return true
      }
      for (const file of fileStates.keys()) {
        if (!seen.has(file)) fileStates.delete(file)
      }
      // 增量 = 本轮逐日 token 合计 − 上一轮同一索引;只增不减,差值非负。
      // 首次汇总(没有上一轮索引)不算增量 —— 那不是「自上次汇总以来的新增」。
      const afterTokens = tokenIndexOf(totals)
      let delta = 0
      if (beforeTokens.size > 0) {
        for (const [day, tokens] of afterTokens) delta += tokens - (beforeTokens.get(day) ?? 0)
      }
      previousScanAt = scanAt
      scanDeltaTokens = delta > 0 ? delta : 0
      lastScanFresh = true
      dayTotals = totals
      dayTokenTotals = afterTokens
      scanAt = Date.now()
      scanErrors = errors
      return true
    }

    // 配置热应用:日志根或节流间隔变化 → 重置缓存,下次请求按新配置全量重扫。
    const stopWatch = scope === undefined
      ? () => {}
      : scope.watch(() => {
          fileStates.clear()
          dayTotals = new Map()
          dayTokenTotals = new Map()
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

        // 请求月没有任何用量时,往前翻到最近一个有用量的月。这是**默认行为**
        // (像编辑器打开最近一次编辑的位置),界面上不做标注,只把回跳按钮
        // 换成「相邻的有数据月」。
        // 只在「请求月不早于当前月」时启用 —— 用户手点日历翻到某个空的过去
        // 月份时,应当尊重他的选择(显示 0),而不是把视图弹去别的月。
        const nowMonth = localDayKey(new Date()).slice(0, 7)
        const tokensOfMonth = (value) => {
          let sum = 0
          for (const [day, agg] of dayTotals) {
            if (day.startsWith(`${value}-`)) sum += aggTotal(agg)
          }
          return sum
        }
        const shiftMonth = (value, delta) => {
          const [year, monthNo] = value.split('-').map(Number)
          const date = new Date(year, monthNo - 1 + delta, 1)
          return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        }
        const monthsWithData = []
        for (const day of dayTotals.keys()) {
          const value = day.slice(0, 7)
          if (!monthsWithData.includes(value)) monthsWithData.push(value)
        }
        monthsWithData.sort()

        let resolvedMonth = month
        let backScan = false
        if (month >= nowMonth) {
          let cursor = month
          for (let i = 0; i < 24 && tokensOfMonth(cursor) <= 0; i += 1) {
            const previous = shiftMonth(cursor, -1)
            if (previous < '2000-01') break
            cursor = previous
          }
          backScan = cursor !== month
          resolvedMonth = cursor
        }

        // 查看月:逐日总量(兼容旧 client)+ 输入/输出/缓存分项(悬浮弹窗)
        const days = {}
        const detailDays = {}
        let total = 0
        for (const [day, agg] of dayTotals) {
          if (!day.startsWith(`${resolvedMonth}-`)) continue
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
          if (!day.startsWith(`${resolvedMonth}-`)) continue
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
          month: resolvedMonth,
          requestedMonth: month,
          backScan,
          monthsWithData,
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
          // 汇总标记 + 增量:scannedAt 是本轮汇总完成的时刻,previousScannedAt
          // 是上一轮;deltaTokens 是「上一轮 → 本轮」新增的 token(非负)。
          scannedAt: scanAt,
          previousScannedAt: previousScanAt,
          // 本次请求真的重扫过才报增量;被节流跳过时报 0(不是「没变化」,
          // 而是「本轮没有新的汇总」)。
          deltaTokens: lastScanFresh ? scanDeltaTokens : 0,
          scanFresh: lastScanFresh,
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
          // 官方表只列现行 api 名(峰谷已在 peak 里,这里给设置页看基准价);
          // 历史别名在响应末尾单独列出,避免设置页出现一堆同价条目。
          const aliases = {}
          for (const [alias, canonical] of OFFICIAL_PRICE_ALIASES) {
            aliases[alias] = canonical
          }
          for (const [id, price] of Object.entries(OFFICIAL_PRICES)) {
            catalog.push({
              key: id,
              name: id,
              source: 'official',
              provider: OFFICIAL_PROVIDER,
              inputPerM: price.inputPerM,
              outputPerM: price.outputPerM,
              cachePerM: price.cachePerM,
              peak: peakHour(price, price),
            })
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
            // 历史模型名 → 现行官方条目(设置页展示用)。
            aliases,
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
