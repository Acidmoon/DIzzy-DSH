/**
 * usage-card 记账口径核对(独立于插件实现,直接读真实会话日志)
 *
 * 目的:证明 dizzy-dsh-usage-card 的 token 聚合与 DSH 内核 token-meter 的
 * 折叠规则一致。插件按「会话日志文件」聚合,官方 tokenUsage 投影也按会话
 * 折叠,所以两边必须逐文件独立 fold(把所有日志串成一条流会得到假差异)。
 *
 * 规则(0.1.5-rc.1 实测,源码 dsh-token-meter/lib/index.js):
 *   - 采样:`assistant/message.usage`,或 assistant/attempt 的 stream 里最后
 *     一个 usage chunk(`lastAssistantStreamChunk`)。本机日志只有前者。
 *   - 折叠:同一 turn/step 的样本按「后到覆盖」结算(addReplacing);
 *     相同桶值直接去重;`llm/retry-started` 清掉该 turn/step 的槽位,
 *     让重试的两次尝试累加。
 *
 * 用法:
 *   node scripts/verify-usage-accounting.mjs            # 默认核对当月
 *   node scripts/verify-usage-accounting.mjs 2026-08    # 指定 YYYY-MM
 *
 * 退出码:两边总量一致 → 0,否则 1。
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const ROOT = process.env.DIZZY_SESSIONS_ROOT ?? join(process.env.USERPROFILE ?? '', '.dsh', 'sessions')
const ZSTD_MAGIC = 4247762216

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

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, out)
      continue
    }
    // 日志名随内核版本变:session.jsonl.zstd → session.v3.jsonl.zstd(0.1.5)。
    // 按后缀认,显式排除备份/单帧修复产物。
    if (!entry.name.startsWith('session') || !entry.name.includes('.jsonl')) continue
    if (entry.name.endsWith('.bak') || entry.name.includes('.singleframe-') || entry.name.endsWith('.old')) continue
    out.push(full)
  }
  return out
}

/** 归一为 {input,output,cacheRead};无有效数值返回 null(等价 usageBuckets)。 */
function bucketsOf(usage) {
  if (usage === null || typeof usage !== 'object') return null
  const input = usage.inputTokens ?? usage.uncachedInputTokens
  const output = usage.outputTokens
  if (typeof input !== 'number' || typeof output !== 'number') return null
  return { input, output, cacheRead: usage.cacheReadTokens ?? 0 }
}

const sumOf = (u) => u.input + u.output + u.cacheRead
const sameBuckets = (a, b) => a !== null && b !== null && a.input === b.input && a.output === b.output && a.cacheRead === b.cacheRead

/** 官方 usageOf 的第二条来源:assistant/attempt 的 stream 里最后一个 usage chunk。 */
function lastStreamUsage(stream) {
  if (stream === null || stream === undefined) return undefined
  const chunks = Array.isArray(stream) ? stream : (Array.isArray(stream.chunks) ? stream.chunks : undefined)
  if (chunks === undefined) return undefined
  for (let i = chunks.length - 1; i >= 0; i -= 1) {
    const chunk = chunks[i]
    if (chunk !== null && typeof chunk === 'object' && chunk.type === 'usage') return chunk.usage
  }
  return undefined
}

const month = process.argv[2] ?? new Date().toISOString().slice(0, 7)
const files = await walk(ROOT)

let decodeFailures = 0
let officialTotal = 0
let pluginTotal = 0
let retryEvents = 0
let chunkUsageEvents = 0
let messageUsageEvents = 0
let dedupedSamples = 0
let missingTurnStep = 0
const officialPerDay = new Map()
const pluginPerDay = new Map()

