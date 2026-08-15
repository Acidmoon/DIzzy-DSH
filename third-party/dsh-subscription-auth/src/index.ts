/**
 * dsh-subscription-auth：给 dsh 增加订阅会员（ChatGPT / Claude / Grok / Kimi）的
 * OAuth 登录支持。
 *
 * 本模块是薄的通用驱动：遍历 {@link CHANNELS} 里的渠道定义，为每个渠道注册
 * settings 命名空间（subscription-auth-<id>）、llm provider + adapter，以及配置中心
 * 的登录/注销/状态路由。每个渠道的 OAuth 流程、模型发现与适配器都封装在
 * src/channels/<id>.ts 里（见 src/channel.ts 的 ChannelDefinition 契约）。
 *
 * 登录入口在配置中心的「订阅服务」页（client half）：
 *   GET  /subscription-auth/providers   所有渠道的目录 + 登录状态
 *   POST /subscription-auth/auth/login  启动 OAuth（body: { provider }）
 *   POST /subscription-auth/auth/logout 注销（body: { provider }）
 * @module dsh-subscription-auth
 */
import z from '@deepseek-ai/schemastery'
import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type LlmRuntime from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { AdapterModel } from './adapter.js'
import type {
  ChannelConfig,
  ChannelContext,
  ChannelDefinition,
  ChannelRuntime,
  StoredToken,
} from './channel.js'
import { chatgptChannel } from './channels/chatgpt.js'
import { claudeChannel } from './channels/claude.js'
import { grokChannel } from './channels/grok.js'
import { kimiChannel } from './channels/kimi.js'
import { installProjectionGuard } from './projection-guard.js'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

/**
 * 代理感知:Node 的 fetch(undici)默认不读 HTTPS_PROXY/HTTP_PROXY 环境变量,
 * 会导致 Grok(auth.x.ai)等国外端点在需要代理的网络下连接超时。
 * 这里在模块加载时检测环境变量并安装 EnvHttpProxyAgent 到全局 dispatcher。
 * NO_PROXY 默认包含 localhost/127.0.0.1,回调服务器不受影响。
 */
async function installProxyAgent() {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy
  if (!proxy) return
  try {
    const { EnvHttpProxyAgent, setGlobalDispatcher } = await import('undici')
    setGlobalDispatcher(new EnvHttpProxyAgent())
  } catch {
    // undici 不可用时静默跳过(保持直连行为)
  }
}
void installProxyAgent()

type Context = CordisContext & { llm: LlmRuntime }

export const name = 'dsh-subscription-auth'
export const inject = ['llm']

/** settings 命名空间必须匹配 /^[a-z][a-z0-9-]*$/（单段、无点）。 */
const channelNamespace = (id: string) => settingsNamespace(`subscription-auth-${id}`)

/** 所有订阅渠道（顺序即「订阅服务」页卡片顺序）。 */
export const CHANNELS: ChannelDefinition[] = [
  chatgptChannel,
  claudeChannel,
  grokChannel,
  kimiChannel,
]

