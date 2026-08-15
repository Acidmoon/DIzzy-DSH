---
name: dizzy-diy
description: DIY 模式主技能——DSH 造物总入口。当用户要创建/修改/调试 DSH 插件、给 DSH 或 Dizzy-DSH 合集加能力（模型工具 / 浏览器 UI / 徽章 / 视图 / 定时任务 / HTTP 路由 / 提示词注入）、制作 agent preset 或技能、把临时原型固化成持久插件、或问「这个能力该做成什么」时使用。提供四条造物路径的决策表与完整工作流。
---

# DIY 模式：DSH 造物总入口

DSH 里「万物皆插件」，但造物有四条路径。**选错路径是最常见的返工来源**——
典型案例：用动态插件做长期功能，进程重启即失（合集早期的余额徽章就踩过）。
先查决策表，再动手。

## 0. 路径决策表

| 用户要的东西 | 路径 | 持久性 | 生效方式 |
|---|---|---|---|
| 探测运行时 / 验证原型 / 一次性工具或 UI / 需要审批交互的临时面板 | **A. 动态 Cordis 插件** | 进程级，重启即失（设计如此） | 另开官方「创造模式」会话，用 `cordis_define` + `cordis_run` |
| 长期能力：模型工具、徽章、会话视图、定时任务、HTTP 路由、提示词注入 | **B. Dizzy-DSH 持久子包** | 随 profile 持久，重启仍在 | 改仓库 → 删副本重装 → 重启 + 硬刷新 |
| 一套会话级行为：人格 + 工具集 + 技能目录（一个「模式」） | **C. agent preset** | 持久，新会话下拉可选 | 装到 `~/.dsh/.agent-presets/`，重启后选用 |
| 教 agent「何时用、怎么用」（行为而非能力） | **D. 技能** | 持久 | 复制到 `~/.dsh/skills/` 即用 |

判断准则（与合集 `docs/DEVELOPMENT.md` §2 一致）：

- 能力需要**跨会话共享**或**被浏览器访问** → 路径 B；
- 能力只属于「某类会话的 agent 行为」 → 路径 C 或 D；
- 能力只是**临时调试/验证** → 路径 A（创造模式），成熟后固化为 B；
- ⚠️ 任何「希望长期存在」的功能**绝不**停在路径 A。

四条路径互补不冲突：宿主层（合集子包）提供能力，preset 选择能力，
技能教导用法，动态插件做试验田。路径 A 的工具只在官方创造模式里；
本预设负责 B / C / D，可以和创造模式同进程同时开着。

## 1. 路径 A：动态 Cordis 插件（临时）

> ⚠️ **本会话没有 `cordis_*` 工具，也不要加载 `cordis-plugin-development`
> 当操作手册。** DIY 与官方创造模式解耦：动态插件工具集只挂在创造模式，
> 避免两个 preset 同进程抢 `cordisInspect` 单例。用户要探测活运行时时，
> 请他们**另开创造模式会话**，在那边加载 `cordis-plugin-development` 再走
> `cordis_inspect_*` → `cordis_define` → `cordis_run`。本会话只走路径 B / C / D。

路径 A 在创造模式里的压缩版（仅供向用户说明，本会话不要执行）：

1. 创造模式会话里 `cordis_inspect_list` 拿 Host/Client Provider 目录；
2. `cordis_inspect_query` 查要用到的 Service / Event / Builtin / Slot / Theme 的
   **精确**契约——不猜 API，目录只确认能力存在，业务调用走真实 Service；
3. 写 **plain JavaScript** 函数体（无 import / require / TS 类型 / JSX / 未确认的
   全局；Client 侧 React 一律 `React.createElement`），`cordis_define` 定义；
4. `cordis_run` 激活：首次/重启/回滚用 `run`，切版本用 `update`；
   `awaiting-approval` 和 `starting` 都是异步状态，不当成功，等系统回报；
