/**
 * kit-balance —— DeepSeek 账户余额查询(插件示范)
 *
 * 本插件经 dsh plugin add 安装为 bundle 层,运行在完整 Node 环境:
 *   - 可以直接用全局 fetch,不需要 curl/subprocess 绕行
 *   - 文件随仓库走,cordis.patch.yml 里 name: 'my-dsh-kit/plugins/balance.js'
 *   - 重启后依然生效(不是会话内动态插件)
 *
 * 做的事:
 *   1. 每分钟通过 DeepSeek 官方余额 API 刷新 CNY 余额(credentials 取 DEEPSEEK_API_KEY)
 *   2. 注册模型可见工具 balance_check,agent 可随时查询余额
 *   3. 缓存最新结果,避免每次工具调用都发请求
 *
 * 注意:浏览器 UI(输入栏徽章)需要 client 半区,本插件只做 Host 端;
 * 需要 UI 时用动态插件(cordis_define 的 code.client)注册 Slot,
 * 或未来把 client 半区升级为 npm 包(dsh.client 声明)。
 */
export default {
  name: 'kit-balance',
  inject: ['credentials', 'timer', 'tools'],
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
        // 静态插件在完整 Node 环境,直接用全局 fetch
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

    // 注册模型可见工具
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
      disposeTool()
    }
  },
}