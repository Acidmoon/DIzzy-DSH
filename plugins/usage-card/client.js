/**
 * dizzy-dsh-usage-card Client 半区 ——【临时置空】
 *
 * 动态插件实验期(2026-08-14):卡片 UI 已改为 Cordis 动态插件注册
 * (浏览器半区,见本目录 dynamic-client.example.js),bundle 只保留
 * host 路由(GET /dizzy/usage)为动态卡片供数,避免双份 UI。
 *
 * 实验结束恢复:bundle UI 用 git 历史版本恢复本文件
 *   git checkout HEAD -- plugins/usage-card/client.js
 * 然后删除 dynamic-client.example.js 与 profile cordis.patch.yml
 * 里的 tool-cordis insert,重装快照。
 */
window.__ModuleLoader__.load({
  id: 'dizzy-dsh-usage-card',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const apply = () => {
      // 无 UI:实验期间 UI 由动态插件提供
    }

    exports.apply = apply
    return module.exports
  },
})
