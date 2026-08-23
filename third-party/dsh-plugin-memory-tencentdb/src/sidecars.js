import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, openSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const NODE_BIN = '/usr/local/node/bin/node'

async function health(url, timeoutMs = 2000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

async function waitHealth(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await health(url)) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

function makeSpawner({ name, cwd, entry, env, logPath }) {
  const logFd = openSync(logPath, 'a')
  const child = spawn(NODE_BIN, ['--import', 'tsx', entry], {
    cwd,
    env: { ...process.env, ...env },
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

/**
 * 把 MemoryCore Gateway 和 MemoryKnowledge 作为插件子进程托管：
 * - 端口上已有服务则只借用（不 kill，不负责生命周期）；
 * - 否则由插件 spawn，并在插件卸载时 SIGTERM 回收。
 * 这样 DSH 启动/退出 = 记忆与知识服务一起启动/退出。
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

    const ensure = async (kind) => {
      const key = await llmKeyPromise
      if (!key) {
        warn(`未找到 DEEPSEEK_API_KEY，跳过 ${kind} sidecar（提取/入库功能不可用）`)
        return
      }
      const port = kind === 'gateway' ? (cfg.gatewayPort ?? 8420) : (cfg.knowledgePort ?? 8421)
      const url = `http://127.0.0.1:${port}`
      if (await health(url)) return // 已有实例，借用

      const home = homedir()
      if (kind === 'gateway') {
        const handle = makeSpawner({
          name: 'gateway',
          cwd: cfg.gatewayDir || '/home/Acidmoon/Coding/TencentDB-Agent-Memory/MemoryCore',
          entry: 'src/gateway/server.ts',
          logPath: join(logDir, 'tdai-gateway.log'),
          env: {
            TDAI_GATEWAY_CONFIG: join(cfg.gatewayDir || '/home/Acidmoon/Coding/TencentDB-Agent-Memory/MemoryCore', 'tdai-gateway.standalone.yaml'),
            TDAI_GATEWAY_PORT: String(port),
            TDAI_LLM_BASE_URL: cfg.llmBaseUrl ?? 'https://api.deepseek.com/v1',
            TDAI_LLM_API_KEY: key,
            TDAI_LLM_MODEL: cfg.llmModel ?? 'deepseek-chat',
            TDAI_LLM_PROTOCOL: 'openai',
          },
        })
        owned.push(handle)
        const ok = await waitHealth(url, 60000)
        warn(ok ? `MemoryCore Gateway 已由插件拉起（:${port}）` : `MemoryCore Gateway 启动超时（:${port}），日志 ${join(logDir, 'tdai-gateway.log')}`)
      } else {
        const dir = cfg.knowledgeDir || '/home/Acidmoon/Coding/TencentDB-Agent-Memory/MemoryKnowledge'
        const handle = makeSpawner({
          name: 'knowledge',
          cwd: dir,
          entry: 'src/server.ts',
          logPath: join(logDir, 'tdai-knowledge.log'),
          env: {
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
            LLM_API_KEY: key,
            LLM_MODEL: cfg.llmModel ?? 'deepseek-chat',
            LLM_MAX_TOKENS: String(cfg.llmMaxTokens ?? 8192),
            LLM_TIMEOUT_MS: '180000',
          },
        })
        owned.push(handle)
        const ok = await waitHealth(url, 60000)
        warn(ok ? `MemoryKnowledge 已由插件拉起（:${port}）` : `MemoryKnowledge 启动超时（:${port}），日志 ${join(logDir, 'tdai-knowledge.log')}`)
      }
    }

    void ensure('gateway')
    void ensure('knowledge')
  }

  start()

  return () => {
    for (const handle of owned.splice(0)) {
      try { killChild(handle.child, handle.logFd) } catch {}
    }
  }
}
