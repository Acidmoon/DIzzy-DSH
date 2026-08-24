import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, openSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  BUNDLED_GATEWAY_DIR,
  BUNDLED_KNOWLEDGE_DIR,
  ensureEngineDeps,
  nodeBin,
  resolveEngineDir,
  sidecarBaseEnv,
} from '../scripts/ensure-engine-deps.mjs'

async function health(url, timeoutMs = 2000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

/** 健康检查 /health。spawn ENOENT 走 error；tsx 的非致命 error 不会把 exitCode 置上。 */
function waitHealthOrExit(url, child, timeoutMs) {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      child.off('exit', onExit)
      child.off('error', onError)
      resolve(ok)
    }
    const onExit = () => finish(false)
    const onError = () => finish(false)
    child.once('exit', onExit)
    child.once('error', onError)
    const deadline = Date.now() + timeoutMs
    const tick = async () => {
      while (!done && Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) {
          finish(false)
          return
        }
        if (await health(url)) {
          finish(true)
          return
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      if (!done) {
        const alive = child.exitCode === null && child.signalCode === null
        finish(alive && await health(url))
      }
    }
    void tick()
  })
}

function makeSpawner({ cwd, entry, env, logPath }) {
  const logFd = openSync(logPath, 'a')
  const child = spawn(nodeBin(), ['--import', 'tsx', entry], {
    cwd,
    env: { ...sidecarBaseEnv(), ...env },
    stdio: ['ignore', logFd, logFd],
  })
  child.on('error', (err) => {
    try { appendFileSync(logPath, `[spawn-error] ${err?.message ?? err}\n`) } catch {}
  })
  return { child, logFd }
}

function killChild(child, logFd) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  try { child.kill('SIGTERM') } catch {}
  const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 5000)
  child.once('exit', () => clearTimeout(timer))
  try { closeSync(logFd) } catch {}
}

async function resolveGatewayApiKey(ctx, cfg) {
  const name = cfg?.server?.credentialName
  if (name) {
    try {
      const resolved = await ctx.credentials.resolve(name)
      const value = resolved?.value
      if (typeof value === 'string' && value.length > 0) return value
    } catch {
      // 回退到 server.apiKey
    }
  }
  const fallback = cfg?.server?.apiKey
  return typeof fallback === 'string' && fallback.length > 0 ? fallback : 'local'
}

/**
 * 把 MemoryCore Gateway 和 MemoryKnowledge 作为插件子进程托管：
 * - 默认 cwd 为包内 engines/（换机即用，不依赖开发机绝对路径）；
 * - 端口上已有服务则只借用（不 kill，不负责生命周期）；
 * - 否则由插件 spawn，并在插件卸载时 SIGTERM 回收。
 */
export function attachSidecars(ctx, { current, warn }) {
  const owned = []
  const logDir = join(homedir(), '.dsh', 'logs')
  try { mkdirSync(logDir, { recursive: true }) } catch {}

  const start = () => {
    const cfg = current()?.runtime ?? {}
    if (cfg.manageSidecars === false) return

    const llmKeyPromise = ctx.credentials
      .resolve('DEEPSEEK_API_KEY')
      .then((r) => r?.value)
      .catch(() => undefined)

    const gatewayKeyPromise = resolveGatewayApiKey(ctx, current())

    const ensure = async (kind) => {
      const port = kind === 'gateway' ? (cfg.gatewayPort ?? 8420) : (cfg.knowledgePort ?? 8421)
      const url = `http://127.0.0.1:${port}/health`
      if (await health(url)) return

      const bundled = kind === 'gateway' ? BUNDLED_GATEWAY_DIR : BUNDLED_KNOWLEDGE_DIR
      const configured = kind === 'gateway' ? cfg.gatewayDir : cfg.knowledgeDir
      const cwd = resolveEngineDir(configured, bundled)
      const entryRel = kind === 'gateway' ? 'src/gateway/server.ts' : 'src/server.ts'
      const entry = join(cwd, entryRel)
      const logPath = join(logDir, kind === 'gateway' ? 'tdai-gateway.log' : 'tdai-knowledge.log')

      if (!existsSync(entry)) {
        warn(`找不到 ${kind} 入口 ${entry}（请确认合集含 engines/ 快照）`)
        return
      }
      if (!ensureEngineDeps(cwd, { log: warn })) {
        warn(`${kind} 依赖未就绪，跳过 sidecar`)
        return
      }

      const key = await llmKeyPromise
      if (kind === 'gateway' && !key) {
        warn('未找到 DEEPSEEK_API_KEY，跳过 MemoryCore sidecar（L1 提取需要 LLM）')
        return
      }

      const home = homedir()
      const gatewayApiKey = await gatewayKeyPromise
      const env = kind === 'gateway'
        ? {
            TDAI_GATEWAY_CONFIG: join(cwd, 'tdai-gateway.standalone.yaml'),
            TDAI_GATEWAY_PORT: String(port),
            TDAI_GATEWAY_HOST: '127.0.0.1',
            TDAI_GATEWAY_API_KEY: gatewayApiKey,
            TDAI_LLM_BASE_URL: cfg.llmBaseUrl ?? 'https://api.deepseek.com/v1',
            TDAI_LLM_API_KEY: key,
            TDAI_LLM_MODEL: cfg.llmModel ?? 'deepseek-chat',
            TDAI_LLM_PROTOCOL: 'openai',
          }
        : {
            HOST: '127.0.0.1',
            PORT: String(port),
            API_PREFIX: '/v3',
            LOG_LEVEL: 'info',
            KNOWLEDGE_DATA_DIR: join(home, '.memory-tencentdb', 'knowledge'),
            KNOWLEDGE_DB_PATH: join(home, '.memory-tencentdb', 'knowledge', 'knowledge.db'),
            KNOWLEDGE_PUBLIC_BASE_URL: `http://127.0.0.1:${port}/v3`,
            TMC_CALLBACK_URL: '',
            LLM_MODE: 'custom',
            LLM_PROVIDER: 'openai',
            LLM_BASE_URL: cfg.llmBaseUrl ?? 'https://api.deepseek.com/v1',
            LLM_API_KEY: key ?? '',
            LLM_MODEL: cfg.llmModel ?? 'deepseek-chat',
            LLM_MAX_TOKENS: String(cfg.llmMaxTokens ?? 8192),
            LLM_TIMEOUT_MS: '180000',
            NODE_ENV: 'development',
          }

      const handle = makeSpawner({ cwd, entry, env, logPath })
      owned.push(handle)
      const ok = await waitHealthOrExit(url, handle.child, 60000)
      const label = kind === 'gateway' ? 'MemoryCore Gateway' : 'MemoryKnowledge'
      warn(ok ? `${label} 已由插件拉起（:${port}）` : `${label} 启动失败（:${port}），日志 ${logPath}`)
    }

    void ensure('gateway')
    if (current()?.knowledge?.enabled !== false) void ensure('knowledge')
  }

  start()

  return () => {
    for (const handle of owned.splice(0)) {
      try { killChild(handle.child, handle.logFd) } catch {}
    }
  }
}