/** 日志文件：~/.dsh/tmp/subscription-auth.log（stdout 之外的可检测渠道）。 */
function logLine(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`
  try {
    console.log(line)
    const dir = join(os.homedir(), '.dsh', 'tmp')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'subscription-auth.log'), line + '\n')
  } catch {
    /* 日志写入失败不影响功能 */
  }
}

const catalogModel = z.object({
  id: z.string().required(),
  name: z.string().required(),
  contextWindow: z.number(),
})

function makeConfigSchema(def: ChannelDefinition) {
  return z.object({
    apiBaseURL: z.string().default(def.defaultApiBaseURL),
    redirectPort: z.number().default(def.defaultRedirectPort),
    // 注意：models 不能带 .default()——否则 schemastery 总是用默认值填充，
    // 登录发现的模型列表就永远被默认列表压住。默认值由 resolveOptions 统一处理。
    models: z.array(catalogModel),
    defaultContextWindow: z.number().default(def.defaultContextWindow),
    maxTokens: z.number().default(def.defaultMaxTokens),
    discoveredModels: z.array(catalogModel),
  })
}

/** 模型优先级：用户显式 models → settings 持久化的 discoveredModels → 内存发现结果 → 默认列表。 */
function resolveOptions(
  raw: ChannelConfig,
  discovered: AdapterModel[] | undefined,
  def: ChannelDefinition,
): {
  apiBaseURL: string
  redirectPort: number
  models: AdapterModel[]
  defaultContextWindow: number
  maxTokens: number
} {
  const source = (raw.models !== undefined && raw.models.length > 0)
    ? raw.models
    : (raw.discoveredModels !== undefined && raw.discoveredModels.length > 0)
      ? raw.discoveredModels
      : (discovered !== undefined && discovered.length > 0 ? discovered : def.defaultModels)
  const models = source.map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    ...(m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}),
  }))
  return {
    apiBaseURL: raw.apiBaseURL ?? def.defaultApiBaseURL,
    redirectPort: raw.redirectPort ?? def.defaultRedirectPort,
    models,
    defaultContextWindow: raw.defaultContextWindow ?? def.defaultContextWindow,
    maxTokens: raw.maxTokens ?? def.defaultMaxTokens,
  }
}

interface ChannelState {
  def: ChannelDefinition
  runtime: ChannelRuntime
  channelCtx: ChannelContext
  settingsScope?: { get(): ChannelConfig; update(patch: ChannelConfig): Promise<void> }
  discovered?: { models: AdapterModel[]; at: number }
  /** 模型发现/登录状态变化后刷新注册（announce：让 UI 重新拉取列表）。 */
  replaceRegistration?: () => void
  /** 按登录状态注册/撤销 provider + adapter（false = 从模型列表移除）。 */
  syncRegistration?: (enabled: boolean) => void
}

export function apply(ctx: Context, config: Record<string, unknown> = {}): void {
  installProjectionGuard(ctx, logLine)
  const states = new Map<string, ChannelState>()
  const credentials = () => ctx.get('credentials') as CredentialProvider | undefined
  /** 插件卸载后停止启动门控轮询。 */
  const gateStopped = new Map<string, boolean>()

  // ---------- 每个渠道：构建 ctx + runtime ----------
  for (const def of CHANNELS) {
    const st: ChannelState = {
      def,
      runtime: undefined as unknown as ChannelRuntime,
      channelCtx: undefined as unknown as ChannelContext,
    }
    states.set(def.id, st)

    const ref = credentialRef(def.tokenRefName)
    const readToken = async (): Promise<StoredToken | undefined> => {
      const c = credentials()
      if (!c) return undefined
      const hit = await c.resolve(ref)
      if (!hit) return undefined
      try {
        const t = JSON.parse(hit.value) as StoredToken
        if (t && typeof t.refresh === 'string' && typeof t.access === 'string') return t
      } catch {
        /* corrupt → treat as absent */
      }
      return undefined
    }
    const writeToken = async (token: StoredToken): Promise<void> => {
      const c = credentials()
      if (c) await c.set(ref, JSON.stringify(token))
    }
    const clearToken = async (): Promise<void> => {
      const c = credentials()
      if (c) await c.unset(ref)
    }
    const getRaw = (): ChannelConfig => {
      const s = st.settingsScope
      return s !== undefined ? s.get() : {}
    }

    const channelCtx: ChannelContext = {
      id: def.id,
      tokenRefName: def.tokenRefName,
      options: () => resolveOptions(getRaw(), st.discovered?.models, def),
      getConfig: getRaw,
      updateConfig: async (patch) => {
        const s = st.settingsScope
        if (s !== undefined) await s.update(patch)
      },
      credentials,
      log: logLine,
      notifyModelsChanged: () => {
        try {
          st.replaceRegistration?.()
        } catch (error) {
          logLine(`模型列表刷新通知失败: ${(error as Error)?.message ?? error}`)
        }
      },
      readToken,
      writeToken,
      clearToken,
      afterLogin: () => {
        void discoverAndStore(st)
      },
    }
    st.channelCtx = channelCtx
    st.runtime = def.create(channelCtx)
  }

  // ---------- 官方模型列表发现（通用：拉取 → 缓存 → 持久化 → 通知） ----------
  async function discoverAndStore(st: ChannelState): Promise<void> {
    const token = await st.channelCtx.readToken()
    if (!token || token.expires - Date.now() < 60_000) return
    const found = await st.runtime.discoverModels()
    if (found.length > 0) {
      st.discovered = { models: found, at: Date.now() }
      if (st.settingsScope !== undefined) {
        try {
          await st.settingsScope.update({ discoveredModels: found })
        } catch (error) {
          logLine(`模型列表持久化失败: ${(error as Error)?.message ?? error}`)
        }
      }
      st.channelCtx.notifyModelsChanged()
      logLine(`[${st.def.id}] 已发现 ${found.length} 个订阅模型：${found.map((m) => m.id).join(', ')}`)
    }
  }

  async function logoutChannel(st: ChannelState): Promise<void> {
    await st.runtime.logout()
    st.discovered = undefined
    // 注销后从模型列表移除该提供商（未登录不再占用模型选择器）。
    st.syncRegistration?.(false)
    if (st.settingsScope !== undefined) {
      try {
        await st.settingsScope.update({ discoveredModels: [] })
      } catch (error) {
        logLine(`清除模型列表失败: ${(error as Error)?.message ?? error}`)
      }
    }
    logLine(`[${st.def.id}] 已注销，清除令牌与模型列表`)
  }

  // ---------- settings：每个渠道一个命名空间 ----------
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => {
      const created: { id: string; scope: { get(): ChannelConfig; update(patch: ChannelConfig): Promise<void> } }[] = []
      for (const def of CHANNELS) {
        const base = config[def.id]
        const scope = settingsCtx.settings.register(
          channelNamespace(def.id),
          makeConfigSchema(def),
          { base: base !== undefined && typeof base === 'object' ? (base as ChannelConfig) : {} },
        )
        created.push({ id: def.id, scope })
      }
      for (const { id, scope } of created) {
        const st = states.get(id)
        if (st !== undefined) st.settingsScope = scope
      }
      // settings 就绪后补一次检查：覆盖启动门控完成时 settingsScope 尚未
      // 注册的场景（此时发现结果无法持久化，且注册可能已被竞态误撤）。
      // 已登录 → 确保注册 + 触发一次发现；发现成功会把 discoveredModels
      // 持久化到刚就绪的 settings 命名空间。
      for (const { id } of created) {
        const st = states.get(id)
        if (st === undefined) continue
        void (async () => {
          if (gateStopped.get(id) === true) return
          const token = await st.channelCtx.readToken()
          if (gateStopped.get(id) === true || token === undefined) return
          st.syncRegistration?.(true)
          if (st.discovered === undefined) void discoverAndStore(st)
        })()
      }
      return () => {
        for (const { id } of created) {
          const st = states.get(id)
          if (st !== undefined) st.settingsScope = undefined
        }
      }
    }, 'subscription-auth.settings')
  })

  // ---------- provider + adapter 注册（按登录状态门控） ----------
  // 未登录的渠道不注册 provider/adapter：其模型不会出现在模型选择器里。
  // 登录成功（afterLogin → discoverAndStore → notifyModelsChanged）后注册，
  // 注销时撤销。registerConfigurableProviders / registerAdapter 初次注册
  // 必须至少一个条目，因此先全量注册，再按令牌状态异步收窄（令牌读取是
  // 异步的，且发生在启动早期，UI 目录加载前即可收敛）。
  for (const def of CHANNELS) {
    const st = states.get(def.id)!
    const entry = {
      provider: def.id,
      displayName: def.displayName,
      settingsNs: channelNamespace(def.id),
      settingsPath: [] as string[],
    }
    const providersHandle = ctx.llm.registerConfigurableProviders([entry])
    const adapterHandle = ctx.llm.registerAdapter([def.id], st.runtime.adapter)
    let registered = true
    const sync = (next: boolean, announce: boolean): void => {
      if (next === registered && !announce) return
      providersHandle.replace(next ? [entry] : [])
      adapterHandle.replace(next ? [def.id] : [])
      registered = next
    }
    st.syncRegistration = (next: boolean) => sync(next, false)
    // 模型发现后刷新（announce：即使注册状态没变也发 llm/adapters-updated，
    // 让模型选择器等 UI 重新拉取发现到的模型列表）。
    st.replaceRegistration = () => sync(true, true)
    // 启动门控：credential 服务可能晚于本插件激活（apply 时序竞态），
    // 若尚未就绪则轮询等待（约 60s 上限；插件卸载即停止），再读令牌决定
    // 是否注册 provider + 触发模型发现。否则未就绪时会把已登录的渠道误判
    // 为未登录而撤销注册，导致启动后模型列表为空，直到访问设置页兜底。
    let attempts = 0
    const gate = async (): Promise<void> => {
      if (gateStopped.get(def.id) === true || attempts >= 200) return
      attempts += 1
      if (credentials() === undefined) {
        setTimeout(() => { void gate() }, 300)
        return
      }
      const token = await st.channelCtx.readToken()
      if (gateStopped.get(def.id) === true) return
      const loggedIn = token !== undefined
      sync(loggedIn, false)
      logLine(`[${def.id}] 登录状态: ${loggedIn ? '已登录，注册 provider' : '未登录，不注册 provider'}`)
      // 已登录但内存没有发现结果（如升级后存量会话）：顺手触发一次发现。
      if (loggedIn) void discoverAndStore(st)
    }
    void gate()
  }

  // ---------- 插件停止时中止所有进行中的登录会话与启动门控轮询 ----------
  ctx.effect(() => () => {
    for (const def of CHANNELS) gateStopped.set(def.id, true)
    for (const st of states.values()) st.runtime.cancelLogin()
  }, 'subscription-auth.auth-cleanup')

  // ---------- 配置中心页面用的 HTTP 路由 ----------
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.webServer
    const collectBody = async (req: unknown): Promise<string> => {
      const chunks: Buffer[] = []
      for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk)
      return Buffer.concat(chunks).toString('utf8')
    }
    const send = (
      res: { writeHead(code: number, headers: Record<string, string>): void; end(body: string): void },
      code: number,
      payload: unknown,
    ): void => {
      const body = JSON.stringify(payload)
      res.writeHead(code, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(body)
    }

    const channelCard = async (st: ChannelState): Promise<Record<string, unknown>> => {
      const state = await st.runtime.authStatus()
      // 已登录但还没有发现结果（例如升级插件后已登录的存量会话）：顺手触发一次。
      if (state.status === 'logged-in' && st.discovered === undefined) {
        void discoverAndStore(st)
      }
      const models = resolveOptions(st.channelCtx.getConfig(), st.discovered?.models, st.def)
        .models.map((m) => m.id)
      return {
        id: st.def.id,
        name: st.def.name,
        description: st.def.description,
        models,
        ...(st.discovered !== undefined ? { discoveredAt: st.discovered.at } : {}),
        ...state,
      }
    }

    webCtx.effect(() => webServer.register({
      kind: 'exact',
      path: '/subscription-auth/providers',
      handler: async (req, res) => {
        try {
          if (req.method !== 'GET') {
            send(res, 405, { error: 'method not allowed' })
            return
          }
          const providers: Record<string, unknown>[] = []
          for (const def of CHANNELS) {
            providers.push(await channelCard(states.get(def.id)!))
          }
          send(res, 200, { providers })
        } catch (error) {
          send(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), 'subscription-auth.providers-route')

    webCtx.effect(() => webServer.register({
      kind: 'exact',
      path: '/subscription-auth/auth/login',
      handler: async (req, res) => {
        try {
          if (req.method !== 'POST') {
            send(res, 405, { error: 'method not allowed' })
            return
          }
          let body: Record<string, unknown> = {}
          try {
            body = JSON.parse((await collectBody(req)) || '{}')
          } catch {
            /* 无 body 时按空处理 */
          }
          const id = typeof body.provider === 'string' ? body.provider : ''
          const st = states.get(id)
          if (st === undefined) {
            send(res, 404, { error: `unknown provider: ${id}` })
            return
          }
          const result = await st.runtime.login()
          send(res, 200, result)
        } catch (error) {
          send(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), 'subscription-auth.login-route')

    webCtx.effect(() => webServer.register({
      kind: 'exact',
      path: '/subscription-auth/auth/logout',
      handler: async (req, res) => {
        try {
          if (req.method !== 'POST') {
            send(res, 405, { error: 'method not allowed' })
            return
          }
          let body: Record<string, unknown> = {}
          try {
            body = JSON.parse((await collectBody(req)) || '{}')
          } catch {
            /* 无 body 时按空处理 */
          }
          const id = typeof body.provider === 'string' ? body.provider : ''
          const st = states.get(id)
          if (st === undefined) {
            send(res, 404, { error: `unknown provider: ${id}` })
            return
          }
          await logoutChannel(st)
          send(res, 200, { ok: true })
        } catch (error) {
          send(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), 'subscription-auth.logout-route')
  })
}
