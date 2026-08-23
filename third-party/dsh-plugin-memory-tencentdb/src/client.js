import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MemoryClient } from '@tencentdb-agent-memory/memory-sdk-ts-v2/v3'

/**
 * 惰性创建 MemoryClient：
 * - 每次调用从 current() 读取最新配置（settings 命名空间热更新）。
 * - 支持从 dsh credentials 解析 apiKey（credentialName 非空时优先）。
 * - 配置指纹不变时复用实例；变化时重建。
 */
function readDshAnonymousUserId() {
  try {
    const raw = readFileSync(join(homedir(), '.dsh', '.anonymous-user-id'), 'utf8').trim()
    const clean = raw.replace(/[^a-zA-Z0-9_-]/g, '')
    return clean.length > 0 ? clean.slice(0, 64) : ''
  } catch {
    return ''
  }
}

/** 个人模式：team/agent/user 由 DSH 匿名 id 派生，零配置且跨重启稳定。 */
export function resolvePersonalIdentity(server = {}) {
  const uid = readDshAnonymousUserId()
  if (server.autoIdentity === false || !uid) {
    return {
      teamId: server.teamId ?? 'personal',
      agentId: server.agentId ?? 'personal-agent',
      userId: server.userId ?? 'personal-user',
    }
  }
  return {
    teamId: 'personal',
    agentId: `personal-agent-${uid.slice(0, 8)}`,
    userId: `user-${uid}`,
  }
}

export function makeClientFactory(ctx, current, warn) {
  let cached = null
  let cachedFingerprint = null

  async function resolveApiKey(cfg) {
    const name = cfg?.server?.credentialName
    if (name) {
      try {
        const resolved = await ctx.credentials.resolve(name)
        const value = resolved?.value
        if (typeof value === 'string' && value.length > 0) return value
        warn(`credentials.resolve(${name}) 未返回可用值，回退到 server.apiKey`)
      } catch (err) {
        warn(`credentials.resolve(${name}) 失败（${String(err?.message ?? err)}），回退到 server.apiKey`)
      }
    }
    return cfg?.server?.apiKey || 'local'
  }

  async function getClient() {
    const cfg = current()
    const server = cfg?.server ?? {}
    const identity = resolvePersonalIdentity(server)
    const apiKey = await resolveApiKey(cfg)
    const fingerprint = JSON.stringify([
      server.url ?? 'http://127.0.0.1:8420',
      apiKey,
      server.instanceId ?? 'default',
      identity.teamId,
      identity.agentId,
      identity.userId,
      server.timeoutMs ?? 30000,
      server.rejectUnauthorized !== false,
    ])

    if (cached !== null && cachedFingerprint === fingerprint) return cached

    cached = new MemoryClient({
      endpoint: server.url ?? 'http://127.0.0.1:8420',
      apiKey,
      serviceId: server.instanceId ?? 'default',
      teamId: identity.teamId,
      agentId: identity.agentId,
      userId: identity.userId,
      timeout: server.timeoutMs ?? 30000,
      rejectUnauthorized: server.rejectUnauthorized !== false,
    })
    cachedFingerprint = fingerprint
    return cached
  }

  return { getClient, resolveApiKey }
}

/** 从 exec 上下文中取当前 dsh 会话 id。 */
export function sessionIdOf(exec) {
  const id = exec?.agent?.session?.header?.id ?? exec?.agent?.session?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/** 从 dsh session 对象取会话 id。 */
export function headerSessionIdOf(session) {
  const id = session?.header?.id ?? session?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}
