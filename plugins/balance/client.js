/**
 * dizzy-dsh-balance Client 半区 —— 输入栏余额/额度徽章
 *
 * 同一 conversation.input.right 插槽:
 *   - provider === deepseek-official → ¥余额
 *   - provider === grok → SuperGrok 周额度剩余%
 * 数据经 Host 同源路由,浏览器不接触密钥。
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

      const style = document.createElement('style')
      style.textContent =
        '.dsh-balance-badge{display:inline-flex;align-items:center;height:28px;padding:0 8px;border-radius:8px;font-size:13px;font-weight:500;line-height:20px;white-space:nowrap;user-select:none;color:var(--dsw-alias-label-secondary,#8a8f98);cursor:default;font-variant-numeric:tabular-nums}'
      document.head.append(style)

      function fmtUsed(n) {
        return String(Math.floor(Math.min(100, Math.max(0, n))))
      }

      /**
       * 当前模型所属 provider。
       *
       * 读 `useProjection('modelSelection')`(slot occupant 的 standardProps,
       * DSH 会话投影 `modelSelection.next`/`lastUsed`)—— 这是官方给渲染侧
       * 的读法。**不要**用 `ctx.get('modelDirectories')`:那是
       * dsh-client-ui-model-selection 的服务,不在本 fiber 的可见范围里,
       * 拿不到会让整个徽章静默不渲染。
       */
      function providerOf(props) {
        const useProjection = props.useProjection
        if (typeof useProjection === 'function') {
          let projection
          try {
            projection = useProjection('modelSelection')
          } catch (err) {
            projection = undefined
          }
          if (projection !== null && typeof projection === 'object') {
            const picked = projection.next ?? projection.lastUsed ?? null
            if (picked !== null && typeof picked.provider === 'string') return picked.provider
          }
        }
        return null
      }

      function BalanceBadge(props) {
        const [balance, setBalance] = React.useState(null)
        const [dsError, setDsError] = React.useState(null)
        const [grok, setGrok] = React.useState(null)

        // provider 来自会话投影;第三方视觉插件会把 provider 包成
        // `vision-toolkit-<provider>`,归一后再判断,否则徽章对这类渠道不显示。
        const provider = providerOf(props)
        const baseProvider = typeof provider === 'string' && provider.startsWith('vision-toolkit-')
          ? provider.slice('vision-toolkit-'.length)
          : provider
        const isDeepSeek = baseProvider === 'deepseek-official'
        const isGrok = baseProvider === 'grok'

        React.useEffect(() => {
          if (!isDeepSeek) return
          let alive = true
          const load = async () => {
            try {
              const response = await fetch('/dizzy/balance', { credentials: 'same-origin' })
              const r = await response.json()
              if (!alive) return
              setBalance(typeof r.balanceCny === 'number' ? r.balanceCny : null)
              setDsError(r.error ?? null)
            } catch (err) {
              if (alive) setDsError(String(err === null || err === undefined ? '' : err.message ?? err))
            }
          }
          load()
          const timer = setInterval(load, 60000)
          return () => {
            alive = false
            clearInterval(timer)
          }
        }, [isDeepSeek])

        React.useEffect(() => {
          if (!isGrok) return
          let alive = true
          const load = async () => {
            try {
              const response = await fetch('/dizzy/grok-quota', { credentials: 'same-origin' })
              const r = await response.json()
              if (alive) setGrok(r)
            } catch (err) {
              if (alive) {
                setGrok({
                  status: 'error',
                  remainingPercent: null,
                  error: String(err === null || err === undefined ? '' : err.message ?? err),
                })
              }
            }
          }
          load()
          const pollMs = (grok && grok.status === 'unauthenticated') ? 5000 : 60000
          const timer = setInterval(load, pollMs)
          return () => {
            alive = false
            clearInterval(timer)
          }
        }, [isGrok, grok && grok.status])

        if (isGrok) {
          let text = '…'
          if (grok !== null) {
            if (typeof grok.remainingPercent === 'number') text = String(grok.remainingPercent) + '%'
            else if (grok.status === 'unauthenticated') text = '未登录'
            else if (grok.error) text = '--'
          }
          const until = grok && grok.periodEnd ? new Date(grok.periodEnd).toLocaleString() : ''
          let title = 'Grok 周额度'
          if (grok !== null) {
            if (grok.status === 'unauthenticated') {
              title = (grok.error && String(grok.error).includes('失效'))
                ? grok.error
                : '请在 credentials 配置 GROK_SUBSCRIPTION_TOKEN'
            } else if (grok.error && typeof grok.remainingPercent !== 'number') {
              title = 'Grok 额度获取失败: ' + grok.error
            } else {
              title = [
                grok.subscriptionTier || 'Grok',
                grok.periodType === 'USAGE_PERIOD_TYPE_MONTHLY' ? '月额度' : '周额度',
                typeof grok.creditUsagePercent === 'number' ? ('已用 ' + fmtUsed(grok.creditUsagePercent) + '%') : '',
                until ? ('重置 ' + until) : '',
              ].filter(Boolean).join(' · ')
            }
          }
          return React.createElement(
            'span',
            { className: 'dsh-balance-badge', title },
            text,
          )
        }

        if (!isDeepSeek) return null
        const text = balance === null
          ? (dsError ? '--' : '…')
          : '¥' + balance.toFixed(2)
        return React.createElement(
          'span',
          {
            className: 'dsh-balance-badge',
            title: dsError
              ? ('余额获取失败: ' + dsError)
              : ('DeepSeek 账户余额,更新于 ' + new Date().toLocaleTimeString()),
          },
          text,
        )
      }

      slots.inject('conversation.input.right', () => slots.register(
        { name: 'conversation.input.right', id: 'deepseek-balance', label: '账户额度' },
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
