/**
 * dizzy-dsh-usage-card 插件(Host 端)
 *
 * 职责:聚合本地会话日志(~/.dsh/sessions)的每日 token 用量,
 *      提供 GET /dizzy/usage?month=YYYY-MM —— 用量视图的数据源。
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
 * 文件是「多帧 zstd 拼接」:每次 append 写一帧。帧边界按 zstd 规范
 * 遍历 block header 得到(不依赖 FCS 字段),逻辑复刻自
 * @deepseek-ai/dsh-session-persistence-jsonl 的 scanZstdFrames;
 * 逐帧用 node:zlib 的 zstdDecompressSync 解压(本机 Node ≥ 22.14)。
 * 插件不能 import 该包(profile 的 node_modules 里没有 @deepseek-ai/*)。
 *
 * Client 半区见 client.js:会话视图「用量」Tab(conversation.view)。
 */
import { readdir, stat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = 4247762216
const SESSION_ROOT = join(homedir(), '.dsh', 'sessions')
const fileStates = new Map() // path -> { key, days: Map<'YYYY-MM-DD', DayAgg> }
let dayTotals = new Map()    // 'YYYY-MM-DD' -> DayAgg
let scanAt = 0
let scanErrors = 0

// DayAgg = { input, output, cacheRead, models: Map<modelKey, {input, output, cacheRead}> }
function emptyAgg() {
  return { input: 0, output: 0, cacheRead: 0, models: new Map() }
}

function addUsage(agg, modelKey, usage) {
  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  const cacheRead = usage.cacheReadTokens ?? 0
  agg.input += input
  agg.output += output
  agg.cacheRead += cacheRead
  let m = agg.models.get(modelKey)
  if (m === undefined) {
    m = { input: 0, output: 0, cacheRead: 0 }
    agg.models.set(modelKey, m)
  }
  m.input += input
  m.output += output
  m.cacheRead += cacheRead
}

function mergeAgg(target, source) {
  target.input += source.input
  target.output += source.output
  target.cacheRead += source.cacheRead
  for (const [key, value] of source.models) {
    let m = target.models.get(key)
    if (m === undefined) {
      m = { input: 0, output: 0, cacheRead: 0 }
      target.models.set(key, m)
    }
    m.input += value.input
    m.output += value.output
    m.cacheRead += value.cacheRead
  }
}

function aggTotal(agg) {
  return agg.input + agg.output + agg.cacheRead
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
    addUsage(agg, modelKeyOf(event.data), usage)
  }
  return days
}

// 增量扫描:只重读 (mtime, size) 变化的文件,其余沿用缓存的分日结果
async function refreshUsage() {
  if (Date.now() - scanAt < 30000) return
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
    for (const area of await readdir(SESSION_ROOT)) {
      const areaPath = join(SESSION_ROOT, area)
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
    // 顶层失败(如 SESSION_ROOT 不可读):dayTotals 保留上次良好快照,
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

export default {
  name: 'dizzy-dsh-usage-card',
  inject: ['webServer'],
  apply(ctx) {
    const stopUsageRoute = ctx.webServer.register({
      kind: 'exact',
      path: '/dizzy/usage',
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://dizzy.local')
        const month = url.searchParams.get('month') ?? ''
        if (!/^\d{4}-\d{2}$/.test(month)) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'month must be YYYY-MM' }))
          return
        }
        await refreshUsage()

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
          })
        }
        const todayAgg = dayTotals.get(localDayKey(now))
        const models = {}
        if (todayAgg !== undefined) {
          for (const [key, value] of todayAgg.models) {
            models[key] = {
              input: value.input,
              output: value.output,
              cacheRead: value.cacheRead,
              total: value.input + value.output + value.cacheRead,
            }
          }
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
            today: { date: localDayKey(now), models },
          },
          scannedAt: scanAt,
          errors: scanErrors,
        }))
      },
    })

    return () => {
      stopUsageRoute()
    }
  },
}
