# Dizzy-DSH 开发方案

> 本文档是 Dizzy-DSH 的完整开发指南:架构、平面规则、双半区开发流程、
> 关键技术机制、常见坑与验证手段。所有结论均来自本仓库实际踩坑验证,
> 而非纸面推测。

---

## 1. 架构总览

Dizzy-DSH 是一个 **DSH bundle 层插件仓库**:"克隆即装",无需 npm 发布,
重启后依然生效。

```
用户机器
├── DSH 安装(dsh CLI / web 服务)
├── profile: ~/.dsh/profiles/web/
│   ├── package.json          # dependencies 含 dizzy-dsh(link: 仓库路径)
│   │                         # bundles 列表含 dizzy-dsh(自动加入)
│   └── node_modules/dizzy-dsh → Junction → 你的仓库目录
└── 仓库(本目录)
    ├── package.json          # 包声明:main + exports + dsh.bundle + dsh.client
    ├── cordis.patch.yml      # bundle 插件层(insert 条目)
    ├── index.js              # Host 半区(完整 Node 环境)
    └── client.js             # Client 半区(浏览器,免构建 ModuleLoader bundle)
```

### 安装与生命周期

```bash
dsh plugin --profile web add link:<仓库绝对路径>
```

1. `dsh plugin` 转发给 pnpm 在 profile 目录执行安装(link: 保留仓库原位)
2. 包声明了 `dsh.bundle.patch`,DSH **自动**把包加入
   `dsh.profile.bundles` 层列表(无需手动编辑)
3. 下次启动 dsh web 时,loader 读取 `cordis.patch.yml` 的 `- insert:` 条目,
   entry 的 name 是包名 `dizzy-dsh`,按包加载:
   - Host 半区:`import('dizzy-dsh')` → 包 `main`(index.js)→ 挂载插件
   - Client 半区:`client-modules` 按包名扫描 `dsh.client` 声明 +
     `exports["./client"]` → 把 client.js 注入浏览器

**卸载**:`dsh plugin --profile web remove dizzy-dsh`
**更新**:`cd <仓库> && git pull`(link: 方式无需重装),重启生效

---

## 2. 平面规则(决定能力放哪)

| 能力 | 位置 | 说明 |
|---|---|---|
| 模型工具、定时任务、数据服务、HTTP 路由 | **本仓库 Host 半区**(bundle 层) | 进程级,全会话共享 |
| 浏览器 UI(徽章、设置页) | **本仓库 Client 半区**(`dsh.client`) | 随 bundle 持久加载 |
| 每会话独立的配置(prompt、persona、技能集) | agent preset(`~/.dsh/.agent-presets/`) | 每会话独立挂载/卸载 |
| 临时扩展、原型验证 | 动态插件(`cordis_define`) | **进程级,重启即失** |

### 判断准则

- 能力需要**跨会话共享**或**被浏览器访问** → bundle 层(本仓库)
- 能力只属于"某个会话的 agent 行为" → agent preset
- 能力只是**临时调试/验证** → 动态插件(用完即弃)

> ⚠️ 动态插件的最大局限:进程重启后全部丢失(这正是早期余额徽章
> 重启消失的原因)。任何"希望长期存在"的插件都必须固化为 bundle 层。

---

## 3. 双半区开发模型

本仓库的插件形态是"一个包,双半区":

```
浏览器 (client.js)                     Host (index.js)
─────────────────                      ─────────────────
输入栏徽章 / 设置页                     余额缓存(每分钟刷新)
    │  fetch GET /dizzy/balance          │
    │◀───────────────────────────────   ├─ credentials.resolve('DEEPSEEK_API_KEY')
    │                                    ├─ fetch('https://api.deepseek.com/user/balance')
    └── modelDirectories 服务 ◀── 模型    └─ webServer 路由 / tools 注册
```

### 核心原则

1. **密钥只活在 Host**:浏览器拿不到 API key / 凭据,所有敏感操作留在
   Host 半区,Client 通过同源 HTTP 路由中转。
2. **Client 免构建**:`client.js` 是 `window.__ModuleLoader__.load({ id, factory })`
   工厂格式,`factory` 内的 `require("react")` 由平台 seed 提供,
   **不需要** TypeScript 编译或 bundler 打包,改完即生效。
3. **改动即提交**:link: 安装方式下仓库即线上代码,`git pull` + 重启即更新。

---

## 4. Host 半区开发(index.js)

### 插件骨架

