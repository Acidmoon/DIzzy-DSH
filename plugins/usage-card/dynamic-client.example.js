/**
 * 本月用量卡片 —— Cordis 动态插件「浏览器半区」示例
 *
 * 用途:把卡片注册为动态插件(cordis_define),免重启迭代 UI。
 * 使用方法:
 *   1. 本文件内容原样粘贴到 cordis_define 的 client 字段(host 字段留空),
 *      或让模型读取本文件后执行 cordis_define
 *   2. 批准运行(cordis_run 的审批或 tool.view.cordis 面板)
 *   3. 卡片立即出现在会话区左上角;改代码 → 重新 define → 再运行,
 *      全程无需重启 dsh web
 *
 * 动态浏览器半区的约束(与 bundle client 的差异):
 *   - 整个半区是一个闭包:React 以参数传入,不能 require 任何模块
 *   - 纯 JS,无 JSX / TypeScript
 *   - 没有 react-dom → 不能用 createPortal,卡片用 position:fixed 直挂
 *   - 禁 setInterval/setTimeout(除非 inject: ['timer'])→ 时钟用 rAF
 *   - 页面全局(document/fetch/window/MutationObserver/ResizeObserver)可用
 *
 * 数据:复用 bundle 层已注册的 GET /dizzy/usage?month=YYYY-MM
 * (bundle 的 usage-card 子包保留 host 路由;动态版只提供 UI)
 *
 * 实验结束:git checkout plugins/usage-card/client.js 恢复 bundle UI,
 * 删除本文件与 profile cordis.patch.yml 里的 tool-cordis insert。
 */