for (const file of files) {
  let text
  try {
    const buffer = await readFile(file)
    text = file.endsWith('.jsonl')
      ? buffer.toString('utf8')
      : scanZstdFrames(buffer).map((f) => zstdDecompressSync(buffer.subarray(f.start, f.end))).join('')
  } catch (error) {
    decodeFailures += 1
    console.error(`DECODE FAIL ${file}: ${error.message}`)
    continue
  }

  let anon = 0
  let fileOfficial = 0
  let last = null
  const byStep = new Map()

  for (const line of text.split('\n')) {
    if (line === '') continue
    let event
    try { event = JSON.parse(line) } catch { continue }
    const data = event.data
    if (data === null || data === undefined) continue
    const { turn, step } = data
    const hasKey = Number.isFinite(turn) && Number.isFinite(step)
    if (!hasKey) missingTurnStep += 1
    const stepKey = hasKey ? `${turn}/${step}` : `anon:${anon++}`

    // ── 官方 token-meter:按会话 fold,last-wins,retry 清槽 ──────────────
    if (event.type === 'llm/retry-started') {
      retryEvents += 1
      if (last !== null && last.turn === turn && last.step === step) last = null
      if (hasKey) byStep.delete(stepKey)
      continue
    }
    let sample
    if (event.type === 'assistant/message' && data.usage !== undefined) sample = data.usage
    else if (event.type === 'assistant/attempt') sample = lastStreamUsage(data.stream)
    if (sample !== undefined) {
      const buckets = bucketsOf(sample)
      if (buckets !== null) {
        const prev = last !== null && last.turn === turn && last.step === step ? last.buckets : null
        if (sameBuckets(prev, buckets)) dedupedSamples += 1
        else {
          fileOfficial += sumOf(buckets) - (prev === null ? 0 : sumOf(prev))
          last = { turn, step, buckets }
          if (prev === null) {
            const day = dayKey(event.time)
            if (day !== null) officialPerDay.set(day, (officialPerDay.get(day) ?? 0) + sumOf(buckets))
          }
        }
      }
    }

    // ── 插件规则:同 turn/step 末次采样胜出 ─────────────────────────────
    if (event.type === 'assistant/chunk' && data.chunk !== null && typeof data.chunk === 'object' && data.chunk.type === 'usage') {
      chunkUsageEvents += 1
      const buckets = bucketsOf(data.chunk.usage)
      if (buckets !== null) {
        byStep.set(stepKey, { buckets, time: event.time ?? byStep.get(stepKey)?.time })
      }
    } else if (event.type === 'assistant/message' && data.usage !== undefined) {
      messageUsageEvents += 1
      const buckets = bucketsOf(data.usage)
      if (buckets !== null) {
        byStep.set(stepKey, { buckets, time: event.time ?? byStep.get(stepKey)?.time })
      }
    }
  }

  officialTotal += fileOfficial
  for (const rec of byStep.values()) {
    pluginTotal += sumOf(rec.buckets)
    const day = dayKey(rec.time)
    if (day !== null) pluginPerDay.set(day, (pluginPerDay.get(day) ?? 0) + sumOf(rec.buckets))
  }
}

function dayKey(time) {
  if (time === undefined || time === null) return null
  // 日志里 event.time 是毫秒数字(0.1.5-rc.1 实测);字符串 ISO 也接受。
  const date = time instanceof Date ? time : new Date(typeof time === 'number' ? time : String(time))
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const monthDays = {}
for (const [day, value] of [...pluginPerDay.entries()].sort()) if (day.startsWith(month)) monthDays[day] = value

const ok = officialTotal === pluginTotal
console.log(JSON.stringify({
  sessionsRoot: ROOT,
  month,
  files: files.length,
  decodeFailures,
  chunkUsageEvents,
  messageUsageEvents,
  dedupedSamples,
  retryEvents,
  eventsLackingTurnStep: missingTurnStep,
  officialTokenMeterTotal: officialTotal,
  pluginRuleTotal: pluginTotal,
  divergence: pluginTotal - officialTotal,
  monthTotal: Object.values(monthDays).reduce((acc, v) => acc + v, 0),
  monthDays,
  verdict: ok ? 'IDENTICAL — 插件口径与内核 token-meter 一致' : 'DIVERGENT — 需要修聚合规则',
}, null, 2))

process.exit(ok ? 0 : 1)
