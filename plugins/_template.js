/**
 * 新插件模板 —— 复制本文件为 plugins/<你的功能名>.js,
 * 然后在 agent.cordis.yml 中加一行:
 *
 *   - id: kit-<功能名>
 *     name: './plugins/<功能名>.js'
 *
 * 规则:
 *   - 每个文件只做一件事(单一职责,可单独 disabled)
 *   - 只消费 Host 组合提供的服务(credentials/timer/fs/tools/web...),
 *     不要在这里发布跨会话共享的服务(那要放 Host 组合或 isolate group)
 *   - 静态插件可用全局 fetch / 完整 Node API,但不要 import 其他 npm 包
 *     (仓库形态下没有 node_modules 可解析,依赖都通过 ctx 服务注入)
 *   - 所有副作用必须可清理:apply 返回 disposer,或使用 ctx.effect()
 */
export default {
  name: 'kit-template',
  inject: ['timer'], // 按需声明;用到 timer 必须声明
  apply(ctx) {
    // ── 初始化(可选)──────────────────────────────────────────────
    // const doThing = async () => { ... }

    // ── 定时任务(可选)────────────────────────────────────────────
    // const stopTimer = ctx.interval(doThing, 60000)

    // ── 注册工具(可选,模型可调用)─────────────────────────────────
    // const disposeTool = ctx.tools.register({
    //   name: 'my_tool',
    //   description: '...',
    //   parameters: { type: 'object', properties: {}, additionalProperties: false },
    //   output: {
    //     schema: { type: 'string' },
    //     render(_args, value) { return [{ type: 'text', text: String(value) }] },
    //   },
    //   async execute(args) { return '结果' },
    // })

    // ── 返回 disposer(停止/卸载时清理)─────────────────────────────
    return () => {
      // stopTimer()
      // disposeTool()
    }
  },
}
