import { MemoryClient } from '@tencentdb-agent-memory/memory-sdk-ts-v2/v3'
import { attachCapture } from '../src/capture.js'
import { attachProfileInjection } from '../src/profile.js'

const teamId = process.env.TEAM_ID || 'default'
const agentId = process.env.AGENT_ID || 'default'
const userId = process.env.USER_ID || 'default'
const mkClient = () => new MemoryClient({
  endpoint: 'http://127.0.0.1:8420', apiKey: 'local', serviceId: 'default',
  teamId, agentId, userId, timeout: 30000,
})

// ── 1) 自动捕获：DSH 形状的 session/event → 真实 Gateway L0 ──
{
  const listeners = {}
  const ctx = { on: (type, cb) => { (listeners[type] ??= []).push(cb); return () => {} } }
  const config = { capture: { enabled: true, onlyUserSource: true, flushIntervalMs: 100, skipFailedTurns: true } }
  const sent = []
  const disposeCapture = attachCapture(ctx, {
    current: () => config,
    getClient: async () => { const c = mkClient(); return { addConversation: async (p) => { const r = await c.addConversation(p); sent.push(r); return r } } },
    warn: (m) => console.log('[capture-warn]', m),
  })

  const sessionId = `dsh-capture-e2e-${Date.now()}`
  const session = { header: { id: sessionId } }
  const emit = (type, data) => { for (const cb of listeners['session/event'] ?? []) cb(session, { type, data }) }
  emit('user/message', { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '请记住：我们的部署环境是 Kubernetes 1.30，使用 ArgoCD 做 GitOps。' }] })
  emit('assistant/message', { message: { id: 'a1', role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: '已记住：Kubernetes 1.30 + ArgoCD GitOps。' }] } })
  emit('user/message', { id: 'u2', role: 'user', source: { kind: 'plugin', plugin: 'context' }, content: [{ type: 'text', text: '不应入库的 runtime-context' }] })
  emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await new Promise((r) => setTimeout(r, 300))
  disposeCapture()
  console.log('capture submit result:', JSON.stringify(sent))
  const count = await mkClient().countConversation({ session_id: sessionId })
  console.log('capture L0 count via gateway:', JSON.stringify(count))
  if (sent.length !== 1 || sent[0].accepted_ids?.length !== 2 || count.total !== 2) throw new Error('capture e2e mismatch')
}

// ── 2) 画像注入：从真实 Gateway 刷新 L3/L2 → systemPrompt section ──
{
  let sectionText = () => ''
  const ctx = {
    systemPrompt: { section: ({ text }) => { sectionText = text; return () => {} } },
    timeout: (_cb, _ms) => () => {},
  }
  const disposeProfile = attachProfileInjection(ctx, {
    current: () => ({ recall: { enabled: true, refreshIntervalMs: 60000 } }),
    getClient: mkClient,
    warn: (m) => console.log('[profile-warn]', m),
  })
  await new Promise((r) => setTimeout(r, 1500))
  const text = sectionText()
  console.log('--- injected prompt section (first 900 chars) ---')
  console.log(text.slice(0, 900))
  if (!text.includes('tdai_profile_memory') && !text.includes('tdai_scene_navigation')) throw new Error('profile injection e2e mismatch')
  disposeProfile()
}

console.log('PLUGIN-GATEWAY E2E PASSED')