(React) => {
  // ── 工具函数 ────────────────────────────────────────────────
  function monthStr(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0')
  }
  function dayStr(date) {
    return monthStr(date) + '-' + String(date.getDate()).padStart(2, '0')
  }
  function fmtTokens(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
    if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿'
    if (n >= 1e4) return (n / 1e4).toFixed(1) + '万'
    return String(n)
  }
  const bjFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  function beijingParts(date) {
    const parts = Object.create(null)
    for (const p of bjFmt.formatToParts(date)) {
      if (p.type !== 'literal') parts[p.type] = Number(p.value)
    }
    return { h: parts.hour, m: parts.minute, s: parts.second }
  }
  const GREEN = [74, 222, 128] // #4ade80
  const RED = [248, 113, 113] // #f87171
  function mix(x, from, to) {
    return 'rgb(' + [0, 1, 2].map((i) => Math.round(from[i] + (to[i] - from[i]) * x)).join(',') + ')'
  }
  function periodOf(date) {
    const p = beijingParts(date)
    const m = p.h * 60 + p.m
    const T = 30
    const t = (a, b) => (m - a) / (b - a)
    if (m >= 8 * 60 + 30 && m < 9 * 60) return { color: mix(t(8 * 60 + 30, 9 * 60), GREEN, RED), label: '即将进入高峰' }
    if (m >= 9 * 60 && m < 12 * 60) return { color: mix(1, GREEN, RED), label: '高峰时段' }
    if (m >= 12 * 60 && m < 12 * 60 + T) return { color: mix(t(12 * 60, 12 * 60 + T), RED, GREEN), label: '高峰刚结束' }
    if (m >= 13 * 60 + 30 && m < 14 * 60) return { color: mix(t(13 * 60 + 30, 14 * 60), GREEN, RED), label: '即将进入高峰' }
    if (m >= 14 * 60 && m < 18 * 60) return { color: mix(1, GREEN, RED), label: '高峰时段' }
    if (m >= 18 * 60 && m < 18 * 60 + T) return { color: mix(t(18 * 60, 18 * 60 + T), RED, GREEN), label: '高峰刚结束' }
    return { color: mix(0, GREEN, RED), label: '空闲时段' }
  }
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
    if (r > 0.75) return '#13603a'
    if (r > 0.5) return '#2f9e5f'
    if (r > 0.25) return '#66c98a'
    return '#a8e6b8'
  }
  function isSidebarExpanded() {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--dsh-sidebar-width').trim()
    if (value === '') return false
    return parseFloat(value) > 0
  }

  // ── 卡片组件 ────────────────────────────────────────────────
  function UsageCard() {
    const [month, setMonth] = React.useState(monthStr(new Date()))
    const [data, setData] = React.useState(null)
    const [collapsed, setCollapsed] = React.useState(false)
    const [hidden, setHidden] = React.useState(false)
    const [now, setNow] = React.useState(new Date())
    const [pos, setPos] = React.useState(null)

    // 数据:月份切换时拉取(bundle 路由)
    React.useEffect(() => {
      let alive = true
      fetch('/dizzy/usage?month=' + encodeURIComponent(month), { credentials: 'same-origin' })
        .then((response) => response.json())
        .then((r) => { if (alive) setData(r) })
        .catch(() => { if (alive) setData(null) })
      return () => { alive = false }
    }, [month])

    // 可见性:better-sidebar 展开或窄窗隐藏
    React.useEffect(() => {
      const check = () => setHidden(isSidebarExpanded() || window.innerWidth < 760)
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

    // 定位:钉在会话滚动区左上角
    React.useEffect(() => {
      const place = () => {
        const el = document.querySelector('[data-conversation-scroll]')
        if (el === null) return
        const rect = el.getBoundingClientRect()
        setPos({ top: Math.round(rect.top + 8), left: Math.round(rect.left + 8) })
      }
      place()
      const observer = new ResizeObserver(place)
      const el = document.querySelector('[data-conversation-scroll]')
      if (el !== null) observer.observe(el)
      window.addEventListener('resize', place)
      return () => {
        observer.disconnect()
        window.removeEventListener('resize', place)
      }
    }, [])

    // 时钟:rAF(动态包禁 setInterval)
    React.useEffect(() => {
      let raf = 0
      let last = 0
      const tick = (ts) => {
        if (ts - last >= 1000) {
          last = ts
          setNow(new Date())
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(raf)
    }, [])

    // 样式:一次性注入
    React.useEffect(() => {
      const el = document.createElement('style')
      el.textContent = [
        '.dyn-usage-card{position:fixed;z-index:40;box-sizing:border-box;width:280px;padding:12px 14px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(24,26,31,.96);color:#e6e8ec;font-family:ui-sans-serif,system-ui,sans-serif;box-shadow:0 8px 20px rgba(0,0,0,.4);user-select:none}',
        '.dyn-usage-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}',
        '.dyn-usage-btn{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;padding:0 4px;border:0;border-radius:8px;background:transparent;color:#c3c7cf;font-size:13px;line-height:1;cursor:pointer}',
        '.dyn-usage-btn:hover{background:rgba(255,255,255,.08);color:#fff}',
        '.dyn-usage-month{min-width:52px;font-weight:600}',
        '.dyn-usage-hero{margin:0 0 8px}',
        '.dyn-usage-figure{font-size:22px;font-weight:600;line-height:1.1;font-variant-numeric:tabular-nums}',
        '.dyn-usage-sub{margin-top:4px;font-size:11px;color:#8a8f98}',
        '.dyn-usage-heat{display:flex;gap:8px;align-items:stretch;margin:0 0 8px}',
        '.dyn-usage-wd{display:grid;grid-template-rows:repeat(7,20px);gap:4px}',
        '.dyn-usage-wdl{display:flex;align-items:center;justify-content:center;font-size:10px;color:#7d828c}',
        '.dyn-usage-cells{display:grid;grid-template-rows:repeat(7,20px);gap:4px}',
        '.dyn-usage-cell{width:20px;height:20px;border:0;border-radius:3px;background:transparent;cursor:pointer;padding:0}',
        '.dyn-usage-cell.is-today{outline:1.5px solid rgba(255,255,255,.55);outline-offset:1.5px}',
        '.dyn-usage-legend{display:flex;align-items:center;gap:5px;margin-bottom:8px;font-size:12px;color:#8a8f98}',
        '.dyn-usage-swatch{width:12px;height:12px;border-radius:3px}',
        '.dyn-usage-time{display:flex;align-items:center;gap:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08)}',
        '.dyn-usage-clock{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}',
        '.dyn-usage-period{margin-left:auto;font-size:11px}',
      ].join('')
      document.head.append(el)
      return () => el.remove()
    }, [])

    const parts = month.split('-').map(Number)
    const weeks = monthWeeks(parts[0], parts[1] - 1)
    const days = data !== null && data !== undefined && typeof data.days === 'object' ? data.days : null
    let max = 0
    if (days !== null) {
      for (const key of Object.keys(days)) {
        if (days[key] > max) max = days[key]
      }
    }
    const total = data === null || data === undefined ? null : data.total ?? 0
    const todayStr = dayStr(new Date())
    const period = periodOf(now)
    const bj = beijingParts(now)
    const clockText = String(bj.h).padStart(2, '0') + ':' + String(bj.m).padStart(2, '0')

    if (hidden || pos === null) return null

    // 折叠态:左上角迷你方块
    if (collapsed) {
      return React.createElement('button', {
        type: 'button',
        title: '本月用量 · 点击展开',
        onClick: () => setCollapsed(false),
        style: {
          position: 'fixed', top: pos.top, left: pos.left, width: 34, height: 34,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2,
          borderRadius: 10, border: '1px solid rgba(255,255,255,.12)',
          background: 'rgba(24,26,31,.96)', cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(0,0,0,.4)',
        },
      }, ['#a8e6b8', '#66c98a', '#2f9e5f', '#13603a'].map((color, i) =>
        React.createElement('span', {
          key: i,
          style: { width: 5, height: 5, borderRadius: 1.5, background: color },
        })
      ))
    }

    const shift = (delta) => {
      const next = monthStr(new Date(parts[0], parts[1] - 1 + delta, 1))
      setMonth(next)
    }

    const head = React.createElement('div', { className: 'dyn-usage-head' }, [
      React.createElement('span', { key: 'kicker', style: { fontSize: 11, color: '#8a8f98', letterSpacing: '.04em' } }, '用量'),
      React.createElement('div', { key: 'nav', style: { display: 'inline-flex', alignItems: 'center' } }, [
        React.createElement('button', { key: 'prev', type: 'button', className: 'dyn-usage-btn', 'aria-label': '上个月', onClick: () => shift(-1) }, '‹'),
        React.createElement('button', { key: 'month', type: 'button', className: 'dyn-usage-btn dyn-usage-month' }, parts[1] + '月'),
        React.createElement('button', { key: 'next', type: 'button', className: 'dyn-usage-btn', 'aria-label': '下个月', onClick: () => shift(1) }, '›'),
      ]),
      React.createElement('button', {
        key: 'fold', type: 'button', className: 'dyn-usage-btn', 'aria-label': '折叠卡片',
        title: '折叠卡片', onClick: () => setCollapsed(true),
      }, '—'),
    ])

    const hero = React.createElement('div', { className: 'dyn-usage-hero' }, [
      React.createElement('div', { key: 'n', className: 'dyn-usage-figure' }, total === null ? '…' : fmtTokens(total)),
      React.createElement('div', { key: 's', className: 'dyn-usage-sub' }, total === null ? '正在汇总本地会话…' : 'tokens · 本地会话'),
    ])

    const weekdayNames = ['一', '二', '三', '四', '五', '六', '日']
    const wd = weekdayNames.map((name) => React.createElement('div', { key: name, className: 'dyn-usage-wdl' }, name))
    const heatCells = []
    for (let row = 0; row < 7; row += 1) {
      for (let col = 0; col < weeks.length; col += 1) {
        const date = weeks[col][row]
        if (date === null || date === undefined) continue
        const key = dayStr(date)
        const tokens = days === null ? 0 : (days[key] ?? 0)
        const used = tokens > 0
        heatCells.push(React.createElement('button', {
          key: key,
          type: 'button',
          className: 'dyn-usage-cell' + (key === todayStr ? ' is-today' : ''),
          style: used ? { background: cellColor(tokens, max) } : undefined,
          title: key + ' · ' + (used ? fmtTokens(tokens) + ' tokens' : '无用量'),
        }))
      }
    }
    const grid = React.createElement('div', { className: 'dyn-usage-heat' }, [
      React.createElement('div', { key: 'wd', className: 'dyn-usage-wd' }, wd),
      React.createElement('div', {
        key: 'cells',
        className: 'dyn-usage-cells',
        style: { gridTemplateColumns: 'repeat(' + weeks.length + ', 20px)' },
      }, heatCells),
    ])

    const legend = React.createElement('div', { className: 'dyn-usage-legend' }, [
      '少',
      React.createElement('span', { key: 'l1', className: 'dyn-usage-swatch', style: { background: '#a8e6b8' } }),
      React.createElement('span', { key: 'l2', className: 'dyn-usage-swatch', style: { background: '#66c98a' } }),
      React.createElement('span', { key: 'l3', className: 'dyn-usage-swatch', style: { background: '#2f9e5f' } }),
      React.createElement('span', { key: 'l4', className: 'dyn-usage-swatch', style: { background: '#13603a' } }),
      '多',
    ])

    const footer = React.createElement('div', { className: 'dyn-usage-time' }, [
      React.createElement('span', { key: 'dot', style: { width: 6, height: 6, borderRadius: '50%', background: period.color } }),
      React.createElement('span', { key: 'clock', className: 'dyn-usage-clock', style: { color: period.color } }, clockText),
      React.createElement('span', { key: 'period', className: 'dyn-usage-period', style: { color: period.color } }, period.label),
    ])

    return React.createElement('div', {
      className: 'dyn-usage-card',
      style: { top: pos.top, left: pos.left },
    }, [head, hero, grid, legend, footer])
  }

  return {
    name: 'dyn-usage-card',
    inject: ['slots'],
    apply(ctx) {
      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
        { name: 'conversation.session.header.utilities', id: 'dyn-usage-card', label: '本月用量(动态)' },
        () => React.createElement(UsageCard)
      ))
    },
  }
}
