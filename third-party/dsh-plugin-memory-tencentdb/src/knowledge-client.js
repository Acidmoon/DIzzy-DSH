/** MemoryKnowledge（Wiki + CodeGraph）HTTP 客户端。 */
export class KnowledgeClient {
  constructor(cfg = {}) {
    this.base = (cfg.url ?? 'http://127.0.0.1:8421').replace(/\/+$/, '')
    this.serviceId = cfg.serviceId ?? 'default'
    this.timeoutMs = cfg.timeoutMs ?? 30000
  }

  async post(path, body = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetch(`${this.base}/v3${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tdai-service-id': this.serviceId,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const text = await res.text()
      let envelope
      try { envelope = text ? JSON.parse(text) : {} } catch { envelope = { code: res.status, message: text.slice(0, 200) } }
      if (!res.ok) throw new Error(`Knowledge HTTP ${res.status}: ${envelope.message ?? text.slice(0, 200)}`)
      if (envelope.code !== 0) throw new Error(`Knowledge code ${envelope.code}: ${envelope.message ?? 'unknown'}`)
      return envelope.data ?? null
    } finally {
      clearTimeout(timer)
    }
  }
}

export function makeKnowledgeClient(current, warn) {
  let cached = null
  let fingerprint = ''
  return async () => {
    const cfg = current()?.knowledge ?? {}
    if (!cfg.enabled) return null
    const fp = JSON.stringify([cfg.url, cfg.serviceId, cfg.timeoutMs])
    if (cached && fp === fingerprint) return cached
    cached = new KnowledgeClient(cfg)
    fingerprint = fp
    return cached
  }
}
