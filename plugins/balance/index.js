/**
 * dizzy-dsh-balance 插件(Host 端)
 *
 * 职责:
 *   1. 按 refreshIntervalMs 通过 DeepSeek 官方余额 API 刷新 CNY 余额
 *      (credentials 取 credentialName 指定的引用)
 *   2. 注册 webServer 路由 GET /dizzy/balance —— Client 半区通过同源 fetch
 *      读取余额(浏览器拿不到 API key,数据必须经 host 中转)
 *   3. 注册模型可见工具 balance_check,agent 可随时查询余额
 *
 * 配置化(与 dsh 官方插件同一模式):
 *   - Config(schemastery)声明可调字段,loader 挂载时校验并填默认值;
 *     配置错误在加载期直接失败,不会静默带病运行
 *   - settings 服务在场时注册命名空间 'dizzy-balance':~/.dsh/settings.yaml
 *     的同名分节作为用户层覆盖,文件热重载,watch 到变化即时应用
 *     (改刷新间隔/凭据引用免重启);settings 不在场时退回 entry config
 *   - 余额 API 端点是 DeepSeek 官方协议常量,不作为可调项
 *
 * Client 半区见 client.js:输入栏余额徽章(conversation.input.right)。
 */
import Schema from 'schemastery'

/** 可调配置(loader 挂载时校验;settings 命名空间复用同一 schema)。 */
const Config = Schema.object({
  /** credentials 服务里的凭据引用名。 */
  credentialName: Schema.string().default('DEEPSEEK_API_KEY'),
  /** 余额刷新间隔(毫秒),5s ~ 1h。 */
  refreshIntervalMs: Schema.number().min(5000).max(3600000).default(60000),
})

/** settings.yaml 中本插件的命名空间(规则同官方:/^[a-z][a-z0-9-]*$/)。 */
const SETTINGS_NS = 'dizzy-balance'

/** DeepSeek 官方余额端点(协议常量,固定)。 */
const BALANCE_API = 'https://api.deepseek.com/user/balance'

/**
 * 同源校验:跨站浏览器请求(sec-fetch-site: cross-site 或 Origin 与 Host
 * 不符)拒绝;无 Origin 的非浏览器客户端(curl 等)放行。
 */
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

export default {
  name: 'dizzy-dsh-balance',
  inject: ['credentials', 'timer', 'tools', 'webServer'],
  Config,
  apply(ctx, config) {
    // settings 命名空间:schema 默认值 ← entry config(base) ← settings.yaml
    // 用户层;settings 服务不在场时退回已校验的 entry config,行为不变。
    const settings = ctx.get('settings')
    const scope = settings === undefined
      ? undefined
      : settings.register(SETTINGS_NS, Config, { base: config })
    const current = () => (scope === undefined ? config : scope.get())

    // 全部可变状态都在 apply 内:属于本 fiber,卸载即消失。
    let cache = {
      balanceCny: null,
      isAvailable: false,
      error: null,
      at: 0,
    }
    let stopTimer = null

    const refresh = async () => {
      const cfg = current()
      try {
        const resolved = await ctx.credentials.resolve(cfg.credentialName)
        if (resolved === undefined) {
          cache = { balanceCny: null, isAvailable: false, error: `未配置 ${cfg.credentialName}`, at: Date.now() }
          return
        }
        const response = await fetch(BALANCE_API, {
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

    const startTimer = () => {
      stopTimer = ctx.interval(refresh, current().refreshIntervalMs)
    }

    // 立即刷新一次,之后按配置间隔刷新
    refresh()
    startTimer()

    // 配置热应用:间隔变化则重建定时器;凭据引用变化立即重取。
    let previous = current()
    const stopWatch = scope === undefined
      ? () => {}
      : scope.watch((next) => {
          if (next.refreshIntervalMs !== previous.refreshIntervalMs) {
            stopTimer?.()
            startTimer()
          }
          if (next.credentialName !== previous.credentialName) void refresh()
          previous = next
        })

    // Client 半区数据源:GET /dizzy/balance → { balanceCny, isAvailable, error, at }
    const stopRoute = ctx.webServer.register({
      kind: 'exact',
      path: '/dizzy/balance',
      handler: async (req, res) => {
        if (!isSameOriginRequest(req)) {
          res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'forbidden: cross-site request' }))
          return
        }
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
      stopWatch()
      stopTimer?.()
      stopRoute()
      disposeTool()
    }
  },
}
