/**
 * dizzy-dsh-kimi-webbridge 插件(Host 端)
 *
 * 把 Kimi WebBridge(本地 daemon + 浏览器扩展)封装为 DSH 原生工具集,
 * 采用渐进式披露(参考 dsh-vision-toolkit 的 exposure 模式):
 *
 *   - 全局仅注册一个引导工具 kimi_browser_activate(所有会话可见);
 *   - 模型调用引导工具后,全套 kimi_browser_* 工具注册进该 agent 的作用域;
 *     live 会话等到 step/end 再 restrict 隐藏引导工具,避免同一步里
 *     仍在飞行的激活调用变成 UNKNOWN_TOOL(与 vision-toolkit 同款);
 *   - agent 销毁时工具随作用域释放。
 *
 * 配置化(与 dsh 官方插件同一模式):
 *   - Config(schemastery)声明可调字段(daemonUrl / daemonTimeoutMs),
 *     loader 挂载时校验并填默认值
 *   - settings 服务在场时注册命名空间 'dizzy-kimi-webbridge':settings.yaml
 *     同名分节热重载,之后的调用即按新值执行
 *   - daemonUrl 默认值是 Kimi WebBridge 官方固定端口(协议缺省),
 *     仅在非标准安装时才需要覆盖
 *
 * 生命周期:每个 agent 的披露状态(states)在 apply 内,属于本 fiber;
 * 模块级只保留纯函数。
 *
 * 封装掉的坑(skill 版 kimi-webbridge 的注意事项):
 *   - session 自动管理:按 DSH 会话 id 生成稳定 session 名,模型无需关心,
 *     避免「切换 session 导致标签组碎片化」;
 *   - Windows 中文编码:走 Node 全局 fetch + UTF-8 JSON,无 curl/临时文件问题;
 *   - daemon 自愈:连接失败时自动 `kimi-webbridge.exe start`(幂等)重试一次;
 *   - 错误归一:ok:false / HTTP 错误 / 扩展未连接都转成可读文本。
 *
 * 依赖:daemon 由 Kimi 官方安装(%USERPROFILE%\.kimi-webbridge\bin\kimi-webbridge.exe),
 * 浏览器扩展需在 Chrome/Edge 安装并连接。能力详情见 ~/.dsh/skills/kimi-webbridge。
 */
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import Schema from 'schemastery'

/** 可调配置(loader 挂载时校验;settings 命名空间复用同一 schema)。 */
const Config = Schema.object({
  /** 本地 daemon 端点(缺省为 Kimi WebBridge 官方固定端口)。 */
  daemonUrl: Schema.string().default('http://127.0.0.1:10086'),
  /** 单次 daemon 调用的超时(毫秒),1s ~ 2min。 */
  daemonTimeoutMs: Schema.number().min(1000).max(120000).default(30000),
})

/** settings.yaml 中本插件的命名空间(规则同官方:/^[a-z][a-z0-9-]*$/)。 */
const SETTINGS_NS = 'dizzy-kimi-webbridge'

/** 引导工具名:激活后从该 agent 的工具目录隐藏。 */
const ACTIVATE_NAME = 'kimi_browser_activate'

/** Windows 上 daemon 可执行文件路径。 */
function daemonExe() {
  return join(homedir(), '.kimi-webbridge', 'bin', 'kimi-webbridge.exe')
}