```js
export default {
  name: 'dizzy-dsh',
  inject: ['credentials', 'timer', 'tools', 'webServer'], // 按需声明
  apply(ctx) {
    // ── 初始化 / 定时任务 ─────────────────────────────
    const refresh = async () => { /* ... */ }
    refresh()
    const stopTimer = ctx.interval(refresh, 60000)   // 60s 一次

    // ── HTTP 路由(供 Client 半区取数)─────────────────
    const stopRoute = ctx.webServer.register({
      kind: 'exact',                                   // exact | prefixes
      path: '/dizzy/balance',
      handler: async (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(cache))
      },
    })

    // ── 模型可见工具 ─────────────────────────────────
    const disposeTool = ctx.tools.register({
      name: 'balance_check',
      description: '...',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: { type: 'string' },
        render(_args, value) { return [{ type: 'text', text: String(value) }] },
      },
      async execute() { return '结果' },
    })

    // ── 清理:停止/卸载时执行 ─────────────────────────
    return () => { stopTimer(); stopRoute(); disposeTool() }
  },
}
```

### 可注入服务(先查询再使用)

写代码前用 `cordis_inspect_query`(Host Service provider)确认签名:

```text
Service.listService { }               → 服务目录
Service.listService { service: "x" }  → 精确契约
```

常用服务:credentials / timer / tools / webServer / fs / shell / subprocess /
settings / agentDefaultModel / llm。

### 静态插件 vs 动态插件的环境差异

| 能力 | 静态插件(bundle) | 动态插件(沙箱) |
|---|---|---|
| 全局 `fetch` | ✅ 直接可用 | ❌ 被禁用(提示走 ctx.web) |
| `import` 其他包 | ✅ Node ESM 可用 | ❌ 沙箱禁用 |
| 生命周期 | 随 profile 持久 | 进程重启即失 |
| 网络/进程 | 直接用 | 必须经服务中转 |

> 早期余额插件在动态沙箱里被迫用 `subprocess` + `curl.exe` 绕行,
> 且环境变量名撞上 `SENSITIVE_ENV_PATTERN`(`/KEY|PASSWORD|SECRET|TOKEN/i`)
> 被 scrub 导致 401。固化到 bundle 后一行 `fetch` 解决 ——
> **新功能优先写成 bundle 静态插件,不要从动态插件起步。**

---

## 5. Client 半区开发(client.js)

### 免构建 ModuleLoader bundle 骨架

```js
window.__ModuleLoader__.load({
  id: 'dizzy-dsh',              // 必须等于 entry 的包名
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')   // 平台 seed,免 import

    const apply = (ctx) => {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      // 注册 Slot UI(先 cordis_inspect_query 查 Slots.listSubTree)
      slots.inject('conversation.input.right', () => slots.register(
        { name: 'conversation.input.right', id: 'deepseek-balance', label: 'DeepSeek 余额' },
        (props) => React.createElement(Badge, props)
      ))
      return () => { /* 清理 */ }
    }

    exports.apply = apply
    return module.exports
  },
})
```

### 组件内取数(经 Host 路由)

```js
// 浏览器真实环境:fetch / setInterval 全局可用(非动态守卫)
const response = await fetch('/dizzy/balance', { credentials: 'same-origin' })
const r = await response.json()
const timer = setInterval(load, 60000)
// 清理:return () => { clearInterval(timer) }
```

### Slot 选择

用 `cordis_inspect_query`(Client Slots provider)`listSubTree` 查实时插槽树,
再对精确 root 查完整契约(ownerProps / registration / occupants)。常用:

| Slot | 用途 |
|---|---|
| `conversation.input.right` | 输入栏模型选择器左侧(本仓库徽章位置) |
| `conversation.input.left` | 输入栏工具行左侧 |
| `conversation.composer.dock` | 输入栏下方状态行 |
| `settings.section` | 设置页(完整页面) |
| `tool.view.cordis` | 动态插件 Run 卡片内交互区 |

### Client 端依赖声明

`package.json` 的 `dsh.client.inject` 控制 client bundle 的**加载顺序依赖**
(不是服务注入):

```json
"dsh": {
  "client": {
    "platform": "web",
    "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-conversation"]
  }
}
```

如果新 UI 依赖其他 client 包的 Slot/服务,按需追加(先查
`cordis_inspect_list` 确认 client 服务是否存在)。

---

## 6. 关键技术机制(踩坑总结)

### 6.1 loader 相对/包名解析

