/**
 * dizzy-dsh 主插件(Host 端)
 *
 * 职责:
 *   1. 每分钟通过 DeepSeek 官方余额 API 刷新 CNY 余额(credentials 取 DEEPSEEK_API_KEY)
 *   2. 注册 webServer 路由 GET /dizzy/balance —— Client 半区通过同源 fetch 读取余额
 *      (浏览器拿不到 API key,数据必须经 host 中转)
 *   3. 注册模型可见工具 balance_check,agent 可随时查询余额
 *   4. 注入系统提示词 section(prompts/agent-instructions.md,源自 DSH 的 AGENTS.md)
 *   5. 聚合本地会话日志(~/.dsh/sessions)的每日 token 用量,
 *      提供 GET /dizzy/usage?month=YYYY-MM —— 用量卡片的数据源
 *
 * 本插件经 dsh plugin add 安装为 bundle 层,运行在完整 Node 环境:
 *   - 直接用全局 fetch 调 API(不需要 curl/subprocess 绕行)
 *   - 文件随仓库走,cordis.patch.yml 里 name: 'dizzy-dsh'
 *   - 重启后依然生效(不是会话内动态插件)
 *
 * Client 半区见 client.js:输入栏余额徽章 + 会话区左上角本月用量卡片。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readdir, stat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const PROMPT_FILE = fileURLToPath(new URL('./prompts/agent-instructions.md', import.meta.url))

export default {
  name: 'dizzy-dsh',
  inject: ['credentials', 'timer', 'tools', 'webServer', 'systemPrompt'],
  apply(ctx) {
    let cache = {
      balanceCny: null,
      isAvailable: false,
      error: null,
      at: 0,
    }

    // ── 系统提示词注入 ────────────────────────────────────────────────
    // 每次模型步骤组装时重新读取 prompts/agent-instructions.md,
    // 用户编辑文件后无需重启即可生效。order -50 在 persona(0)之前渲染,
    // 与 harness 身份(-100)之后。
    const disposePrompt = ctx.systemPrompt.section({
      name: 'dizzy-dsh:agent-instructions',
      order: -50,
      text: () => {
        try {
          return readFileSync(PROMPT_FILE, 'utf8')
        } catch (err) {
          return 'Dizzy-DSH: 无法读取 prompts/agent-instructions.md(' + String(err.code ?? err) + ')'
        }
      },
    })

    const refresh = async () => {
      try {
        const resolved = await ctx.credentials.resolve('DEEPSEEK_API_KEY')
        if (resolved === undefined) {
          cache = { balanceCny: null, isAvailable: false, error: '未配置 DEEPSEEK_API_KEY', at: Date.now() }
          return
        }
        const response = await fetch('https://api.deepseek.com/user/balance', {
          headers: { authorization: `Bearer ${resolved.value}` },
          signal: AbortSignal.timeout(15000),
        })
        if (!response.ok) {
          cache = { balanceCny: null, isAvailable: false, error: `HTTP ${response.status}`, at: Date.now() }
          return
        }
        const data = await response.json()
        const cny = (data.balance_infos ?? []).find((b) => b.currency === 'CNY')
        cache = {
          balanceCny: cny === undefined ? null : Number(cny.total_balance),
          isAvailable: data.is_available === true,
          error: null,
          at: Date.now(),
        }
      } catch (err) {
        cache = {
          balanceCny: null,
          isAvailable: false,
          error: String(err === null || err === undefined ? '' : err.message ?? err),
          at: Date.now(),
        }
      }
    }

    // 立即刷新一次,之后每分钟一次
    refresh()
    const stopTimer = ctx.interval(refresh, 60000)

    // ── 本月用量聚合(本地会话日志)───────────────────────────────────
    // DeepSeek 官方 API 没有按天用量接口,唯一官方数据源是每次响应的
    // usage 字段 —— DSH 已把它落进会话日志(session.jsonl.zstd 的
    // assistant/message 事件 data.usage),这里直接聚合本地日志。
    //
    // 文件是「多帧 zstd 拼接」:每次 append 写一帧。帧边界按 zstd 规范
    // 遍历 block header 得到(不依赖 FCS 字段),逻辑复刻自
    // @deepseek-ai/dsh-session-persistence-jsonl 的 scanZstdFrames;
    // 逐帧用 node:zlib 的 zstdDecompressSync 解压(本机 Node ≥ 22.14)。
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

    // Client 半区数据源:GET /dizzy/balance → { balanceCny, isAvailable, error, at }
    const stopRoute = ctx.webServer.register({
      kind: 'exact',
      path: '/dizzy/balance',
      handler: async (req, res) => {
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(JSON.stringify(cache))
      },
    })

    // 模型可见工具
    const disposeTool = ctx.tools.register({
      name: 'balance_check',
      description: '查询当前 DeepSeek 官方账户的余额(人民币)。',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render(_args, value) {
          return [{ type: 'text', text: String(value) }]
        },
      },
      async execute() {
        const cny = cache.balanceCny
        if (cache.error) return `余额查询失败: ${cache.error}`
        if (cny === null) return '余额暂未获取到,请稍后重试'
        return `DeepSeek 账户余额: ¥${cny.toFixed(2)}(更新于 ${new Date(cache.at).toLocaleTimeString()})`
      },
    })

    return () => {
      disposePrompt()
      stopTimer()
      stopRoute()
      stopUsageRoute()
      disposeTool()
    }
  },
}
