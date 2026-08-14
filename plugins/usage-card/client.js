/**
 * dizzy-dsh-usage-card Client 半区 —— 会话视图「用量」Tab
 *
 * 本文件是 client bundle(ModuleLoader 工厂格式),由 client-modules 按
 * 包名扫描 dsh.client 声明后自动加载,无需构建链 —— factory 内 require()
 * 由平台 seed 提供(react 等)。
 *
 * 挂载:conversation.view 视图环(list,会话域)。宿主 ui-conversation
 * 把每个 entry 投影为会话页头的一个 Tab(label 即 Tab 文本),经
 * renderSlot(..., { only: activeId }) 一次只渲染激活视图;chat order 0、
 * trajectory order 10,本视图 order 20,列在「轨迹」右侧。选中状态存于
 * 宿主每会话 store(persist: dsh.conversation.chat),刷新页面后保持;
 * 插件卸载后宿主自动回退 chat 视图。
 *
 * 视图结构(数据:GET /dizzy/usage?month=YYYY-MM,Host 聚合本地会话日志):
 *   - 页头:标题 + 月份导航(‹ › ±1 月;点月份开年/12 月格选择器,
 *     Esc / 点外侧关闭)+ 手动刷新;每 60s 自动重取当前月份
 *   - 统计卡:本月合计 / 活跃天数 / 活跃日均 / 峰值日
 *   - 月度热力图 + 近 7 天用量曲线(平滑贝塞尔过点,悬浮逐点读数):
 *     热力图周一起始,行=周一~周日、列=周,DeepSeek 蓝阶四档,格内
 *     日期数字,今日描边+脉冲;悬浮弹窗显示输入/输出/缓存分项
 *   - 今日明细:按模型分行(provider/model 归属),条形与热力图同一
 *     色阶,悬浮显示该模型输入/输出/缓存
 *   - 底部:北京时间峰谷时钟(高峰 9:00-12:00 / 14:00-18:00 红,
 *     空闲绿,进入高峰前 30 分钟渐变)
 *
 * 兼容:Host 未升级(响应无 detail 字段)时,热力图/统计/曲线照常
 * (曲线退化为查看月数据),分项弹窗只显总量,今日明细显示重启提示。
 *
 * 外观吃宿主 --dsw-* token(明暗主题跟随)。静态 client bundle 运行在
 * 真实浏览器环境(非动态守卫),fetch、setInterval 等全局可用;数据经
 * host 路由获取,浏览器不接触任何凭据。
 */