- entry `name` 以 `.` 开头 → 相对组合文件目录解析(`new URL(name, baseUrl)`)
- entry `name` 是包名 → 从 profile 的 node_modules 解析
- **bundle 层 entry 必须用包名**(`dizzy-dsh`),不能是
  `dizzy-dsh/plugins/x.js` 子路径 —— client-modules 按 entry 名解析
  `require.resolve(<entryName>/package.json)` 找包声明,
  子路径会导致解析失败、client 半区不加载。

### 6.2 ESM 声明

`package.json` 必须有 `"type": "module"`(或插件文件用 `.mjs`),
否则 Node 把 `.js` 当 CJS,`export default` 直接语法错误。

### 6.3 环境变量 scrub

subprocess 会剔除环境中的 `KEY|PASSWORD|SECRET|TOKEN` 命名的变量和全部
`DSH_*` 前缀变量。**不要把敏感值放环境变量传给子进程**;直接用
credentials 服务 + 全局 fetch,或显式 argv 传参。

### 6.4 webServer 路由契约

```js
ctx.webServer.register({
  kind: 'exact',        // exact(精确路径)或 prefixes(前缀,最长匹配)
  path: '/dizzy/balance',
  handler: async (req, res) => { ... },  // node:http 风格
})
// 返回 disposer;重复 (kind, path) 抛错
```

### 6.5 client-modules 扫描链

```
loader entry(name=包名) → require.resolve(包名/package.json)
  → dsh.client.platform === 'web'
  → exports["./client"] → 读 bundle 文件(缺失抛 MissingClientBundleError)
  → 注入浏览器 window.__DSH_BOOT__ → ModuleLoader 加载
```

---

## 7. 添加新功能的完整流程

```bash
# 1. Host 逻辑 → index.js(或拆子模块 import)
#    - 数据/工具/路由加入 apply,返回 disposer

# 2. Client UI(如果需要)→ client.js
#    - slots.inject 注册目标 Slot
#    - 数据经 ctx.webServer.register 的新路由获取

# 3. 验证
dsh --profile web --dump-config          # entry 是否挂载
#    浏览器刷新,检查 UI 是否出现

# 4. 提交
git add -A && git commit -m "feat: ..." && git push
#    用户侧:git pull + 重启 dsh web
```

### 验证清单

- [ ] `dsh --dump-config` 输出包含 `# == dizzy-dsh` 与 entry 行
- [ ] Host:`node --input-type=module -e "import('dizzy-dsh')"` 可加载,
      name/inject 正确
- [ ] Client:`exports["./client"]` 指向的文件存在,含
      `window.__ModuleLoader__.load` 且 id 等于包名
- [ ] 浏览器:目标 Slot 出现 UI,数据路由返回正确 JSON
- [ ] 重启 dsh web 后功能仍在(验证持久化)

---

## 8. 常见问题排查

| 症状 | 原因 | 处理 |
|---|---|---|
| 重启后功能消失 | 动态插件(进程级) | 固化为 bundle 层 |
| 客户端 UI 不加载 | entry name 不是包名 / `exports["./client"]` 缺失 / client.js 文件缺失 | 对照 §6.5 扫描链逐环检查 |
| `export default` 语法错误 | 缺 `"type": "module"` | package.json 补声明 |
| 余额显示 `…` 不更新 | Host 路由未注册 / 缓存未刷新 | 检查 webServer 路由与 interval |
| 401 授权失败 | 敏感 env 被 scrub / key 未配置 | 用 credentials + fetch,检查 `DEEPSEEK_API_KEY` |
| patch 不生效 | 改完没重启 / link 指向旧路径 | 重启 dsh web;确认 bundles 列表 |
| 重复路由报错 | (kind, path) 重复注册 | 换路径或复用已有注册 |

---

## 9. 与动态插件 / agent preset 的协作

- **动态插件**仍可用于:临时调试、原型验证、需要审批流程的交互式工具
  (`tool.view.cordis` 面板)。成熟后固化进本仓库。
- **agent preset**(`~/.dsh/.agent-presets/`):管理 persona、每会话工具集、
  技能目录。本仓库是 Host 平面;两者互补,不冲突。
- 本仓库插件发布服务时,服务名全局唯一(进程级注册表),避免与
  profile 其他 bundle 撞名。

---

*文档版本:1.0(2026-08)。所有机制均经实际验证;修改架构前请先在
`cordis_inspect_query` 确认当前运行时契约,再更新本文档。*