/** 启动 daemon(start 幂等:已运行则 no-op)。返回是否成功拉起进程。 */
function tryStartDaemon() {
  return new Promise((resolve) => {
    let settled = false
    const done = (ok) => {
      if (!settled) {
        settled = true
        resolve(ok)
      }
    }
    const child = spawn(daemonExe(), ['start'], { stdio: 'ignore', windowsHide: true })
    child.on('error', () => done(false))
    child.on('spawn', () => done(true))
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 调用 daemon 的 POST /command。
 * @param cfg - 当前生效配置(daemonUrl / daemonTimeoutMs)。
 * @param action - WebBridge action 名(navigate/snapshot/click/fill/...)。
 * @param args - action 参数对象。
 * @param session - 标签组会话名。
 * @returns daemon 原始载荷 { ok, data | error };连接失败并自动启动失败时返回错误载荷。
 */
async function callDaemon(cfg, action, args, session) {
  const attempt = async () => {
    const response = await fetch(`${cfg.daemonUrl}/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, args, session }),
      signal: AbortSignal.timeout(cfg.daemonTimeoutMs),
    })
    if (!response.ok) throw new Error(`daemon HTTP ${response.status}`)
    return response.json()
  }
  try {
    return await attempt()
  } catch (error) {
    // 连接失败:尝试自动启动(幂等)后重试一次。
    const started = await tryStartDaemon()
    if (!started) {
      return { ok: false, error: `无法连接 Kimi WebBridge daemon(${cfg.daemonUrl}),且自动启动失败(${error.message})。请确认已安装并启动(见 kimi-webbridge skill 的 operations.md)。` }
    }
    await sleep(800)
    try {
      return await attempt()
    } catch (retryError) {
      return { ok: false, error: `Kimi WebBridge daemon 启动后仍无法连接:${retryError.message}` }
    }
  }
}

/** 该 agent 的稳定标签组会话名(同一会话的所有调用进同一标签组)。 */
function sessionNameOf(exec) {
  const id = exec.agent?.session?.header?.id
  return id === undefined ? 'dsh-task' : `dsh-${String(id).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 16)}`
}

export default {
  name: 'dizzy-dsh-kimi-webbridge',
  inject: ['tools'],
  Config,
  apply(ctx, config) {
    // settings 命名空间:schema 默认值 ← entry config(base) ← settings.yaml
    // 用户层;settings 服务不在场时退回已校验的 entry config,行为不变。
    const settings = ctx.get('settings')
    const scope = settings === undefined
      ? undefined
      : settings.register(SETTINGS_NS, Config, { base: config })
    const current = () => (scope === undefined ? config : scope.get())

    // 每个 agent 的披露状态:属于本 fiber,插件卸载时统一清理。
    const states = new Map()

    /** 业务工具 execute 的公共骨架:调 daemon,错误归一,结果 JSON 化。 */
    const runBrowserAction = async (exec, action, args) => {
      const payload = await callDaemon(current(), action, args ?? {}, sessionNameOf(exec))
      if (payload.ok !== true) {
        const reason = payload.error ?? '未知错误'
        if (typeof reason === 'string' && reason.includes('Please update the Kimi WebBridge extension')) {
          return `kimi_browser_${action} 失败:浏览器扩展版本过旧 —— 请让用户更新 Kimi WebBridge 扩展(https://www.kimi.com/zh-cn/features/webbridge)后重试。`
        }
        if (typeof reason === 'string' && /extension|扩展|not connected|disconnected/i.test(reason)) {
          return `kimi_browser_${action} 失败:浏览器扩展未连接 —— 请让用户检查 Chrome/Edge 的 Kimi WebBridge 扩展是否已启用。${reason}`
        }
        return `kimi_browser_${action} 失败:${reason}`
      }
      return JSON.stringify(payload.data)
    }

    const textOutput = (description) => ({
      schema: { type: 'string', description },
      render(_args, value) {
        return [{ type: 'text', text: String(value) }]
      },
    })

    const navigate = {
      name: 'kimi_browser_navigate',
      description: '在用户的真实浏览器(带登录态)打开页面。首次调用会创建标签组,建议用 groupTitle 给一个可读的任务名;newTab=true 时新开标签(页面需要共存对比时用),否则当前标签直接跳转。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要打开的完整 URL。' },
          newTab: { type: 'boolean', description: 'true 时新开标签页,缺省在当前标签跳转。' },
          groupTitle: { type: 'string', description: '标签组显示名(用户可见),建议用任务相关的可读名称;只在任务的第一次 navigate 传。' },
        },
        required: ['url'],
        additionalProperties: false,
      },
      output: textOutput('导航结果(成功/失败 + 当前 URL 与 tabId)。'),
      async execute(args, exec) {
        return runBrowserAction(exec, 'navigate', args)
      },
    }

    const snapshot = {
      name: 'kimi_browser_snapshot',
      description: '读取当前页面的可访问性树(带 @e 元素引用),用于了解页面内容、定位交互元素。读页面内容优先用本工具;要看视觉效果用 kimi_browser_screenshot。',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output: textOutput('页面 URL、标题与可访问性树(元素带 @e 引用,可直接用于 click/fill 的 selector)。'),
      async execute(args, exec) {
        return runBrowserAction(exec, 'snapshot', {})
      },
    }

    const click = {
      name: 'kimi_browser_click',
      description: '点击页面元素。selector 用 kimi_browser_snapshot 返回的 @e 引用(如 @e123)或 CSS 选择器。',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: '@e 引用或 CSS 选择器。' },
        },
        required: ['selector'],
        additionalProperties: false,
      },
      output: textOutput('点击结果(被点元素的 tag 与文本)。'),
      async execute(args, exec) {
        return runBrowserAction(exec, 'click', args)
      },
    }

    const fill = {
      name: 'kimi_browser_fill',
      description: '向输入框填入文本(清空后填入)。支持 input/textarea 与 contenteditable 富文本编辑器(ProseMirror/Lexical 等)。',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: '@e 引用或 CSS 选择器。' },
          value: { type: 'string', description: '要填入的文本。' },
        },
        required: ['selector', 'value'],
        additionalProperties: false,
      },
      output: textOutput('填充结果(目标标签与模式 value/contenteditable)。'),
      async execute(args, exec) {
        return runBrowserAction(exec, 'fill', args)
      },
    }

    const screenshot = {
      name: 'kimi_browser_screenshot',
      description: '截取当前页面(或指定元素)为图片,返回文件路径。拿到路径后用 read_image / vision_glance 查看图片内容。',
      parameters: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['png', 'jpeg'], description: '图片格式,缺省 png。' },
          quality: { type: 'integer', description: 'jpeg 质量 0-100。' },
          selector: { type: 'string', description: '只截该元素(@e 引用或 CSS)。' },
          path: { type: 'string', description: '自定义输出路径(父目录自动创建,同名覆盖);缺省由 daemon 选临时路径。' },
        },
        additionalProperties: false,
      },
      output: textOutput('截图文件信息 { format, path, sizeBytes, mimeType } —— 用 read_image 查看 path。'),
      async execute(args, exec) {
        return runBrowserAction(exec, 'screenshot', args)
      },
    }

    const findTab = {
      name: 'kimi_browser_find_tab',
      description: '找回本任务之前打开的标签页作为当前标签;active=true 时借用用户正在看的标签页(「用我打开的那个页面」场景)。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '目标标签的完整 URL(从 list_tabs 或 navigate 结果里取)。' },
          active: { type: 'boolean', description: 'true 时借用用户当前正在浏览的标签页。' },
        },
        required: ['url'],
        additionalProperties: false,
      },
      output: textOutput('选中的标签信息 { success, url, tabId, borrowed? }。'),
      async execute(args, exec) {
        return runBrowserAction(exec, 'find_tab', args)
      },
    }

    const listTabs = {
      name: 'kimi_browser_list_tabs',
      description: '列出本任务标签组的所有标签页(url/标题/激活状态),用于找回或确认当前打开的页面。',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output: textOutput('标签列表 [{ tabId, url, title, active, groupTitle }]。'),
      async execute(args, exec) {
        return runBrowserAction(exec, 'list_tabs', {})
      },
    }

    const closeSession = {
      name: 'kimi_browser_close_session',
      description: '关闭本任务打开的所有标签页(整个标签组)。仅在用户明确要求关闭时调用("关掉那些页面" / "清理标签")。',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output: textOutput('关闭的标签页数量。'),
      async execute(args, exec) {
        return runBrowserAction(exec, 'close_session', {})
      },
    }

    const command = {
      name: 'kimi_browser_command',
      description: '通用通道:执行上述工具未覆盖的 WebBridge 操作。evaluate 执行页面 JS(多次调用共享页面作用域,用 IIFE 包裹避免重复声明);cdp 是 chrome.debugger 原语透传;network 抓包(start/stop/list/detail);upload 上传文件;save_as_pdf 把当前页存为 PDF(返回文件路径);close_tab 关闭当前标签。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['evaluate', 'cdp', 'network', 'upload', 'save_as_pdf', 'close_tab'],
            description: '要执行的 WebBridge action。',
          },
          args: {
            type: 'object',
            description: '该 action 的参数对象(见 ~/.dsh/skills/kimi-webbridge 的 SKILL.md;evaluate 传 { code })。',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: textOutput('daemon 原始返回。'),
      async execute(args, exec) {
        return runBrowserAction(exec, String(args.action), args.args ?? {})
      },
    }

    /** 完整业务工具集(激活后注入)。 */
    const BROWSER_TOOLS = [navigate, snapshot, click, fill, screenshot, findTab, listTabs, closeSession, command]

    /**
     * 向一个 agent 注入全套浏览器工具。引导工具的隐藏延到 step/end:
     * DSH 0.1.1-rc.2 起,同一模型步骤里立刻 restrict 会把仍在飞行的
     * kimi_browser_activate 变成 UNKNOWN_TOOL(与 vision-toolkit 同款)。
     * @param agent - 目标 agent。
     * @returns { activated, tools }。
     */
    function activate(agent) {
      const existing = states.get(agent)
      if (existing !== undefined && existing.active) {
        return { activated: false, tools: BROWSER_TOOLS.map((t) => t.name) }
      }
      const disposers = []
      try {
        for (const tool of BROWSER_TOOLS) disposers.push(agent.ctx.tools.register(tool))
      } catch (error) {
        for (const dispose of disposers.reverse()) dispose()
        throw error
      }
      states.set(agent, { active: true, hidden: false, disposers })
      // 非 live 会话(测试/无 sessions 服务)立刻隐藏;生产等到 step/end。
      try {
        if (!isLiveSession(agent)) hideActivation(agent)
      } catch (error) {
        detach(agent)
        throw error
      }
      return { activated: true, tools: BROWSER_TOOLS.map((t) => t.name) }
    }

    function isLiveSession(agent) {
      const sessions = ctx.get('sessions')
      const session = agent.session
      if (sessions === undefined || session === undefined || typeof sessions.get !== 'function') return false
      try {
        return sessions.get(session.id) === session
      } catch {
        return false
      }
    }

    function hideActivation(agent) {
      const state = states.get(agent)
      if (state === undefined || state.hidden) return
      // restrict 成功后再闩 hidden:失败时下次 step/end 还能重试(对齐 vision-toolkit)。
      const lift = agent.ctx.tools.restrict({ deny: [ACTIVATE_NAME] })
      state.hidden = true
      state.disposers.push(lift)
    }

    /** 释放一个 agent 的全部工具注册。 */
    function detach(agent) {
      const state = states.get(agent)
      if (state === undefined) return
      states.delete(agent)
      for (const dispose of state.disposers.reverse()) dispose()
    }

    /** 引导工具:全局可见;调用后注入全套工具并自我隐藏。 */
    const activationTool = {
      name: ACTIVATE_NAME,
      description: '启用 Kimi WebBridge 浏览器控制工具集。调用本工具后你将获得 kimi_browser_navigate / snapshot / click / fill / screenshot / find_tab / list_tabs / close_session / command 全套工具(本引导工具随后消失)。当用户要求打开网页、读取或操作网页内容、填表、截图、抓取页面数据时,先调用本工具。',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output: textOutput('激活结果(已启用的工具名列表)。'),
      async execute(_args, exec) {
        if (exec.agent === undefined) return 'kimi_browser_activate: 需要一个 Agent 会话上下文。'
        return JSON.stringify(activate(exec.agent))
      },
    }

    const disposeActivation = ctx.tools.register(activationTool)
    const onDisposed = ctx.on('agent/disposed', ({ agent }) => {
      detach(agent)
    })
    const onStepEnd = ctx.on('session/event', (session, event) => {
      if (event.type !== 'step/end') return
      for (const [agent, state] of states) {
        if (state.active && !state.hidden && agent.session === session) {
          try {
            hideActivation(agent)
          } catch {
            // agent 已拆掉或引导工具已不在全局层:忽略,随 detach 清理。
          }
        }
      }
    })
    return () => {
      onStepEnd()
      onDisposed()
      disposeActivation()
      for (const state of states.values()) {
        for (const dispose of state.disposers.reverse()) dispose()
      }
      states.clear()
    }
  },
}