window.__ModuleLoader__.load({
  id: 'dizzy-dsh-usage-card',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    const apply = (ctx) => {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      const style = document.createElement('style')
      style.textContent = [
        // ── 视图骨架:吃宿主 token,明暗主题跟随 ─────────────────
        '.dsh-usage-view{--dsh-usage-lv0:transparent;--dsh-usage-lv1:var(--dsw-static-deepseek-200);--dsh-usage-lv2:var(--dsw-static-deepseek-300);--dsh-usage-lv3:var(--dsw-static-deepseek-400);--dsh-usage-lv4:var(--dsw-static-deepseek-500);box-sizing:border-box;width:100%;max-width:860px;margin:0 auto;padding:28px 24px 64px;display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,ui-sans-serif,system-ui,sans-serif)}',
        'body[data-ds-dark-theme] .dsh-usage-view{--dsh-usage-lv1:var(--dsw-static-deepseek-600);--dsh-usage-lv2:var(--dsw-static-deepseek-500);--dsh-usage-lv3:var(--dsw-static-deepseek-400);--dsh-usage-lv4:var(--dsw-static-deepseek-300)}',
        // ── 页头:标题 + 月份导航 + 刷新 ──────────────────────
        '.dsh-usage-topbar{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap}',
        '.dsh-usage-title{margin:0;font-size:20px;font-weight:600;line-height:28px;color:var(--dsw-alias-label-primary)}',
        '.dsh-usage-subtitle{margin-top:4px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
        '.dsh-usage-nav{position:relative;display:inline-flex;align-items:center;gap:2px;font-variant-numeric:tabular-nums}',
        '.dsh-usage-btn{display:inline-flex;align-items:center;justify-content:center;min-width:30px;min-height:30px;padding:0 6px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1;cursor:pointer;transition:background var(--ds-transition-duration-fast,0.1s) var(--ds-ease-in-out,ease),color var(--ds-transition-duration-fast,0.1s) var(--ds-ease-in-out,ease)}',
        '.dsh-usage-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.dsh-usage-btn:focus-visible,.dsh-usage-cell:focus-visible,.dsh-usage-mbtn:focus-visible{outline:2px solid var(--dsw-static-deepseek-500);outline-offset:1px}',
        '.dsh-usage-month{min-width:92px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
        '.dsh-usage-refresh.is-spinning svg{animation:dsh-usage-spin .9s linear infinite}',
        '@keyframes dsh-usage-spin{to{transform:rotate(360deg)}}',
        // ── 月份选择器浮层 ──────────────────────────────────
        '.dsh-usage-pop{position:absolute;right:0;top:34px;z-index:12;width:196px;padding:10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 24px var(--dsw-alias-bg-mask-2)}',
        '.dsh-usage-yrow{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}',
        '.dsh-usage-yrow span{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}',
        '.dsh-usage-mgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}',
        '.dsh-usage-mbtn{height:28px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}',
        '.dsh-usage-mbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.dsh-usage-mbtn.is-on{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary);font-weight:600}',
        '.dsh-usage-now{display:block;width:100%;margin-top:8px;height:28px;border:0;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}',
        // ── 统计卡 ─────────────────────────────────────────
        '.dsh-usage-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}',
        '.dsh-usage-stat{box-sizing:border-box;padding:14px 16px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}',
        '.dsh-usage-stat-label{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
        '.dsh-usage-stat-value{margin-top:6px;font-size:22px;font-weight:600;letter-spacing:-.02em;line-height:1.15;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}',
        '.dsh-usage-stat-sub{margin-top:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
        '.dsh-usage-skel{display:inline-block;height:22px;width:72px;border-radius:6px;background:var(--dsw-alias-bg-skeleton);animation:dsh-usage-pulse 1.2s ease-in-out infinite}',
        '@keyframes dsh-usage-pulse{0%,100%{opacity:1}50%{opacity:.4}}',
        '@media (prefers-reduced-motion:reduce){.dsh-usage-skel{animation:none}.dsh-usage-refresh.is-spinning svg{animation:none}.dsh-usage-cell{transition:none}.dsh-usage-cell.is-today:after{animation:none}}',
        // ── 面板(热力图 / 明细共用容器)──────────────────────
        '.dsh-usage-panel{box-sizing:border-box;padding:18px 20px;border-radius:16px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}',
        '.dsh-usage-panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}',
        '.dsh-usage-panel-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
        '.dsh-usage-panel-side{font-size:12px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-variant-numeric:tabular-nums}',
        '.dsh-usage-legend{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
        '.dsh-usage-swatch{width:12px;height:12px;border-radius:3px;background:var(--dsh-usage-lv0)}',
        '.dsh-usage-swatch.lv1{background:var(--dsh-usage-lv1)}',
        '.dsh-usage-swatch.lv2{background:var(--dsh-usage-lv2)}',
        '.dsh-usage-swatch.lv3{background:var(--dsh-usage-lv3)}',
        '.dsh-usage-swatch.lv4{background:var(--dsh-usage-lv4)}',
        // ── 热力图 + 近 7 天曲线 并排 ───────────────────────
        '.dsh-usage-heatflex{display:flex;gap:28px;flex-wrap:wrap}',
        '.dsh-usage-heat{flex:none;display:flex;gap:10px;align-items:stretch}',
        '.dsh-usage-wd{display:grid;grid-template-rows:repeat(7,34px);gap:6px}',
        '.dsh-usage-wdl{display:flex;align-items:center;justify-content:center;font-size:11px;line-height:1;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));user-select:none}',
        '.dsh-usage-cells{display:grid;grid-template-rows:repeat(7,34px);gap:6px}',
        '.dsh-usage-cell{position:relative;box-sizing:border-box;width:34px;height:34px;padding:0;border:0;border-radius:6px;background:transparent;cursor:default;font:inherit;font-size:11px;line-height:1;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));transition:transform .16s cubic-bezier(.2,.8,.3,1.4),box-shadow .16s ease}',
        '.dsh-usage-cell.is-void{visibility:hidden;pointer-events:none}',
        '.dsh-usage-cell.lv1{background:var(--dsh-usage-lv1);color:#16245c}',
        '.dsh-usage-cell.lv2{background:var(--dsh-usage-lv2);color:#16245c}',
        '.dsh-usage-cell.lv3{background:var(--dsh-usage-lv3);color:#16245c}',
        '.dsh-usage-cell.lv4{background:var(--dsh-usage-lv4);color:#fff}',
        'body[data-ds-dark-theme] .dsh-usage-cell.lv1{color:#fff}',
        'body[data-ds-dark-theme] .dsh-usage-cell.lv2{color:#fff}',
        'body[data-ds-dark-theme] .dsh-usage-cell.lv4{color:#16245c}',
        '.dsh-usage-cell.is-today{outline:1.5px solid var(--dsw-alias-label-primary);outline-offset:1.5px}',
        '.dsh-usage-cell.is-today:after{content:"";position:absolute;inset:0;border-radius:6px;box-shadow:0 0 0 0 color-mix(in srgb,var(--dsw-alias-label-primary) 35%,transparent);animation:dsh-usage-today 2.6s ease-out 1s infinite;pointer-events:none}',
        '@keyframes dsh-usage-today{70%{box-shadow:0 0 0 5px transparent}100%{box-shadow:0 0 0 0 transparent}}',
        '.dsh-usage-cell:hover:not(.is-void){transform:scale(1.12);z-index:3;box-shadow:0 0 12px color-mix(in srgb,currentColor 35%,transparent)}',
        // ── 近 7 天曲线:平滑贝塞尔 + 面积淡填 + 逐点悬浮 ─────
        '.dsh-usage-curvebox{flex:1;min-width:280px;display:flex;flex-direction:column}',
        '.dsh-usage-curve-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:6px}',
        '.dsh-usage-curve-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
        '.dsh-usage-curve-sum{font-size:11px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-variant-numeric:tabular-nums}',
        '.dsh-usage-curve-body{flex:1;display:flex;align-items:center;min-height:0}',
        '.dsh-usage-curve-svg{width:100%;height:auto;display:block;overflow:visible}',
        '.dsh-usage-curve-line{fill:none;stroke:var(--dsw-alias-state-business-primary);stroke-width:2;stroke-linecap:round}',
        '.dsh-usage-curve-area{fill:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent)}',
        '.dsh-usage-curve-dot{fill:var(--dsw-alias-bg-layer-1);stroke:var(--dsw-alias-state-business-primary);stroke-width:1.6;cursor:pointer}',
        '.dsh-usage-curve-dot:hover{r:5}',
        '.dsh-usage-curve-x{font-size:10px;fill:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-variant-numeric:tabular-nums}',
        // ── 今日明细(分模型):标签 + 条形(同热力图色阶)+ 数值 ──
        '.dsh-usage-rows{display:flex;flex-direction:column;gap:8px}',
        '.dsh-usage-row{display:flex;align-items:center;gap:12px}',
        '.dsh-usage-rowlabel{flex:none;width:132px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.dsh-usage-track{flex:1;min-width:0;height:10px;border-radius:5px;background:var(--dsw-alias-bg-base)}',
        '.dsh-usage-bar{height:100%;border-radius:5px}',
        '.dsh-usage-bar.lv1{background:var(--dsh-usage-lv1)}',
        '.dsh-usage-bar.lv2{background:var(--dsh-usage-lv2)}',
        '.dsh-usage-bar.lv3{background:var(--dsh-usage-lv3)}',
        '.dsh-usage-bar.lv4{background:var(--dsh-usage-lv4)}',
        '.dsh-usage-rowvalue{flex:none;width:76px;text-align:right;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}',
        '.dsh-usage-empty{padding:20px 0 8px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
        // ── 错误条 + 底部峰谷时钟 ───────────────────────────
        '.dsh-usage-error{display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-error-primary);font-size:13px}',
        '.dsh-usage-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:0 4px;font-size:12px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
        '.dsh-usage-dot{width:6px;height:6px;border-radius:50%;flex:none;transition:background .5s linear}',
        '.dsh-usage-clock{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}',
        '.dsh-usage-period{color:var(--dsw-alias-label-secondary)}',
        '.dsh-usage-note{margin-left:auto;text-align:right}',
        '.dsh-usage-tip{position:fixed;z-index:50;pointer-events:none;padding:6px 8px;border-radius:8px;max-width:320px;overflow:hidden;text-overflow:ellipsis;background:var(--dsw-alias-tooltip-bg,rgba(30,32,38,.97));color:var(--dsw-alias-label-primary-inverted,var(--dsw-alias-label-primary-foreground,#f7f8fa));font-size:12px;line-height:16px;box-shadow:0 4px 16px var(--dsw-alias-bg-mask-2);white-space:nowrap}',
        '.dsh-usage-tip-sub{margin-top:2px;font-size:11px;line-height:15px;opacity:.85}',
        'body[data-ds-dark-theme] .dsh-usage-tip{color:var(--dsw-alias-label-primary,#f9fafb)}',
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
      // 用量相对峰值的四档分级(0 = 无用量),热力图/明细条共用
      function levelOf(tokens, max) {
        if (tokens <= 0 || max <= 0) return 0
        const r = tokens / max
        if (r > 0.75) return 4
        if (r > 0.5) return 3
        if (r > 0.25) return 2
        return 1
      }
      // 分项弹窗的第二行:输入/输出/缓存(无 detail 的旧 host 返回 null)
      function partsLine(parts) {
        if (parts === null || parts === undefined) return null
        return '输入 ' + fmtTokens(parts.input) + ' · 输出 ' + fmtTokens(parts.output) + ' · 缓存 ' + fmtTokens(parts.cacheRead)
      }
      // 'provider/model' → 显示用短名(全名进悬浮弹窗)
      function modelLabel(key) {
        const i = key.lastIndexOf('/')
        return i === -1 ? key : key.slice(i + 1)
      }
      const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

      function PeakClock() {
        const [now, setNow] = React.useState(new Date())
        React.useEffect(() => {
          const timer = setInterval(() => setNow(new Date()), 15000)
          return () => clearInterval(timer)
        }, [])
        const period = periodOf(now)
        const bj = beijingParts(now)
        const clockText = String(bj.h).padStart(2, '0') + ':' + String(bj.m).padStart(2, '0')
        return React.createElement(React.Fragment, null, [
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
      function RefreshIcon() {
        return React.createElement('svg', {
          width: 12,
          height: 12,
          viewBox: '0 0 12 12',
          fill: 'none',
          'aria-hidden': 'true',
        }, [
          React.createElement('path', {
            key: 'arc',
            d: 'M10 6a4 4 0 1 1-1.2-2.85',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round',
          }),
          React.createElement('path', {
            key: 'head',
            d: 'M9.9 1v2.4H7.5',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        ])
      }

      // ── 近 7 天曲线:Catmull-Rom 转三次贝塞尔,平滑过点 ──────────
      function UsageCurve({ points, onTip, onTipEnd }) {
        if (points.length < 2) return null
        const W = 360
        const H = 150
        const pad = { l: 10, r: 10, t: 14, b: 24 }
        let max = 0
        for (const p of points) if (p.tokens > max) max = p.tokens
        const span = max <= 0 ? 1 : max
        const stepX = (W - pad.l - pad.r) / (points.length - 1)
        const pts = points.map((p, i) => ({
          key: p.key,
          label: p.label,
          tokens: p.tokens,
          parts: p.parts,
          x: pad.l + i * stepX,
          y: pad.t + (1 - p.tokens / span) * (H - pad.t - pad.b),
        }))
        let d = 'M ' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1)
        for (let i = 0; i < pts.length - 1; i += 1) {
          const p0 = pts[Math.max(0, i - 1)]
          const p1 = pts[i]
          const p2 = pts[i + 1]
          const p3 = pts[Math.min(pts.length - 1, i + 2)]
          const c1x = p1.x + (p2.x - p0.x) / 6
          const c1y = p1.y + (p2.y - p0.y) / 6
          const c2x = p2.x - (p3.x - p1.x) / 6
          const c2y = p2.y - (p3.y - p1.y) / 6
          d += ' C ' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ', ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ', ' + p2.x.toFixed(1) + ' ' + p2.y.toFixed(1)
        }
        const base = H - pad.b
        const area = d + ' L ' + pts[pts.length - 1].x.toFixed(1) + ' ' + base + ' L ' + pts[0].x.toFixed(1) + ' ' + base + ' Z'
        const children = [
          React.createElement('path', { key: 'area', className: 'dsh-usage-curve-area', d: area }),
          React.createElement('path', { key: 'line', className: 'dsh-usage-curve-line', d }),
        ]
        for (const p of pts) {
          children.push(React.createElement('circle', {
            key: p.key,
            className: 'dsh-usage-curve-dot',
            cx: p.x,
            cy: p.y,
            r: 3.5,
            onMouseEnter: (event) => onTip(
              event,
              p.key + ' · ' + (p.tokens > 0 ? fmtTokens(p.tokens) + ' tokens' : '无用量'),
              partsLine(p.parts)
            ),
            onMouseLeave: onTipEnd,
          }))
        }
        for (const p of pts) {
          children.push(React.createElement('text', {
            key: 'x' + p.key,
            className: 'dsh-usage-curve-x',
            x: p.x,
            y: H - 8,
            textAnchor: 'middle',
          }, p.label))
        }
        return React.createElement('svg', {
          className: 'dsh-usage-curve-svg',
          viewBox: '0 0 ' + W + ' ' + H,
          role: 'img',
          'aria-label': '近 7 天用量曲线',
        }, children)
      }

      // ── 用量视图(conversation.view entry)────────────────────────
      function UsageView() {
        const [month, setMonth] = React.useState(monthStr(new Date()))
        const [data, setData] = React.useState(null)
        const [loading, setLoading] = React.useState(true)
        const [error, setError] = React.useState(null)
        const [pickerOpen, setPickerOpen] = React.useState(false)
        const [pickerYear, setPickerYear] = React.useState(new Date().getFullYear())
        const [tip, setTip] = React.useState(null)
        const [tick, setTick] = React.useState(0)
        const pickerRef = React.useRef(null)
        const dataRef = React.useRef(null)
        dataRef.current = data

        // 拉取:月份切换 / 手动刷新 / 60s 自动。查看月份已有数据时静默
        // 刷新(保留旧数不闪骨架);无数据时失败才进错误态。
        React.useEffect(() => {
          let alive = true
          const ctrl = new AbortController()
          const cached = dataRef.current
          if (cached === null || cached.month !== month) setLoading(true)
          fetch('/dizzy/usage?month=' + encodeURIComponent(month), { credentials: 'same-origin', signal: ctrl.signal })
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
              setError(null)
              setLoading(false)
            })
            .catch(() => {
              if (!alive) return
              setLoading(false)
              const held = dataRef.current
              if (held === null || held.month !== month) setError('用量拉取失败')
            })
          return () => {
            alive = false
            ctrl.abort()
          }
        }, [month, tick])

        React.useEffect(() => {
          const timer = setInterval(() => setTick((n) => n + 1), 60000)
          return () => clearInterval(timer)
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

        // 激活即回顶:scrollBody 与对话视图共用,会带着上个视图的滚动位置
        React.useEffect(() => {
          const scroller = document.querySelector('[data-conversation-scroll]')
          if (scroller !== null) scroller.scrollTop = 0
        }, [])

        const parts = month.split('-').map(Number)
        const weeks = monthWeeks(parts[0], parts[1] - 1)
        // 只展示与查看月份匹配的数据:切月瞬间旧月数据立即视为未加载,
        // 同月静默刷新则继续展示旧数直到新数到达
        const viewData = data !== null && data !== undefined && data.month === month ? data : null
        const days = viewData !== null && viewData.days !== null && typeof viewData.days === 'object'
          ? viewData.days
          : null
        // Host 分项版的附加块:逐日分项 / 近 7 天 / 今日分模型
        const detail = viewData !== null && viewData.detail !== null && typeof viewData.detail === 'object'
          ? viewData.detail
          : null
        const dayParts = detail !== null && detail.days !== null && typeof detail.days === 'object'
          ? detail.days
          : null
        let max = 0
        let activeDays = 0
        let peakDay = null
        if (days !== null) {
          for (const key of Object.keys(days)) {
            const value = days[key]
            if (typeof value !== 'number' || value <= 0) continue
            activeDays += 1
            if (value > max) {
              max = value
              peakDay = key
            }
          }
        }
        const todayStr = dayStr(new Date())
        const total = viewData === null ? null : viewData.total ?? 0

        const showTip = (event, title, sub) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const width = 280
          const left = Math.min(
            Math.max(rect.left + rect.width / 2, width / 2 + 8),
            window.innerWidth - width / 2 - 8
          )
          setTip({
            title,
            sub: sub ?? null,
            left: Math.round(left),
            top: Math.round(Math.max(rect.top - 8, 28)),
          })
        }
        const hideTip = () => setTip(null)

        // ── 页头:标题 + 月份导航 + 刷新 ──────────────────────
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
        const subtitle = loading && viewData === null
          ? '正在汇总本地会话…'
          : viewData !== null && typeof viewData.scannedAt === 'number'
            ? '本地会话 token 汇总 · 更新于 ' + new Date(viewData.scannedAt).toLocaleTimeString() + (typeof viewData.errors === 'number' && viewData.errors > 0 ? ' · ⚠ ' + viewData.errors + ' 个日志文件解析失败,用量可能被低估' : '')
            : '本地会话 token 汇总'

        const topbar = React.createElement('div', { key: 'topbar', className: 'dsh-usage-topbar' }, [
          React.createElement('div', { key: 'title' }, [
            React.createElement('h1', { key: 't', className: 'dsh-usage-title' }, '用量'),
            React.createElement('div', { key: 's', className: 'dsh-usage-subtitle' }, subtitle),
          ]),
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
            }, parts[0] + '年' + parts[1] + '月'),
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
            React.createElement('button', {
              key: 'refresh',
              type: 'button',
              className: 'dsh-usage-btn dsh-usage-refresh' + (loading ? ' is-spinning' : ''),
              'aria-label': '刷新',
              title: '刷新',
              onClick: () => setTick((n) => n + 1),
            }, React.createElement(RefreshIcon)),
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
        ])

        // ── 统计卡 ─────────────────────────────────────────
        const statValue = (text) => loading && viewData === null
          ? React.createElement('span', { className: 'dsh-usage-skel', 'aria-hidden': 'true' })
          : text
        const peakLabel = peakDay === null
          ? '—'
          : Number(peakDay.slice(5, 7)) + '月' + Number(peakDay.slice(8, 10)) + '日'
        const stats = React.createElement('div', { key: 'stats', className: 'dsh-usage-stats' }, [
          React.createElement('div', { key: 'total', className: 'dsh-usage-stat' }, [
            React.createElement('div', { key: 'l', className: 'dsh-usage-stat-label' }, '本月合计'),
            React.createElement('div', { key: 'v', className: 'dsh-usage-stat-value' },
              statValue(total === null ? '—' : fmtTokens(total))),
            React.createElement('div', { key: 's', className: 'dsh-usage-stat-sub' }, 'tokens · 本地会话'),
          ]),
          React.createElement('div', { key: 'days', className: 'dsh-usage-stat' }, [
            React.createElement('div', { key: 'l', className: 'dsh-usage-stat-label' }, '活跃天数'),
            React.createElement('div', { key: 'v', className: 'dsh-usage-stat-value' },
              statValue(days === null ? '—' : String(activeDays))),
            React.createElement('div', { key: 's', className: 'dsh-usage-stat-sub' }, '有用量记录的天数'),
          ]),
          React.createElement('div', { key: 'avg', className: 'dsh-usage-stat' }, [
            React.createElement('div', { key: 'l', className: 'dsh-usage-stat-label' }, '活跃日均'),
            React.createElement('div', { key: 'v', className: 'dsh-usage-stat-value' },
              statValue(total === null || activeDays === 0 ? '—' : fmtTokens(Math.round(total / activeDays)))),
            React.createElement('div', { key: 's', className: 'dsh-usage-stat-sub' }, 'tokens / 活跃天'),
          ]),
          React.createElement('div', { key: 'peak', className: 'dsh-usage-stat' }, [
            React.createElement('div', { key: 'l', className: 'dsh-usage-stat-label' }, '峰值日'),
            React.createElement('div', { key: 'v', className: 'dsh-usage-stat-value' },
              statValue(peakDay === null ? '—' : fmtTokens(max))),
            React.createElement('div', { key: 's', className: 'dsh-usage-stat-sub' }, peakLabel),
          ]),
        ])

        // ── 月度热力图 + 近 7 天曲线 ─────────────────────────
        const wd = WEEKDAYS.map((name) => React.createElement('div', {
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
            const level = levelOf(tokens, max)
            const tipTitle = key + ' · ' + (tokens > 0 ? fmtTokens(tokens) + ' tokens' : '无用量')
            const tipSub = partsLine(dayParts === null ? null : dayParts[key])
            heatCells.push(React.createElement('button', {
              key: key,
              type: 'button',
              className: 'dsh-usage-cell' + (level > 0 ? ' lv' + level : '') + (key === todayStr ? ' is-today' : ''),
              'aria-label': tipTitle,
              onMouseEnter: (event) => showTip(event, tipTitle, tipSub),
              onMouseLeave: hideTip,
              onFocus: (event) => showTip(event, tipTitle, tipSub),
              onBlur: hideTip,
            }, String(date.getDate())))
          }
        }
        const legend = React.createElement('div', { key: 'legend', className: 'dsh-usage-legend' }, [
          '少',
          React.createElement('span', { key: 'l1', className: 'dsh-usage-swatch lv1' }),
          React.createElement('span', { key: 'l2', className: 'dsh-usage-swatch lv2' }),
          React.createElement('span', { key: 'l3', className: 'dsh-usage-swatch lv3' }),
          React.createElement('span', { key: 'l4', className: 'dsh-usage-swatch lv4' }),
          '多',
        ])

        // 曲线数据:Host detail.recent7(近 7 天,与查看月无关);
        // 旧 host 退化为查看月内 7 天(本月截至今,其他月取月末)
        let curvePoints
        if (detail !== null && Array.isArray(detail.recent7) && detail.recent7.length === 7) {
          curvePoints = detail.recent7.map((r) => ({
            key: r.date,
            label: Number(r.date.slice(5, 7)) + '/' + Number(r.date.slice(8, 10)),
            tokens: typeof r.total === 'number' ? r.total : 0,
            parts: { input: r.input ?? 0, output: r.output ?? 0, cacheRead: r.cacheRead ?? 0 },
          }))
        } else {
          const isCurrent = month === monthStr(new Date())
          const ref = isCurrent ? new Date() : new Date(parts[0], parts[1], 0)
          curvePoints = []
          for (let i = 6; i >= 0; i -= 1) {
            const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - i)
            const key = dayStr(d)
            curvePoints.push({
              key,
              label: (d.getMonth() + 1) + '/' + d.getDate(),
              tokens: days === null ? 0 : (days[key] ?? 0),
              parts: null,
            })
          }
        }
        let curveSum = 0
        for (const p of curvePoints) curveSum += p.tokens

        const heatPanel = React.createElement('div', { key: 'heat', className: 'dsh-usage-panel' }, [
          React.createElement('div', { key: 'head', className: 'dsh-usage-panel-head' }, [
            React.createElement('span', { key: 't', className: 'dsh-usage-panel-title' }, '月度热力图'),
            legend,
          ]),
          React.createElement('div', { key: 'flex', className: 'dsh-usage-heatflex' }, [
            React.createElement('div', { key: 'heat', className: 'dsh-usage-heat' }, [
              React.createElement('div', { key: 'wd', className: 'dsh-usage-wd' }, wd),
              React.createElement('div', {
                key: 'cells',
                className: 'dsh-usage-cells',
                style: { gridTemplateColumns: 'repeat(' + weeks.length + ', 34px)' },
              }, heatCells),
            ]),
            React.createElement('div', { key: 'curve', className: 'dsh-usage-curvebox' }, [
              React.createElement('div', { key: 'head', className: 'dsh-usage-curve-head' }, [
                React.createElement('span', { key: 't', className: 'dsh-usage-curve-title' }, '近 7 天'),
                React.createElement('span', { key: 's', className: 'dsh-usage-curve-sum' }, '合计 ' + fmtTokens(curveSum)),
              ]),
              React.createElement('div', { key: 'body', className: 'dsh-usage-curve-body' },
                React.createElement(UsageCurve, { points: curvePoints, onTip: showTip, onTipEnd: hideTip })),
            ]),
          ]),
          !loading && total === 0
            ? React.createElement('div', { key: 'empty', className: 'dsh-usage-empty' }, '本月暂无用量记录')
            : null,
        ])

        // ── 今日明细(分模型)─────────────────────────────────
        const today = detail !== null && detail.today !== null && typeof detail.today === 'object'
          ? detail.today
          : null
        const todayModels = today !== null && today.models !== null && typeof today.models === 'object'
          ? today.models
          : {}
        const modelRows = Object.keys(todayModels)
          .map((key) => ({ key, ...todayModels[key] }))
          .filter((row) => typeof row.total === 'number' && row.total > 0)
          .sort((a, b) => b.total - a.total)
        let modelMax = 0
        let todayTotal = 0
        const labelCount = {}
        for (const row of modelRows) {
          if (row.total > modelMax) modelMax = row.total
          todayTotal += row.total
          const short = modelLabel(row.key)
          labelCount[short] = (labelCount[short] ?? 0) + 1
        }
        // 同名模型跨 provider 时显示 'provider / model' 消歧( provider 在前,截断也可辨)
        const displayName = (key) => {
          const short = modelLabel(key)
          return labelCount[short] > 1 ? key.replace('/', ' / ') : short
        }
        let todaySide = null
        if (today !== null && typeof today.date === 'string') {
          const tDate = new Date(today.date + 'T00:00:00')
          todaySide = Number(today.date.slice(5, 7)) + '月' + Number(today.date.slice(8, 10)) + '日 周'
            + WEEKDAYS[(tDate.getDay() + 6) % 7] + ' · 合计 ' + fmtTokens(todayTotal)
        }

        let todayBody
        if (today === null) {
          todayBody = React.createElement('div', { key: 'hint', className: 'dsh-usage-empty' },
            '分模型明细将在 dsh web 重启后可用(Host 半区需重新加载)')
        } else if (modelRows.length === 0) {
          todayBody = React.createElement('div', { key: 'hint', className: 'dsh-usage-empty' }, '今日暂无用量记录')
        } else {
          todayBody = React.createElement('div', { key: 'rows', className: 'dsh-usage-rows' },
            modelRows.map((row) => {
              const level = levelOf(row.total, modelMax)
              const pct = Math.max(2, Math.round((row.total / modelMax) * 100))
              return React.createElement('div', { key: row.key, className: 'dsh-usage-row' }, [
                React.createElement('div', {
                  key: 'd',
                  className: 'dsh-usage-rowlabel',
                  title: row.key,
                  onMouseEnter: (event) => showTip(event, row.key, partsLine(row)),
                  onMouseLeave: hideTip,
                }, displayName(row.key)),
                React.createElement('div', { key: 't', className: 'dsh-usage-track' },
                  React.createElement('div', {
                    className: 'dsh-usage-bar lv' + level,
                    style: { width: pct + '%' },
                  })),
                React.createElement('div', { key: 'v', className: 'dsh-usage-rowvalue' }, fmtTokens(row.total)),
              ])
            }))
        }
        const todayPanel = React.createElement('div', { key: 'today', className: 'dsh-usage-panel' }, [
          React.createElement('div', { key: 'head', className: 'dsh-usage-panel-head' }, [
            React.createElement('span', { key: 't', className: 'dsh-usage-panel-title' }, '今日明细'),
            todaySide === null
              ? null
              : React.createElement('span', { key: 's', className: 'dsh-usage-panel-side' }, todaySide),
          ]),
          todayBody,
        ])

        // ── 错误条 + 底部峰谷时钟 ───────────────────────────
        const errorBar = error === null ? null : React.createElement('div', {
          key: 'error',
          className: 'dsh-usage-error',
          role: 'alert',
        }, [
          React.createElement('span', { key: 'msg' }, error),
          React.createElement('button', {
            key: 'retry',
            type: 'button',
            className: 'dsh-usage-btn',
            onClick: () => {
              setError(null)
              setTick((n) => n + 1)
            },
          }, '重试'),
        ])

        const foot = React.createElement('div', { key: 'foot', className: 'dsh-usage-foot' }, [
          React.createElement(PeakClock, { key: 'clock' }),
          React.createElement('span', { key: 'note', className: 'dsh-usage-note' },
            '统计本地会话日志的 token 消耗,与官方控制台「用量」口径可能不同'),
        ])

        const tipNode = tip === null ? null : React.createElement('div', {
          key: 'tip',
          className: 'dsh-usage-tip',
          role: 'tooltip',
          style: { left: tip.left, top: tip.top, transform: 'translate(-50%, -100%)' },
        }, [
          React.createElement('div', { key: 't' }, tip.title),
          tip.sub === null
            ? null
            : React.createElement('div', { key: 's', className: 'dsh-usage-tip-sub' }, tip.sub),
        ])

        return React.createElement('div', { className: 'dsh-usage-view' }, [
          topbar,
          errorBar,
          stats,
          heatPanel,
          todayPanel,
          foot,
          tipNode,
        ])
      }

      // conversation.view 视图环:chat(0)/轨迹(10)右侧的「用量」Tab。
      // 宿主按 entry 投影 Tab 并只渲染激活视图;卸载时宿主回退 chat。
      slots.inject('conversation.view', () => slots.register(
        {
          name: 'conversation.view',
          id: 'usage',
          order: 20,
          label: '用量',
          registrant: 'dizzy-dsh-usage-card',
        },
        () => React.createElement(UsageView)
      ))

      return () => {
        style.remove()
      }
    }

    exports.apply = apply
    return module.exports
  },
})
