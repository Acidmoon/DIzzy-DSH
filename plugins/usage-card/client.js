/**
 * dizzy-dsh-usage-card Client 半区 —— 会话区左上角「本月用量」卡片
 *
 * 本文件是 client bundle(ModuleLoader 工厂格式),由 client-modules 按
 * 包名扫描 dsh.client 声明后自动加载,无需构建链 —— factory 内 require()
 * 由平台 seed 提供(react、react-dom 等)。
 *
 * 卡片结构:
 *   - 数据:GET /dizzy/usage?month=YYYY-MM(Host 聚合本地会话日志)
 *   - 顶部:『用量』标题 + ‹ 月份 › 切换;点月份打开年/12 月格选择器
 *   - hero:本月合计 token 数(骨架屏/错误态)
 *   - 主体:按周分列的浅绿→墨绿热力图(周一起始,行=周一~周日,
 *     列=周),hover 显示日期+用量,今日描边+脉冲,无用量透明
 *   - 底部:北京时间峰谷时钟(高峰 9:00-12:00 / 14:00-18:00 红,
 *     空闲绿,进入高峰前 30 分钟渐变)
 *   - 折叠:右上角按钮 → 左上角只留 34px 迷你方块(4 格热力图示意),
 *     点击展开
 *   - 可见性:better-sidebar 展开(--dsh-sidebar-width > 0)或窗口
 *     < 760px 时不显示;宽度 = 会话滚动区到聊天列空隙(封顶 280px),
 *     空隙 < 200px 时不渲染
 *
 * 挂载:conversation.session.header.utilities 列表插槽。官方
 * conversation.session.header 是 kind: single,宿主 x6 已在 priority 0
 * 注册整条页头;用量卡只要挂载点,走官方加法入口 utilities。
 * 卡片本体 createPortal 到 body + fixed 定位,与宿主布局解耦。
 *
 * 注意:静态 client bundle 运行在真实浏览器环境(非动态守卫),fetch、
 * setInterval、MutationObserver、ResizeObserver 等全局可用;数据经 host
 * 路由获取,key 不出现在浏览器。
 */
