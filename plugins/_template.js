/**
 * 新插件模板 —— 在 plugins/ 下建子包,不要直接改本文件:
 *
 *   plugins/<功能名>/
 *     package.json   # name: dizzy-dsh-<功能名>,main: ./index.js,
 *                    # 有浏览器半区时加 exports["./client"] + dsh.client 声明
 *     index.js       # host 半区(本模板内容)
 *     client.js      # 可选,client 半区(ModuleLoader 工厂格式)
 *
 * 然后在合集里登记两处:
 *   1. 主包 package.json 的 dependencies 加 "dizzy-dsh-<功能名>": "file:./plugins/<功能名>"
 *   2. 主包 cordis.patch.yml 的 insert 列表加一行(entry name 必须是【包名】):
 *
 *        - id: <功能名>
 *          name: 'dizzy-dsh-<功能名>'
 *
 * 规则:
 *   - 每个子包只做一件事(单一职责,可在 patch 里单独 disabled)
 *   - 只消费 Host 组合提供的服务(credentials/timer/fs/tools/webServer...),
 *     不要发布跨会话共享的服务(那要放 Host 组合或 isolate group)
 *   - 可调参数必须走 Config(schemastery schema,挂在默认导出对象上),
 *     不要硬编码;settings 服务在场时再注册一个命名空间,让用户层
 *     (~/.dsh/settings.yaml 同名分节)热覆盖、watch 热应用
 *   - 全部可变状态放 apply 内(属于本 fiber);模块级只放纯函数与常量
 *   - 所有副作用必须可清理:apply 返回 disposer,或使用 ctx.effect()
 *   - 依赖 schemastery 等 npm 包时,在该子包 package.json 的 dependencies
 *     里显式声明(安装后由 profile 的 hoisted node_modules 解析)
 */
import Schema from 'schemastery'

const Config = Schema.object({
  // 可调字段示例:intervalMs: Schema.number().min(1000).default(60000),
})

export default {
  name: 'kit-template',
  inject: ['timer'], // 按需声明;用到 timer 必须声明
  Config,
  apply(ctx, config) {
    // ── settings 命名空间(可选,配置热应用)────────────────────────
    // const settings = ctx.get('settings')
    // const scope = settings === undefined
    //   ? undefined
    //   : settings.register('kit-template', Config, { base: config })
    // const current = () => (scope === undefined ? config : scope.get())
    // const stopWatch = scope === undefined ? () => {} : scope.watch((next) => { ... })

    // ── 初始化(可选)──────────────────────────────────────────────
    // const doThing = async () => { ... }

    // ── 定时任务(可选)────────────────────────────────────────────
    // const stopTimer = ctx.interval(doThing, current().intervalMs)

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
      // stopWatch()
      // stopTimer()
      // disposeTool()
    }
  },
}
