/**
 * dizzy-dsh 主包(聚合器)
 *
 * 本包不再承载功能:它是插件合集的聚合根 —— package.json 的
 * dependencies 用 file: 收录 plugins/ 下的自有子包(balance /
 * usage-card / agent-instructions / kimi-webbridge),cordis.patch.yml
 * 统一挂载全部 entry。功能代码见 plugins/<name>/(每个子包独立 host
 * 插件 + 独立 client bundle,互不引用)。
 *
 * 第三方插件(及其 third-party/ 快照与 patches/ 本地补丁)已于 2026-09
 * 全部移除;本合集只分发自己写的插件。
 *
 * 本文件保留一个空插件:保证包可被 import(loader 按包名解析时
 * 主入口必须存在),不注册任何东西。
 */
export default {
  name: 'dizzy-dsh',
  apply() {
    // 无功能:聚合根仅提供 patch 层与依赖声明
  },
}