5. 技术失败：`cordis_inspect_self(pluginId, packageId)` 读源码与诊断，
   **同一 Plugin 追加新 Package** 修复后重试，绝不另起同名新 Plugin；
   用户拒绝审批后不再重复请求。

环境差异（与路径 B 对比，均实测）：

| 能力 | 动态插件（沙箱） | 持久子包（bundle） |
|---|---|---|
| 全局 `fetch` / `import` 其他包 | ❌ 禁用，经 Service 中转（如 `ctx.web`） | ✅ Node ESM 直接用 |
| 定时器 | ❌ 无全局；`inject: ['timer']` 后用 `ctx.timeout/interval` | ✅ Node 环境 |
| 网络/进程 | 必须经服务中转 | 直接用 |
| 生命周期 | 进程重启即失 | 随 profile 持久 |

铁律：一切副作用走 `ctx.effect()` / `ctx.on()` / 返回 disposer 的官方 API，
stop/update 时自动回卷；可选服务用 `ctx.get(name)` 并处理 undefined，
`ctx.serviceName` 只在声明 `inject` 后访问；Client UI 必须注册进查过的 Slot，
`apply()` 不能直接返回 React 元素。

## 2. 路径 B：Dizzy-DSH 持久子包（bundle 层）

合集仓库 = bundle 层（`dsh plugin --profile web add file:<仓库路径>` 安装），
**一功能一子包**，主包只做聚合。子包解剖：

```text
plugins/<name>/
├── package.json   # name = 包名;type: module;main: index.js;
│                  # 有 UI 时:exports["./client"] + dsh.client 声明
├── index.js       # Host 半区:工具 / 路由 / 定时器 / 提示词注入
└── client.js      # Client 半区(可选):Slot UI,免构建 ModuleLoader 格式
```

Host 骨架要点（完整骨架与可注入服务见仓库 `docs/DEVELOPMENT.md` §4）：

- `export default { name, inject, apply(ctx) }`，`apply` 返回 disposer；
- 工具 `ctx.tools.register({...})`；路由
  `ctx.webServer.register({ kind: 'exact', path, handler })`（重复 (kind, path) 抛错）；
- 提示词注入 `ctx.systemPrompt.section({ name, order: -50, text: () => 动态读取 })`
  ——text 为函数时每步组装求值，改 prompt 文件**下一轮对话即生效**；
- 写代码前对照仓库已有子包与 `docs/DEVELOPMENT.md` 确认服务签名；
  活运行时 `cordis_inspect_query` 只在创造模式。

Client 骨架要点（§5）：`window.__ModuleLoader__.load({ id: <包名>, factory })`；
`require('react')` 由平台 seed 提供，免构建免打包；`slots.inject` 注册目标 Slot
（先查 `Slots.listSubTree`）；组件数据经 Host 路由 `fetch` 同源获取。
密钥只活在 Host，浏览器永远拿不到。

**挂载三步**（§7）：

1. 主包 `package.json` 的 dependencies 加 `"<包名>": "file:./plugins/<name>"`；
2. 主包 `cordis.patch.yml` 的 insert 加 entry——**name 必须是包名**（不是文件
   路径，否则 client 半区解析失败）；id 不得撞官方已占用 id（如
   `agent-instructions`，disabled 也占着，撞了 boot 抛 duplicate loader entry id）；
3. **重装仪式**（pnpm 对 `file:` 依赖只检测 `package.json` 是否变化，不删副本
   就不同步 patch 与子包内容）：

```powershell
Remove-Item ~/.dsh/profiles/web/node_modules/dizzy-dsh* -Recurse -Force
dsh plugin --profile web add file:<仓库绝对路径>
# 重启 dsh web + 浏览器硬刷新(Ctrl+Shift+R)
```

**验证清单**（§7）：`dsh --profile web --dump-config` 出现新 entry；
`node --input-type=module -e "import('<包名>')"` 冒烟可加载；浏览器目标 Slot
出现 UI、数据路由返回正确 JSON；**重启后功能仍在**（持久化确认）。

