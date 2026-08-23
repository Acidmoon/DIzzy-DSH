import { resolvePersonalIdentity } from './client.js'

const jsonRoute = (res, payload, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

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

function readJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

/**
 * 设置页同源 API：浏览器 → 本插件 host → MemoryCore / MemoryKnowledge。
 * 这样 Web UI 的 settings.section 不需要跨域访问 8420/8421。
 */
export function attachSettingsApi(ctx, { current, getClient, getKnowledgeClient, warn }) {
  const guard = (handler) => async (req, res) => {
    if (!isSameOriginRequest(req)) {
      jsonRoute(res, { ok: false, error: 'forbidden: cross-site request' }, 403)
      return
    }
    try {
      await handler(req, res)
    } catch (err) {
      warn(`settings api error: ${String(err?.message ?? err)}`)
      jsonRoute(res, { ok: false, error: String(err?.message ?? err) }, 500)
    }
  }

  const memoryOverview = async () => {
    const client = await getClient()
    const identity = resolvePersonalIdentity(current()?.server ?? {})
    const [conv, atomic, scene, core] = await Promise.allSettled([
      client.countConversation({}),
      client.countAtomic({}),
      client.countScenario({}),
      client.readCore(),
    ])
    return {
      connected: true,
      identity,
      counts: {
        L0: conv.status === 'fulfilled' ? conv.value.total : null,
        L1: atomic.status === 'fulfilled' ? atomic.value.total : null,
        L2: scene.status === 'fulfilled' ? scene.value.total : null,
      },
      persona_updated_at: core.status === 'fulfilled' ? core.value.updated_at : null,
    }
  }

  const knowledgeOverview = async () => {
    const kc = await getKnowledgeClient()
    if (!kc) return { enabled: false }
    const teamId = resolvePersonalIdentity(current()?.server ?? {}).teamId
    let health = null
    let wikis = null
    let graphs = null
    try {
      const res = await fetch(`${kc.base}/health`, { signal: AbortSignal.timeout(kc.timeoutMs) })
      health = res.ok ? await res.json() : { error: `HTTP ${res.status}` }
    } catch (err) {
      health = { error: String(err?.message ?? err) }
    }
    if (health && !health.error) {
      const [w, g] = await Promise.allSettled([
        kc.post('/wiki/list', { team_id: teamId, limit: 50 }),
        kc.post('/code-graph/list', { team_id: teamId, limit: 50 }),
      ])
      wikis = w.status === 'fulfilled' ? w.value : { error: String(w.reason?.message ?? w.reason) }
      graphs = g.status === 'fulfilled' ? g.value : { error: String(g.reason?.message ?? g.reason) }
    }
    return { enabled: true, health, wikis, graphs }
  }

  const webServer = ctx.get('webServer')
  if (!webServer) return () => {} // headless 等无 Web UI 的 profile 没有该服务

  const disposes = []

  // ── 记忆分层管理 CRUD（供设置页各栏目使用）──
  const registerRoute = (path, handler) => {
    disposes.push(webServer.register({ kind: 'exact', path, handler: guard(handler) }))
  }

  // MemoryCore v3 的 limit 上限是 100；这里按页拉全量，避免一次性大 limit 报 400。
  const fetchAll = async (query, pick) => {
    const limit = 100
    const out = []
    let offset = 0
    let total = 0
    for (let page = 0; page < 20; page += 1) {
      const data = await query({ limit, offset })
      const items = pick(data) ?? []
      total = data?.total ?? items.length
      out.push(...items)
      if (items.length < limit || offset + items.length >= total) break
      offset += items.length
    }
    return { total, items: out }
  }

  registerRoute('/tdai-memory/l0/list', async (req, res) => {
    if (req.method !== 'GET') return jsonRoute(res, { ok: false, error: 'GET only' }, 405)
    const client = await getClient()
    const data = await fetchAll((p) => client.queryConversation(p), (d) => d?.messages)
    jsonRoute(res, { ok: true, total: data.total, messages: data.items })
  })

  registerRoute('/tdai-memory/l0/delete', async (req, res) => {
    const body = await readJson(req)
    const client = await getClient()
    const ids = Array.isArray(body.message_ids) ? body.message_ids.map(String) : []
    if (ids.length === 0) return jsonRoute(res, { ok: false, error: 'message_ids[] is required' }, 400)
    const data = await client.deleteConversation({ message_ids: ids })
    jsonRoute(res, { ok: true, deleted_count: data?.deleted_count ?? ids.length })
  })

  registerRoute('/tdai-memory/l1/list', async (req, res) => {
    if (req.method !== 'GET') return jsonRoute(res, { ok: false, error: 'GET only' }, 405)
    const client = await getClient()
    const data = await fetchAll((p) => client.queryAtomic(p), (d) => d?.items)
    jsonRoute(res, { ok: true, total: data.total, items: data.items })
  })

  registerRoute('/tdai-memory/l1/update', async (req, res) => {
    const body = await readJson(req)
    if (!body.id || body.content === undefined) return jsonRoute(res, { ok: false, error: 'id and content are required' }, 400)
    const client = await getClient()
    const data = await client.updateAtomic({ id: String(body.id), content: String(body.content), background: body.background ? String(body.background) : undefined })
    jsonRoute(res, { ok: true, data })
  })

  registerRoute('/tdai-memory/l1/delete', async (req, res) => {
    const body = await readJson(req)
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : []
    if (ids.length === 0) return jsonRoute(res, { ok: false, error: 'ids[] is required' }, 400)
    const client = await getClient()
    const data = await client.deleteAtomic({ ids })
    jsonRoute(res, { ok: true, deleted_count: data?.deleted_count ?? ids.length })
  })

  registerRoute('/tdai-memory/l2/list', async (req, res) => {
    if (req.method !== 'GET') return jsonRoute(res, { ok: false, error: 'GET only' }, 405)
    const client = await getClient()
    const data = await client.listScenarios({})
    jsonRoute(res, { ok: true, total: data?.total ?? 0, entries: data?.entries ?? [] })
  })

  registerRoute('/tdai-memory/l2/read', async (req, res) => {
    const body = await readJson(req)
    if (!body.path) return jsonRoute(res, { ok: false, error: 'path is required' }, 400)
    const client = await getClient()
    const file = await client.readScenario({ path: String(body.path) })
    jsonRoute(res, { ok: true, file })
  })

  registerRoute('/tdai-memory/l2/write', async (req, res) => {
    const body = await readJson(req)
    if (!body.path || body.content === undefined) return jsonRoute(res, { ok: false, error: 'path and content are required' }, 400)
    const client = await getClient()
    const data = await client.writeScenario({ path: String(body.path), content: String(body.content), summary: body.summary ? String(body.summary) : undefined })
    jsonRoute(res, { ok: true, data })
  })

  registerRoute('/tdai-memory/l2/delete', async (req, res) => {
    const body = await readJson(req)
    if (!body.path) return jsonRoute(res, { ok: false, error: 'path is required' }, 400)
    const client = await getClient()
    await client.rmScenario({ path: String(body.path) })
    jsonRoute(res, { ok: true })
  })

  registerRoute('/tdai-memory/l3/read', async (req, res) => {
    if (req.method !== 'GET') return jsonRoute(res, { ok: false, error: 'GET only' }, 405)
    const client = await getClient()
    const file = await client.readCore()
    jsonRoute(res, { ok: true, file })
  })

  registerRoute('/tdai-memory/l3/write', async (req, res) => {
    const body = await readJson(req)
    if (body.content === undefined) return jsonRoute(res, { ok: false, error: 'content is required' }, 400)
    const client = await getClient()
    const data = await client.writeCore({ content: String(body.content) })
    jsonRoute(res, { ok: true, data })
  })

  disposes.push(webServer.register({
    kind: 'exact',
    path: '/tdai-memory/overview',
    handler: guard(async (_req, res) => {
      const [memory, knowledge] = await Promise.allSettled([memoryOverview(), knowledgeOverview()])
      jsonRoute(res, {
        ok: true,
        memory: memory.status === 'fulfilled' ? memory.value : { connected: false, error: String(memory.reason?.message ?? memory.reason) },
        knowledge: knowledge.status === 'fulfilled' ? knowledge.value : { enabled: false, error: String(knowledge.reason?.message ?? knowledge.reason) },
      })
    }),
  }))

  disposes.push(webServer.register({
    kind: 'exact',
    path: '/tdai-memory/wiki/create',
    handler: guard(async (req, res) => {
      const body = await readJson(req)
      const kc = await getKnowledgeClient()
      if (!kc) return jsonRoute(res, { ok: false, error: 'Knowledge 服务未启用' }, 400)
      const teamId = resolvePersonalIdentity(current()?.server ?? {}).teamId
      if (!body.name) return jsonRoute(res, { ok: false, error: 'name is required' }, 400)
      const wiki = await kc.post('/wiki/create', { team_id: teamId, name: String(body.name) })
      const doc = body.document
      if (doc && typeof doc === 'object' && doc.content && doc.filename) {
        await kc.post('/wiki/raw/write', {
          team_id: teamId,
          wiki_id: wiki.wiki_id,
          files: [{ filename: String(doc.filename), content: String(doc.content) }],
        })
        await kc.post('/wiki/ingest', { wiki_id: wiki.wiki_id })
      }
      jsonRoute(res, { ok: true, wiki })
    }),
  }))

  disposes.push(webServer.register({
    kind: 'exact',
    path: '/tdai-memory/codegraph/create',
    handler: guard(async (req, res) => {
      const body = await readJson(req)
      const kc = await getKnowledgeClient()
      if (!kc) return jsonRoute(res, { ok: false, error: 'Knowledge 服务未启用' }, 400)
      if (!body.repo_url) return jsonRoute(res, { ok: false, error: 'repo_url is required' }, 400)
      const teamId = resolvePersonalIdentity(current()?.server ?? {}).teamId
      const graph = await kc.post('/code-graph/create', {
        team_id: teamId,
        repo_url: String(body.repo_url),
        branch: body.branch ? String(body.branch) : undefined,
        repo_name: body.repo_name ? String(body.repo_name) : undefined,
      })
      jsonRoute(res, { ok: true, graph })
    }),
  }))

  return () => {
    for (const dispose of disposes.reverse()) {
      try { dispose() } catch { /* noop */ }
    }
  }
}
