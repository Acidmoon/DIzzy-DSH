/**
 * dizzy-dsh-balance 插件(Host 端)
 *
 * 职责:
 *   1. 每分钟通过 DeepSeek 官方余额 API 刷新 CNY 余额(credentials 取 DEEPSEEK_API_KEY)
 *   2. 注册 webServer 路由 GET /dizzy/balance —— Client 半区通过同源 fetch 读取余额
 *      (浏览器拿不到 API key,数据必须经 host 中转)
 *   3. 注册模型可见工具 balance_check,agent 可随时查询余额
 *
 * 本插件是 Dizzy-DSH 插件合集的一个子包(file: 依赖安装,经主包
 * cordis.patch.yml 挂载),运行在完整 Node 环境:
 *   - 直接用全局 fetch 调 API(不需要 curl/subprocess 绕行)
 *   - 重启后依然生效(不是会话内动态插件)
 *
 * Client 半区见 client.js:输入栏余额徽章(conversation.input.right)。
 */
export default {
  name: 'dizzy-dsh-balance',
  inject: ['credentials', 'timer', 'tools', 'webServer'],
  apply(ctx) {
    let cache = {
      balanceCny: null,
      isAvailable: false,
      error: null,
      at: 0,
    }

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
      stopTimer()
      stopRoute()
      disposeTool()
    }
  },
}
