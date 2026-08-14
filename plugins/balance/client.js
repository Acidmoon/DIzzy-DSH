/**
 * dizzy-dsh-balance Client 半区 —— 输入栏余额徽章
 *
 * 本文件是 client bundle(ModuleLoader 工厂格式),由 client-modules 按
 * 包名扫描 dsh.client 声明后自动加载,无需构建链 —— factory 内 require()
 * 由平台 seed 提供(react 等)。
 *
 * 做的事:
 *   1. 注册 conversation.input.right 插槽,在模型选择器左侧显示余额徽章
 *   2. 每 60 秒通过同源 fetch GET /dizzy/balance 拉取余额(Host 半区中转,
 *      浏览器拿不到 API key)
 *   3. 通过 modelDirectories 服务判断当前模型:仅 deepseek-official 时显示
 *
 * 注意:静态 client bundle 运行在真实浏览器环境(非动态守卫),fetch、
 * setInterval 等全局可用;数据经 host 路由获取,key 不出现在浏览器。
 */
window.__ModuleLoader__.load({
  id: 'dizzy-dsh-balance',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    const apply = (ctx) => {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      const models = ctx.get('modelDirectories')

      const style = document.createElement('style')
      style.textContent =
        '.dsh-balance-badge{display:inline-flex;align-items:center;height:28px;padding:0 8px;border-radius:8px;font-size:13px;font-weight:500;line-height:20px;white-space:nowrap;user-select:none;color:var(--dsw-alias-label-secondary,#8a8f98);cursor:default;font-variant-numeric:tabular-nums}'
      document.head.append(style)

      function BalanceBadge(props) {
        const sessionId = props.sessionId
        const [selection, setSelection] = React.useState(null)
        const [balance, setBalance] = React.useState(null)
        const [error, setError] = React.useState(null)
        const [model, setModel] = React.useState(null)

        React.useEffect(() => {
          if (models === undefined) return
          let directory
          try {
            directory = models.directoryFor(sessionId)
          } catch (err) {
            return
          }
          const update = () => {
            const snap = directory.store.getSnapshot()
            setSelection(snap === null || snap === undefined ? null : snap.current ?? null)
          }
          update()
          return directory.store.subscribe(update)
        }, [sessionId, models])

        const current = selection ?? model
        const provider = current === null || current === undefined ? null : current.provider ?? null
        const isDeepSeek = provider === 'deepseek-official'

        React.useEffect(() => {
          if (!isDeepSeek) return
          let alive = true
          const load = async () => {
            try {
              const response = await fetch('/dizzy/balance', { credentials: 'same-origin' })
              const r = await response.json()
              if (!alive) return
              setBalance(typeof r.balanceCny === 'number' ? r.balanceCny : null)
              setModel(r.model ?? null)
              setError(r.error ?? null)
            } catch (err) {
              if (alive) setError(String(err === null || err === undefined ? '' : err.message ?? err))
            }
          }
          load()
          const timer = setInterval(load, 60000)
          return () => {
            alive = false
            clearInterval(timer)
          }
        }, [isDeepSeek])

        if (!isDeepSeek) return null
        const text = balance === null
          ? (error ? '--' : '…')
          : '¥' + balance.toFixed(2)
        return React.createElement(
          'span',
          {
            className: 'dsh-balance-badge',
            title: error
              ? ('余额获取失败: ' + error)
              : ('DeepSeek 账户余额,更新于 ' + new Date().toLocaleTimeString()),
          },
          text
        )
      }

      slots.inject('conversation.input.right', () => slots.register(
        { name: 'conversation.input.right', id: 'deepseek-balance', label: 'DeepSeek 余额' },
        (props) => React.createElement(BalanceBadge, props)
      ))

      return () => {
        style.remove()
      }
    }

    exports.apply = apply
    return module.exports
  },
})
