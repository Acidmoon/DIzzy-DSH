/**
 * dizzy-dsh-usage-card 插件(Host 端)
 *
 * 职责:聚合本地会话日志(~/.dsh/sessions)的每日 token 用量,
 *      提供 GET /dizzy/usage?month=YYYY-MM —— 用量卡片的数据源。
 *
 * DeepSeek 官方 API 没有按天用量接口,唯一官方数据源是每次响应的
 * usage 字段 —— DSH 已把它落进会话日志(session.jsonl.zstd 的
 * assistant/message 事件 data.usage),这里直接聚合本地日志。
 *
 * 文件是「多帧 zstd 拼接」:每次 append 写一帧。帧边界按 zstd 规范
 * 遍历 block header 得到(不依赖 FCS 字段),逻辑复刻自
 * @deepseek-ai/dsh-session-persistence-jsonl 的 scanZstdFrames;
 * 逐帧用 node:zlib 的 zstdDecompressSync 解压(本机 Node ≥ 22.14)。
 * 插件不能 import 该包(profile 的 node_modules 里没有 @deepseek-ai/*)。
 *
 * Client 半区见 client.js:会话区左上角本月用量卡片。
 */
import { readdir, stat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = 4247762216
const SESSION_ROOT = join(homedir(), '.dsh', 'sessions')
const fileStates = new Map() // path -> { key, days: Map<'YYYY-MM-DD', tokens> }
let dayTotals = new Map()
let scanAt = 0
let scanErrors = 0

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
    const day = new Date(event.time)
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    days.set(key, (days.get(key) ?? 0) + tokens)
  }
  return days
}

// 增量扫描:只重读 (mtime, size) 变化的文件,其余沿用缓存的分日结果
async function refreshUsage() {
  if (Date.now() - scanAt < 30000) return
  const totals = new Map()
  let errors = 0
  const seen = new Set()
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
            for (const [day, tokens] of cached.days) {
              totals.set(day, (totals.get(day) ?? 0) + tokens)
            }
            break
          }
          try {
            const days = await parseSessionFile(file)
            fileStates.set(file, { key, days })
            for (const [day, tokens] of days) {
              totals.set(day, (totals.get(day) ?? 0) + tokens)
            }
          } catch {
            errors += 1
          }
          break
        }
      }
    }
  } catch (err) {
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
        const days = {}
        let total = 0
        for (const [day, tokens] of dayTotals) {
          if (day.startsWith(`${month}-`)) {
            days[day] = tokens
            total += tokens
          }
        }
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(JSON.stringify({ month, days, total, scannedAt: scanAt, errors: scanErrors }))
      },
    })

    return () => {
      stopUsageRoute()
    }
  },
}