window.__ModuleLoader__.load({
  id: 'dizzy-dsh-usage-card',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const ReactDom = require('react-dom')

    const apply = (ctx) => {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      const style = document.createElement('style')
      style.textContent = [
        // ── 本月用量卡片:宿主 token 仪表面,不是独立深色看板 ──
        '.dsh-usage-card{--dsh-usage-lv0:transparent;--dsh-usage-lv1:var(--dsw-static-deepseek-200);--dsh-usage-lv2:var(--dsw-static-deepseek-300);--dsh-usage-lv3:var(--dsw-static-deepseek-400);--dsh-usage-lv4:var(--dsw-static-deepseek-500);position:fixed;z-index:40;display:flex;flex-direction:column;box-sizing:border-box;padding:12px 14px 10px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,ui-sans-serif,system-ui,sans-serif);box-shadow:0 1px 0 var(--dsw-alias-border-l1),0 8px 20px var(--dsw-alias-bg-mask-2);user-select:none}',
        'body[data-ds-dark-theme] .dsh-usage-card{--dsh-usage-lv1:var(--dsw-static-deepseek-600);--dsh-usage-lv2:var(--dsw-static-deepseek-500);--dsh-usage-lv3:var(--dsw-static-deepseek-400);--dsh-usage-lv4:var(--dsw-static-deepseek-300);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-static-neutral-bluish-50)}',
        'body[data-ds-dark-theme] .dsh-usage-kicker,body[data-ds-dark-theme] .dsh-usage-sub,body[data-ds-dark-theme] .dsh-usage-wlabel,body[data-ds-dark-theme] .dsh-usage-whead,body[data-ds-dark-theme] .dsh-usage-legend,body[data-ds-dark-theme] .dsh-usage-clock,body[data-ds-dark-theme] .dsh-usage-period,body[data-ds-dark-theme] .dsh-usage-btn{color:var(--dsw-static-neutral-bluish-200)}',
        'body[data-ds-dark-theme] .dsh-usage-figure,body[data-ds-dark-theme] .dsh-usage-month,body[data-ds-dark-theme] .dsh-usage-btn:hover{color:var(--dsw-static-neutral-bluish-50)}',
        'body[data-ds-dark-theme] .dsh-usage-pop{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-static-neutral-bluish-50)}',
        '.dsh-usage-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}',
        '.dsh-usage-kicker{font-size:11px;font-weight:500;letter-spacing:.04em;color:var(--dsw-alias-label-secondary)}',
        '.dsh-usage-nav{position:relative;display:inline-flex;align-items:center;gap:0;font-variant-numeric:tabular-nums}',
        '.dsh-usage-btn{display:inline-flex;align-items:center;justify-content:center;min-width:28px;min-height:28px;padding:0 4px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1;cursor:pointer;transition:background var(--ds-transition-duration-fast,0.1s) var(--ds-ease-in-out,ease),color var(--ds-transition-duration-fast,0.1s) var(--ds-ease-in-out,ease)}',
        '.dsh-usage-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.dsh-usage-btn:focus-visible,.dsh-usage-cell:focus-visible,.dsh-usage-mbtn:focus-visible{outline:2px solid var(--dsw-static-deepseek-500);outline-offset:1px}',
        '.dsh-usage-month{min-width:52px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
        '.dsh-usage-hero{flex:none;margin:0 0 8px}',
        '.dsh-usage-figure{font-size:22px;font-weight:600;letter-spacing:-.03em;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}',
        '.dsh-usage-sub{margin-top:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
        '.dsh-usage-skel{display:inline-block;height:22px;width:92px;border-radius:6px;background:var(--dsw-alias-bg-skeleton);animation:dsh-usage-pulse 1.2s ease-in-out infinite}',
        '@keyframes dsh-usage-pulse{0%,100%{opacity:1}50%{opacity:.4}}',
        '@media (prefers-reduced-motion:reduce){.dsh-usage-skel{animation:none}.dsh-usage-clock,.dsh-usage-dot,.dsh-usage-period{transition:none}}',
        '.dsh-usage-pop{position:absolute;right:0;top:30px;z-index:12;width:188px;padding:10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 24px var(--dsw-alias-bg-mask-2)}',
        '.dsh-usage-yrow{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}',
        '.dsh-usage-yrow span{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}',
        '.dsh-usage-mgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}',
        '.dsh-usage-mbtn{height:28px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}',
        '.dsh-usage-mbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.dsh-usage-mbtn.is-on{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary);font-weight:600}',
        '.dsh-usage-now{display:block;width:100%;margin-top:8px;height:28px;border:0;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}',
        '.dsh-usage-heat{flex:none;display:flex;gap:8px;align-items:stretch;margin:0 0 8px}',
        '.dsh-usage-wd{display:grid;grid-template-rows:repeat(7,20px);gap:4px}',
        '.dsh-usage-wdl{display:flex;align-items:center;justify-content:center;font-size:10px;line-height:1;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));user-select:none}',
        '.dsh-usage-cells{flex:1;min-width:0;display:grid;grid-template-rows:repeat(7,20px);gap:4px}',
        '.dsh-usage-cell{position:relative;box-sizing:border-box;width:20px;height:20px;padding:0;border:0;border-radius:3px;background:transparent;cursor:pointer;transition:transform .16s cubic-bezier(.2,.8,.3,1.4),box-shadow .16s ease}',
        '.dsh-usage-cell.is-void{visibility:hidden;pointer-events:none}',
        '.dsh-usage-cell.is-idle{cursor:pointer}',
        '.dsh-usage-cell.is-today{outline:1.5px solid var(--dsw-alias-label-primary);outline-offset:1.5px}',
        '.dsh-usage-cell.is-today:after{content:"";position:absolute;inset:0;border-radius:3px;box-shadow:0 0 0 0 color-mix(in srgb,var(--dsw-alias-label-primary) 35%,transparent);animation:dsh-usage-today 2.6s ease-out 1s infinite;pointer-events:none}',
        '.dsh-usage-cell.has-use{box-shadow:0 0 7px color-mix(in srgb,currentColor 38%,transparent)}',
        '.dsh-usage-cell:hover:not(.is-void){transform:scale(1.28);z-index:3;box-shadow:0 0 12px color-mix(in srgb,currentColor 45%,transparent)}',
        '@keyframes dsh-usage-today{70%{box-shadow:0 0 0 5px transparent}100%{box-shadow:0 0 0 0 transparent}}',
        '@media (prefers-reduced-motion:reduce){.dsh-usage-cell{transition:none}.dsh-usage-cell.is-today:after{animation:none}}',
        '.dsh-usage-legend{flex:none;display:flex;align-items:center;gap:5px;margin-bottom:8px;font-size:12px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
        '.dsh-usage-swatch{width:12px;height:12px;border-radius:3px;background:var(--dsh-usage-lv0)}',
        '.dsh-usage-time{flex:none;display:flex;align-items:center;gap:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}',
        '.dsh-usage-dot{width:6px;height:6px;border-radius:50%;flex:none;transition:background .5s linear}',
        '.dsh-usage-clock{font-size:11px;font-weight:500;letter-spacing:0;font-variant-numeric:tabular-nums;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);color:var(--dsw-alias-label-secondary)}',
        '.dsh-usage-period{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary)}',
        '.dsh-usage-tip{position:fixed;z-index:50;pointer-events:none;padding:6px 8px;border-radius:8px;background:var(--dsw-alias-tooltip-bg);color:var(--dsw-alias-label-primary-inverted,var(--dsw-alias-label-primary-foreground,#f7f8fa));font-size:12px;line-height:16px;box-shadow:0 4px 16px var(--dsw-alias-bg-mask-2);white-space:nowrap}',
        // ── 折叠态:左上角迷你方块(与卡片同 token 体系)────────────
        '.dsh-usage-mini{--dsh-usage-lv1:var(--dsw-static-deepseek-200);--dsh-usage-lv2:var(--dsw-static-deepseek-300);--dsh-usage-lv3:var(--dsw-static-deepseek-400);--dsh-usage-lv4:var(--dsw-static-deepseek-500);position:fixed;z-index:40;width:34px;height:34px;display:flex;align-items:center;justify-content:center;gap:2px;padding:0;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);box-shadow:0 1px 0 var(--dsw-alias-border-l1),0 8px 20px var(--dsw-alias-bg-mask-2);cursor:pointer;transition:border-color var(--ds-transition-duration-fast,0.1s) var(--ds-ease-in-out,ease),transform var(--ds-transition-duration-fast,0.1s) var(--ds-ease-in-out,ease)}',
        '.dsh-usage-mini:hover{border-color:var(--dsw-alias-border-l3);transform:scale(1.06)}',
        '.dsh-usage-mini .m{width:5px;height:5px;border-radius:1.5px}',
        'body[data-ds-dark-theme] .dsh-usage-mini{--dsh-usage-lv1:var(--dsw-static-deepseek-600);--dsh-usage-lv2:var(--dsw-static-deepseek-500);--dsh-usage-lv3:var(--dsw-static-deepseek-400);--dsh-usage-lv4:var(--dsw-static-deepseek-300);background:var(--dsw-alias-bg-layer-1)}',
      ].join('')
      document.head.append(style)

      // ── 工具函数 ────────────────────────────────────────────────
      function monthStr(date) {
        return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0')
      }
      function dayStr(date) {
        return monthStr(date) + '-' + String(date.getDate()).padStart(2, '0')
      }
      function tokenRgb(name, fallback) {
        const raw = getComputedStyle(document.body).getPropertyValue(name).trim()
        const match = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
        if (match === null) return fallback
        return [Number(match[1]), Number(match[2]), Number(match[3])]
      }
      function shiftMonth(month, delta) {
        const parts = month.split('-').map(Number)
        return monthStr(new Date(parts[0], parts[1] - 1 + delta, 1))
      }
      function fmtTokens(n) {
        if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
        if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿'
        if (n >= 1e4) return (n / 1e4).toFixed(1) + '万'
        return String(n)
      }
      // 北京时间(Asia/Shanghai)的 时/分/秒
      const bjFmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
      function beijingParts(date) {
        const parts = Object.create(null)
        for (const part of bjFmt.formatToParts(date)) {
          if (part.type !== 'literal') parts[part.type] = Number(part.value)
        }
        return { h: parts.hour, m: parts.minute, s: parts.second }
      }
      // 官方峰谷:高峰 9:00-12:00、14:00-18:00(北京时间),其余空闲;
      // 进入高峰前 30 分钟由绿渐变红,高峰结束后 30 分钟由红渐变回绿
      function mix(x, from, to) {
        return 'rgb(' + [0, 1, 2].map((i) => Math.round(from[i] + (to[i] - from[i]) * x)).join(',') + ')'
      }
      function periodOf(date) {
        const green = tokenRgb('--dsw-static-green-500', [34, 197, 94])
        const red = tokenRgb('--dsw-static-red-500', [239, 68, 68])
        const p = beijingParts(date)
        const m = p.h * 60 + p.m
        const T = 30
        const t = (a, b) => (m - a) / (b - a)
        if (m >= 8 * 60 + 30 && m < 9 * 60) return { color: mix(t(8 * 60 + 30, 9 * 60), green, red), label: '即将进入高峰' }
        if (m >= 9 * 60 && m < 12 * 60) return { color: mix(1, green, red), label: '高峰时段' }
        if (m >= 12 * 60 && m < 12 * 60 + T) return { color: mix(t(12 * 60, 12 * 60 + T), red, green), label: '高峰刚结束' }
        if (m >= 13 * 60 + 30 && m < 14 * 60) return { color: mix(t(13 * 60 + 30, 14 * 60), green, red), label: '即将进入高峰' }
        if (m >= 14 * 60 && m < 18 * 60) return { color: mix(1, green, red), label: '高峰时段' }
        if (m >= 18 * 60 && m < 18 * 60 + T) return { color: mix(t(18 * 60, 18 * 60 + T), red, green), label: '高峰刚结束' }
        return { color: mix(0, green, red), label: '空闲时段' }
      }
      // 周一起始的月网格:列 = 周,行 = 周一~周日
      function monthWeeks(year, month) {
        const daysInMonth = new Date(year, month + 1, 0).getDate()
        const firstDow = (new Date(year, month, 1).getDay() + 6) % 7
        const weeks = []
        let day = 1 - firstDow
        while (day <= daysInMonth) {
          const week = []
          for (let i = 0; i < 7; i += 1) {
            const d = day + i
            week.push(d >= 1 && d <= daysInMonth ? new Date(year, month, d) : null)
          }
          weeks.push(week)
          day += 7
        }
        return weeks
      }
      function cellColor(tokens, max) {
        if (tokens <= 0 || max <= 0) return 'transparent'
        const r = tokens / max
        if (r > 0.75) return 'var(--dsh-usage-lv4)'
        if (r > 0.5) return 'var(--dsh-usage-lv3)'
        if (r > 0.25) return 'var(--dsh-usage-lv2)'
        return 'var(--dsh-usage-lv1)'
      }
      function cssPx(start, name) {
        let node = start
        while (node !== null && node !== document.documentElement) {
          const raw = getComputedStyle(node).getPropertyValue(name).trim()
          if (raw !== '') {
            const value = parseFloat(raw)
            if (Number.isFinite(value) && value > 0) return value
          }
          node = node.parentElement
        }
        return 0
      }
      function findChatColumn(scroller, contentWidth) {
        if (contentWidth <= 0) return null
        const nodes = scroller.querySelectorAll('div')
        for (const el of nodes) {
          const box = el.getBoundingClientRect()
          if (box.height < 40) continue
          if (Math.abs(box.width - contentWidth) <= 4) return el
        }
        return null
      }
      function PeakClock() {
        const [now, setNow] = React.useState(new Date())
        React.useEffect(() => {
          const timer = setInterval(() => setNow(new Date()), 15000)
          return () => clearInterval(timer)
        }, [])
        const period = periodOf(now)
        const bj = beijingParts(now)
        const clockText = String(bj.h).padStart(2, '0') + ':' + String(bj.m).padStart(2, '0')
        return React.createElement('div', { className: 'dsh-usage-time' }, [
          React.createElement('span', { key: 'dot', className: 'dsh-usage-dot', style: { background: period.color } }),
          React.createElement('span', { key: 'clock', className: 'dsh-usage-clock' }, clockText),
          React.createElement('span', { key: 'period', className: 'dsh-usage-period' }, period.label),
        ])
      }
      function Chevron({ dir }) {
        return React.createElement('svg', {
          width: 12,
          height: 12,
          viewBox: '0 0 12 12',
          fill: 'none',
          'aria-hidden': 'true',
        }, React.createElement('path', {
          d: dir < 0 ? 'M7.5 2.5L4 6l3.5 3.5' : 'M4.5 2.5L8 6 4.5 9.5',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }))
      }
      function Minimize() {
        return React.createElement('svg', {
          width: 12,
          height: 12,
          viewBox: '0 0 12 12',
          fill: 'none',
          'aria-hidden': 'true',
        }, React.createElement('path', {
          d: 'M3 6h6',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }))
      }
      function isSidebarExpanded() {
        const value = getComputedStyle(document.documentElement).getPropertyValue('--dsh-sidebar-width').trim()
        if (value === '') return false // better-sidebar 未加载
        return parseFloat(value) > 0
      }

      // ── 本月用量卡片 ─────────────────────────────────────────────
      function UsageCard() {
        const [month, setMonth] = React.useState(monthStr(new Date()))
        const [data, setData] = React.useState(null)
        const [loadState, setLoadState] = React.useState('loading')
        const [pickerOpen, setPickerOpen] = React.useState(false)
        const [pickerYear, setPickerYear] = React.useState(new Date().getFullYear())
        const [collapsed, setCollapsed] = React.useState(false)
        const [hidden, setHidden] = React.useState(false)
        const [pos, setPos] = React.useState(null)
        const [tip, setTip] = React.useState(null)
        const pickerRef = React.useRef(null)

        React.useEffect(() => {
          let alive = true
          setLoadState('loading')
          setData(null)
          fetch('/dizzy/usage?month=' + encodeURIComponent(month), { credentials: 'same-origin' })
            .then((response) => {
              if (!response.ok) throw new Error('usage ' + response.status)
              return response.json()
            })
            .then((r) => {
              if (!alive) return
              if (r === null || typeof r !== 'object' || typeof r.total !== 'number') {
                throw new Error('usage shape')
              }
              setData(r)
              setLoadState('ok')
            })
            .catch(() => {
              if (!alive) return
              setData(null)
              setLoadState('error')
            })
          return () => { alive = false }
        }, [month])

        React.useEffect(() => {
          const check = () => {
            setHidden(isSidebarExpanded() || window.innerWidth < 760)
          }
          check()
          const observer = new MutationObserver(check)
          observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
          observer.observe(document.body, { attributes: true })
          window.addEventListener('resize', check)
          return () => {
            observer.disconnect()
            window.removeEventListener('resize', check)
          }
        }, [])

        React.useEffect(() => {
          if (hidden || collapsed) {
            setPickerOpen(false)
            setTip(null)
          }
        }, [hidden, collapsed])

        React.useEffect(() => {
          let scroller = null
          let column = null
          const place = (el) => {
            const rect = el.getBoundingClientRect()
            const pad = 8
            const gap = 16
            const contentW = cssPx(el, '--dsh-chat-content-width') || 748
            const col = column === null ? findChatColumn(el, contentW) : column
            const contentLeft = col === null
              ? rect.left + (rect.width - Math.min(contentW, rect.width)) / 2
              : col.getBoundingClientRect().left
            const width = Math.min(Math.floor(contentLeft - rect.left - pad - gap), 280)
            if (width < 200) {
              setPos(null)
              return
            }
            setPos({
              top: Math.round(rect.top + pad),
              left: Math.round(rect.left + pad),
              width,
            })
          }
          const observer = new ResizeObserver(() => {
            if (scroller === null) return
            place(scroller)
          })
          const bind = () => {
            const next = document.querySelector('[data-conversation-scroll]')
            if (next !== scroller) {
              if (scroller !== null) observer.unobserve(scroller)
              scroller = next
              if (scroller !== null) observer.observe(scroller)
            }
            if (scroller === null) return
            const contentW = cssPx(scroller, '--dsh-chat-content-width') || 748
            const nextCol = findChatColumn(scroller, contentW)
            if (nextCol !== column) {
              if (column !== null) observer.unobserve(column)
              column = nextCol
              if (column !== null) observer.observe(column)
            }
            place(scroller)
          }
          bind()
          const retry = setInterval(() => {
            bind()
            if (scroller !== null && column !== null) clearInterval(retry)
          }, 500)
          window.addEventListener('resize', bind)
          return () => {
            observer.disconnect()
            clearInterval(retry)
            window.removeEventListener('resize', bind)
          }
        }, [])

        React.useEffect(() => {
          if (!pickerOpen) return
          const onDown = (event) => {
            if (pickerRef.current !== null && !pickerRef.current.contains(event.target)) {
              setPickerOpen(false)
            }
          }
          const onKey = (event) => {
            if (event.key === 'Escape') setPickerOpen(false)
          }
          document.addEventListener('mousedown', onDown)
          document.addEventListener('keydown', onKey)
          return () => {
            document.removeEventListener('mousedown', onDown)
            document.removeEventListener('keydown', onKey)
          }
        }, [pickerOpen])

        const parts = month.split('-').map(Number)
        const weeks = monthWeeks(parts[0], parts[1] - 1)
        const days = data !== null && data !== undefined && data.days !== null && typeof data.days === 'object'
          ? data.days
          : null
        let max = 0
        if (days !== null) {
          for (const key of Object.keys(days)) {
            if (days[key] > max) max = days[key]
          }
        }
        const todayStr = dayStr(new Date())
        const total = data === null || data === undefined ? null : data.total ?? 0

        const showTip = (event, text) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const width = 196
          const left = Math.min(
            Math.max(rect.left + rect.width / 2, width / 2 + 8),
            window.innerWidth - width / 2 - 8
          )
          setTip({
            text,
            left: Math.round(left),
            top: Math.round(Math.max(rect.top - 8, 28)),
          })
        }

        if (hidden || pos === null) return null

        // 手动折叠:左上角只留迷你方块,点击展开
        if (collapsed) {
          const mini = React.createElement('button', {
            type: 'button',
            className: 'dsh-usage-mini',
            style: { top: pos.top, left: pos.left },
            title: '本月用量 · 点击展开',
            'aria-label': '展开用量卡片',
            onClick: () => setCollapsed(false),
          }, [
            React.createElement('span', { key: 'm1', className: 'm', style: { background: 'var(--dsh-usage-lv1)' } }),
            React.createElement('span', { key: 'm2', className: 'm', style: { background: 'var(--dsh-usage-lv2)' } }),
            React.createElement('span', { key: 'm3', className: 'm', style: { background: 'var(--dsh-usage-lv3)' } }),
            React.createElement('span', { key: 'm4', className: 'm', style: { background: 'var(--dsh-usage-lv4)' } }),
          ])
          return ReactDom.createPortal(mini, document.body)
        }

        const monthButtons = []
        for (let m = 1; m <= 12; m += 1) {
          const value = pickerYear + '-' + String(m).padStart(2, '0')
          monthButtons.push(React.createElement('button', {
            key: value,
            type: 'button',
            className: 'dsh-usage-mbtn' + (value === month ? ' is-on' : ''),
            onClick: () => {
              setMonth(value)
              setPickerOpen(false)
            },
          }, String(m)))
        }

        const head = React.createElement('div', { className: 'dsh-usage-head' }, [
          React.createElement('span', { key: 'kicker', className: 'dsh-usage-kicker' }, '用量'),
          React.createElement('div', { key: 'nav', className: 'dsh-usage-nav', ref: pickerRef }, [
            React.createElement('button', {
              key: 'prev',
              type: 'button',
              className: 'dsh-usage-btn',
              'aria-label': '上个月',
              onClick: () => {
                const next = shiftMonth(month, -1)
                setMonth(next)
                setPickerYear(Number(next.slice(0, 4)))
              },
            }, React.createElement(Chevron, { dir: -1 })),
            React.createElement('button', {
              key: 'month',
              type: 'button',
              className: 'dsh-usage-btn dsh-usage-month',
              'aria-expanded': pickerOpen,
              'aria-haspopup': 'dialog',
              onClick: () => {
                setPickerYear(parts[0])
                setPickerOpen((open) => !open)
              },
            }, parts[1] + '月'),
            React.createElement('button', {
              key: 'next',
              type: 'button',
              className: 'dsh-usage-btn',
              'aria-label': '下个月',
              onClick: () => {
                const next = shiftMonth(month, 1)
                setMonth(next)
                setPickerYear(Number(next.slice(0, 4)))
              },
            }, React.createElement(Chevron, { dir: 1 })),
            pickerOpen ? React.createElement('div', {
              key: 'pop',
              className: 'dsh-usage-pop',
              role: 'dialog',
              'aria-label': '选择月份',
            }, [
              React.createElement('div', { key: 'y', className: 'dsh-usage-yrow' }, [
                React.createElement('button', {
                  key: 'yp',
                  type: 'button',
                  className: 'dsh-usage-btn',
                  'aria-label': '上一年',
                  onClick: () => setPickerYear((year) => year - 1),
                }, React.createElement(Chevron, { dir: -1 })),
                React.createElement('span', { key: 'yl' }, String(pickerYear)),
                React.createElement('button', {
                  key: 'yn',
                  type: 'button',
                  className: 'dsh-usage-btn',
                  'aria-label': '下一年',
                  onClick: () => setPickerYear((year) => year + 1),
                }, React.createElement(Chevron, { dir: 1 })),
              ]),
              React.createElement('div', { key: 'g', className: 'dsh-usage-mgrid' }, monthButtons),
              React.createElement('button', {
                key: 'now',
                type: 'button',
                className: 'dsh-usage-now',
                onClick: () => {
                  const nowMonth = monthStr(new Date())
                  setMonth(nowMonth)
                  setPickerYear(Number(nowMonth.slice(0, 4)))
                  setPickerOpen(false)
                },
              }, '回到本月'),
            ]) : null,
          ]),
          React.createElement('button', {
            key: 'fold',
            type: 'button',
            className: 'dsh-usage-btn',
            'aria-label': '折叠卡片',
            title: '折叠卡片',
            onClick: () => setCollapsed(true),
          }, React.createElement(Minimize)),
        ])

        let figure
        let sub
        if (loadState === 'loading') {
          figure = React.createElement('span', { className: 'dsh-usage-skel', 'aria-hidden': 'true' })
          sub = '正在汇总本地会话…'
        } else if (loadState === 'error') {
          figure = '—'
          sub = '用量拉取失败'
        } else if (total === 0) {
          figure = '0'
          sub = '本月暂无用量'
        } else {
          figure = fmtTokens(total)
          sub = 'tokens · 本地会话'
        }

        const hero = React.createElement('div', { className: 'dsh-usage-hero' }, [
          React.createElement('div', { key: 'n', className: 'dsh-usage-figure' }, figure),
          React.createElement('div', { key: 's', className: 'dsh-usage-sub' }, sub),
        ])

        const weekdayNames = ['一', '二', '三', '四', '五', '六', '日']
        const wd = weekdayNames.map((name) => React.createElement('div', {
          key: name,
          className: 'dsh-usage-wdl',
        }, name))
        const heatCells = []
        for (let row = 0; row < 7; row += 1) {
          for (let col = 0; col < weeks.length; col += 1) {
            const date = weeks[col][row]
            if (date === null || date === undefined) {
              heatCells.push(React.createElement('span', {
                key: 'v' + row + '-' + col,
                className: 'dsh-usage-cell is-void',
              }))
              continue
            }
            const key = dayStr(date)
            const tokens = days === null ? 0 : (days[key] ?? 0)
            const color = cellColor(tokens, max)
            const used = tokens > 0
            const label = key + ' · ' + (used ? fmtTokens(tokens) + ' tokens' : '无用量')
            heatCells.push(React.createElement('button', {
              key: key,
              type: 'button',
              className: 'dsh-usage-cell' + (used ? ' has-use' : ' is-idle') + (key === todayStr ? ' is-today' : ''),
              style: used ? { background: color, color: color } : undefined,
              'aria-label': label,
              onMouseEnter: (event) => showTip(event, label),
              onMouseLeave: () => setTip(null),
              onFocus: (event) => showTip(event, label),
              onBlur: () => setTip(null),
            }))
          }
        }
        const grid = React.createElement('div', { className: 'dsh-usage-heat' }, [
          React.createElement('div', { key: 'wd', className: 'dsh-usage-wd' }, wd),
          React.createElement('div', {
            key: 'cells',
            className: 'dsh-usage-cells',
            style: { gridTemplateColumns: 'repeat(' + weeks.length + ', 20px)' },
          }, heatCells),
        ])

        const legend = React.createElement('div', { className: 'dsh-usage-legend' }, [
          '少',
          React.createElement('span', { key: 'l1', className: 'dsh-usage-swatch', style: { background: 'var(--dsh-usage-lv1)' } }),
          React.createElement('span', { key: 'l2', className: 'dsh-usage-swatch', style: { background: 'var(--dsh-usage-lv2)' } }),
          React.createElement('span', { key: 'l3', className: 'dsh-usage-swatch', style: { background: 'var(--dsh-usage-lv3)' } }),
          React.createElement('span', { key: 'l4', className: 'dsh-usage-swatch', style: { background: 'var(--dsh-usage-lv4)' } }),
          '多',
        ])

        const footer = React.createElement(PeakClock, { key: 'clock' })

        const tipNode = tip === null ? null : React.createElement('div', {
          className: 'dsh-usage-tip',
          role: 'tooltip',
          style: { left: tip.left, top: tip.top, transform: 'translate(-50%, -100%)' },
        }, tip.text)

        const card = React.createElement('div', {
          className: 'dsh-usage-card',
          style: { top: pos.top, left: pos.left, width: pos.width },
        }, [head, hero, grid, legend, footer, tipNode])

        return ReactDom.createPortal(card, document.body)
      }

      slots.inject('conversation.session.header.utilities', () => slots.register(
        {
          name: 'conversation.session.header.utilities',
          id: 'dizzy-usage-card',
          label: '本月用量',
          registrant: 'dizzy-dsh-usage-card',
        },
        () => React.createElement(UsageCard)
      ))

      return () => {
        style.remove()
      }
    }

    exports.apply = apply
    return module.exports
  },
})