## 3. 路径 C：agent preset（每会话组合）

preset = 一个目录 + `agent.cordis.yml` + `preset.yml`（name/description），
装到 `~/.dsh/.agent-presets/<id>/`，重启后新会话预设下拉可选。
铁律（详见 `editing-cordis-compositions` 技能快照）：

- **绝不改 shipped preset**（部署自带 standard / code / minimal / cordis，
  升级会覆盖）；要改就复制成新预设再改副本；
- **发服务的行必须包 `isolate` realm**（`true` = 每挂载会话私有实例），否则
  第二个会话挂载即冲突，mount 直接拒绝；纯消费行不要进 realm（会解析到
  host 注册表而什么都拿不到）；
- 平面规则：注册表、沙箱与审批、持久化、模型路由、subagent 注册表及其后端
  永远留在 host composition，preset 只贡献工具、人格、提示词段、技能；
- **验证两步**：① 挂载校验——在**创造模式**会话里写临时动态插件
  `inject: ['agentPresets']` 调 `ctx.agentPresets.standingKeyFor('<id>')`
  （路径 A，本会话做不到）；② 开真实 DIY 会话确认工具目录与提示词——
  `broken` 字段只是形状检查，不算验证。

DIY 模式自己就是例子：仓库 `presets/diy/` →
`scripts/install-diy-preset.ps1` → `~/.dsh/.agent-presets/diy/`。

## 4. 路径 D：技能（行为）

`~/.dsh/skills/<name>/SKILL.md`，复制即用，会话按需加载。技能不注册工具，
只告诉 agent 何时用、怎么用。合集仓库 `skills/` 下的技能照此分发；
preset 自带的技能（如本技能）经 `skill-filesystem` 的 `customSkillDirs`
注册进该 preset 的技能层，只对该 preset 的会话可见。

## 5. 通用铁律

1. **注册即 effect**：一切贡献经 `ctx.effect()` / `ctx.on()` / 返回 disposer 的
   官方 API；卸载时全部自动回卷；
2. **密钥只在 Host**，进 DSH credentials（`~/.dsh/.credentials.yaml` / 设置界面），
   settings 里只放 credential 引用；subprocess 会 scrub
   `KEY|PASSWORD|SECRET|TOKEN` 与 `DSH_*` 环境变量，敏感值别走环境变量传子进程；
3. **bundle 层改动 = 重启 dsh web + 浏览器硬刷新**：web profile 的 HMR 行被
   官方禁用（`dsh-web-app/cordis.patch.yml` 标注 TODO），别指望热重载；
   提示词函数式注入与 `$DSH_HOME/settings.yaml` 是例外（下一轮/热读生效）；
4. 文档随代码同改：README 能力表、`docs/DEVELOPMENT.md`、第三方登记表各归其位；
5. 拿不准运行时契约：持久子包对照仓库已有插件与 `docs/DEVELOPMENT.md`；
   活运行时 inspect 只在创造模式。配置文件里的 `!!js` 表达式只在 plugin
   `config` 与 entry `disabled` 下可用。

## 6. 文档地图

- 合集开发手册：仓库 `docs/DEVELOPMENT.md`（双半区模型、踩坑表、验证清单，
  全部实测；改架构前先查运行时契约再同步更新它）
- 官方文档：https://github.com/deepseek-ai/deepseek-harness/tree/master/docs
  （cordis-primer 入门、cordis-tutorial 教程 1–7、architecture 架构）
- composition 手册：DIY 预设随装的 `editing-cordis-compositions` 快照
  （改 preset / 组合文件时加载；其中「写动态插件做 standingKeyFor」那步
  仍要去创造模式）
- 动态插件手册：`cordis-plugin-development` 快照只给创造模式当操作手册，
  本会话不要加载它来执行 `cordis_*`
