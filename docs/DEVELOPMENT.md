# Dizzy-DSH 开发方案

> 本文档是 Dizzy-DSH 的完整开发指南:架构、平面规则、双半区开发流程、
> 关键技术机制、常见坑与验证手段。所有结论均来自本仓库实际踩坑验证,
> 而非纸面推测。

---

## 1. 架构总览

Dizzy-DSH 是一个 **DSH bundle 层插件合集仓库**:"克隆即装",无需 npm 发布,
重启后依然生效。**每个功能 = 一个独立子包插件**(与 third-party 收录的插件
同构):独立 host 插件、独立 client bundle、独立挂载/卸载,互不引用;
主包只是聚合根(依赖声明 + patch 层)。

```
用户机器
├── DSH 安装(dsh CLI / web 服务)
├── profile: ~/.dsh/profiles/web/
│   ├── package.json          # dependencies 含 dizzy-dsh(file: 仓库路径)
│   │                         # bundles 列表含 dizzy-dsh(自动加入)
│   └── node_modules/
│       ├── dizzy-dsh → Junction → store 快照(file: 安装时生成)
│       ├── dizzy-dsh-balance / dizzy-dsh-usage-card /
│       │   dizzy-dsh-agent-instructions   # 自有子包(随主包 file: 依赖安装)
│       └── dsh-better-sidebar / @dsh-external/...  # 收录的第三方
└── 仓库(本目录)
    ├── package.json          # 聚合根:main + dsh.bundle + file: 依赖(plugins/* + 第三方)
    ├── cordis.patch.yml      # bundle 插件层(insert 条目,全部插件在此挂载)
    ├── index.js              # 聚合根空插件(无功能)
    └── plugins/              # 自有插件合集
        ├── balance/          #   dizzy-dsh-balance:package.json + index.js(Host) + client.js(UI)
        ├── usage-card/       #   dizzy-dsh-usage-card:同上
        └── agent-instructions/ # dizzy-dsh-agent-instructions:package.json + index.js + prompts/
```

### 安装与生命周期

```bash
# 一条命令安装全部插件(自有子包 + 收录的第三方插件,见 §7.5)
dsh plugin --profile web add file:<仓库绝对路径>
```

1. `dsh plugin` 转发给 pnpm 在 profile 目录执行安装。**必须用 `file:` 而非
   `link:`**:`link:` 协议下 pnpm 不解析目标包的 `dependencies`(目标目录
   自管依赖,已实测:link 安装的包其依赖一律不进 lockfile/node_modules),
   而 `file:` 会**递归安装完整依赖树**(registry 依赖、file: 依赖全部解析,
   经 profile 的 `nodeLinker: hoisted` 提升到顶层 node_modules)
2. 主插件 `package.json` 的 `dependencies` 声明三个自有子包
   (`file:./plugins/*`)与两个收录的第三方插件(`dsh-better-sidebar@0.10.3`
   走 registry、`@dsh-external/dsh-vision-toolkit` 走仓库快照)—— `file:`
   安装时自动全部带上
3. 安装成功后 reconcile(`plugin-9h8shc4d.js` 的 `reconcilePlugins`):
   **遍历 profile 顶层 `dependencies`**,凡是解析到的包声明了
   `dsh.bundle.patch` 就自动加入 `dsh.profile.bundles` 层列表(顶层只会有
   主插件一个,子包与第三方由主插件 patch 挂载,见第 4 步;
   子包不带 `dsh.bundle.patch`,add 时会提示 "plain dependency",属预期)
4. 下次启动 dsh web 时,loader 读取主插件 bundle 的 `cordis.patch.yml`,
   其中的 `- insert:` 条目列出全部插件行(三个自有子包 + 两个第三方),
   entry 的 name 是包名,从 profile 顶层 node_modules 按包加载:
   - Host 半区:`import('<包名>')` → 包 `main`(index.js)→ 挂载插件
   - Client 半区:`client-modules` 按 entry 的包名扫描 `dsh.client` 声明 +
     `exports["./client"]` → 把该包的 client bundle 注入浏览器
5. 首次安装若遇 `ERR_PNPM_IGNORED_BUILDS`(node-pty/protobufjs 构建脚本):
   pnpm 默认禁止并以非零码退出导致 reconcile 不执行。在 profile 的
   `pnpm-workspace.yaml` 的 `allowBuilds` 里将两者设为 `true` 后重跑
   (pnpm v11 会自动生成占位 `node-pty: set this to true or false`)

**卸载**:`dsh plugin --profile web remove dizzy-dsh`(子包与第三方随依赖一起移除)
**更新**:`cd <仓库> && git pull` 后**强制同步** file: 快照 —— pnpm 对
`file:` 依赖只检测 `package.json` 是否变化,仓库内其他文件(如
`plugins/agent-instructions/prompts/agent-instructions.md`)改了不会同步到
`node_modules` 的安装副本(已实测复现:改 prompt 文件后 `dsh plugin add`
报 "Already up to date",system 里仍是旧内容)。强制同步(主包与每个子包
都要删):

```powershell
Remove-Item ~/.dsh/profiles/web/node_modules/dizzy-dsh -Recurse -Force
Remove-Item ~/.dsh/profiles/web/node_modules/dizzy-dsh-balance -Recurse -Force
Remove-Item ~/.dsh/profiles/web/node_modules/dizzy-dsh-usage-card -Recurse -Force
Remove-Item ~/.dsh/profiles/web/node_modules/dizzy-dsh-agent-instructions -Recurse -Force
dsh plugin --profile web add file:<仓库绝对路径>
```

注入内容动态读取,同步后下一轮对话即生效;改了插件代码才需重启

---

## 2. 平面规则(决定能力放哪)

| 能力 | 位置 | 说明 |
|---|---|---|
| 模型工具、定时任务、数据服务、HTTP 路由 | **对应子包 Host 半区**(bundle 层) | 进程级,全会话共享 |
| 浏览器 UI(徽章、用量视图) | **对应子包 Client 半区**(`dsh.client`) | 随 bundle 持久加载 |
| 每会话独立的配置(prompt、persona、技能集) | agent preset(`~/.dsh/.agent-presets/`) | 每会话独立挂载/卸载 |
| 临时扩展、原型验证 | 动态插件(`cordis_define`) | **进程级,重启即失** |

### 判断准则

- 能力需要**跨会话共享**或**被浏览器访问** → 子包插件(bundle 层)
- 能力只属于"某个会话的 agent 行为" → agent preset
- 能力只是**临时调试/验证** → 动态插件(用完即弃)

> ⚠️ 动态插件的最大局限:进程重启后全部丢失(这正是早期余额徽章
> 重启消失的原因)。任何"希望长期存在"的插件都必须固化为子包。

---

## 3. 双半区开发模型

每个子包插件的形态是"一个包,双半区"(以 usage-card 为例):

```
浏览器 (client.js)                     Host (index.js)
─────────────────                      ─────────────────
用量视图(「用量」Tab)               会话日志聚合(每日 token)
    │  fetch GET /dizzy/usage           │
    │◀───────────────────────────────   ├─ 扫描 ~/.dsh/sessions(增量)
    │                                    └─ webServer 路由 /dizzy/usage
```

### 核心原则

1. **密钥只活在 Host**:浏览器拿不到 API key / 凭据,所有敏感操作留在
   Host 半区,Client 通过同源 HTTP 路由中转。
2. **Client 免构建**:`client.js` 是 `window.__ModuleLoader__.load({ id, factory })`
   工厂格式,`factory` 内的 `require("react")` 由平台 seed 提供,
   **不需要** TypeScript 编译或 bundler 打包,改完即生效。
3. **一功能一子包**:每个功能 = `plugins/<name>/` 独立包(host + client +
   自己的 package.json),主包只聚合;不把新功能塞进既有子包。
4. **改动即提交**:`file:` 是安装时快照语义,仓库即线上代码;`git pull` 后
   删除 profile 里 `node_modules/dizzy-dsh*` 副本并重新
   `dsh plugin add file:<仓库>` 同步,再重启。

---

## 4. Host 半区开发(plugins/<name>/index.js)

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

    // ── 系统提示词注入(可选)────────────────────────────
    const disposePrompt = ctx.systemPrompt.section({
      name: 'dizzy-dsh:agent-instructions',   // 唯一名,重复注册抛错
      order: -50,                              // 负数 → 在 persona(0)之前渲染
      text: () => readFileSync(PROMPT_FILE, 'utf8'),  // 每次组装动态读取
    })

    // ── 清理:停止/卸载时执行 ─────────────────────────
    return () => { disposePrompt(); stopTimer(); stopRoute(); disposeTool() }
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

## 4.5 系统提示词注入(systemPrompt)

对 DSH 系统提示词动手脚的正规入口是 `ctx.systemPrompt` 服务(bundle 层注册
= 全局生效,所有会话、所有工作区都包含):

| 方法 | 作用 | 本仓库用法 |
|---|---|---|
| `section({ name, order, text })` | 注册系统提示词段落,按 order 升序拼接 | `dizzy-dsh:agent-instructions`,order -50 |
| `context({ name, order, text })` | 注册动态上下文(user-role 快照) | 暂未用 |
| `variable(name, provider)` | 注册 `{{variable}}` 插值变量 | 暂未用 |
| `suppressRuntimeContext()` | 抑制动态运行时上下文 | 慎用,勿全局抑制 |
| `tools(provider)` | 注册工具 schema 提供者 | 见 tools.register |

### order 约定(查证 dsh-system-prompt 源码)

```
-100   harness 身份(最先)
-50    ← 本仓库注入的 Agent 规则
 0     persona(部署人格 / agent preset 覆盖)
100+   工具指南
```

负数段在 persona 之前渲染,适合"规则/约束"类内容;`complete: true`
会独占整个系统提示词,绝不用于注入(会覆盖 harness 身份)。

### 内容动态读取

`text` 支持函数,每次模型步骤组装时求值 → 编辑 `prompts/agent-instructions.md`
无需重启,下一个模型步骤即生效:

```js
const disposePrompt = ctx.systemPrompt.section({
  name: 'dizzy-dsh:agent-instructions',
  order: -50,
  text: () => readFileSync(PROMPT_FILE, 'utf8'),
})
```

### 与 DSH 内置 agent-instructions 的分工

| | DSH 内置 agent-instructions | 本仓库注入 |
|---|---|---|
| 注入路径 | user-message(会话历史) | system-prompt section |
| 内容来源 | 工作区的 AGENTS.md/CLAUDE.md | 仓库 prompts/agent-instructions.md |
| 依赖 | 工作区存在该文件 | 全局,不依赖工作区 |
| 优先级 | 作为用户消息 | 系统提示词,模型最先读取 |

两者名字不同、注入路径不同,同时存在不冲突,互补使用。
## 5. Client 半区开发(plugins/<name>/client.js)

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
| `conversation.view` | 会话视图环(本仓库「用量」Tab 挂载点:一 entry 一 Tab,宿主只渲染激活视图;chat=0/trajectory=10,新视图取 order 20) |
| `conversation.session.header.utilities` | 会话页头右侧列表(加法,不替换页头) |
| `conversation.session.header` | **single 槽**,宿主已占 priority 0;占用即替换整条页头,本仓库不用 |
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

## 7. 添加新功能(新子包)的完整流程

```bash
# 0. 建子包目录 plugins/<name>/
#    package.json:name = 包名,声明 main + exports["./client"] + dsh.client
# 1. Host 逻辑 → plugins/<name>/index.js
#    - 数据/工具/路由加入 apply,返回 disposer;name 用子包名

# 2. Client UI(如果需要)→ plugins/<name>/client.js
#    - window.__ModuleLoader__.load({ id: <包名>, ... })
#    - slots.inject 注册目标 Slot
#    - 数据经 ctx.webServer.register 的新路由获取

# 3. 主包 package.json 的 dependencies 加 "包名": "file:./plugins/<name>"
#    cordis.patch.yml 加一行 entry(name = 包名)

# 4. 验证
Remove-Item ~/.dsh/profiles/web/node_modules/dizzy-dsh* -Recurse -Force
dsh plugin --profile web add file:<仓库绝对路径>
dsh --profile web --dump-config          # 新 entry 是否挂载
#    浏览器刷新,检查 UI 是否出现

# 5. 提交
git add -A && git commit -m "feat: ..." && git push
#    用户侧:git pull + 删副本重装 + 重启 dsh web
```

### 验证清单

- [ ] `dsh --dump-config` 输出包含 `# == dizzy-dsh` 段,且该段出现五个
      entry(balance / usage-card / dizzy-agent-instructions / better-sidebar /
      dsh-vision-toolkit)
- [ ] Host:每个子包可加载且 name/inject 正确:
      `node --input-type=module -e "import('dizzy-dsh-balance')"`,
      `import('dizzy-dsh-usage-card')`、`import('dizzy-dsh-agent-instructions')`
- [ ] 收录的第三方可加载(依赖齐全):
      `import('dsh-better-sidebar')` 与
      `import('@dsh-external/dsh-vision-toolkit')` 均不报
      `Cannot find package ...`(link: 安装的典型症状)
- [ ] 每个有 UI 的子包 Client:`exports["./client"]` 指向的文件存在,含
      `window.__ModuleLoader__.load` 且 id 等于包名
- [ ] 浏览器:目标 Slot 出现 UI,数据路由返回正确 JSON
- [ ] 重启 dsh web 后功能仍在(验证持久化)
- [ ] 提示词注入:新会话中系统提示词包含注入规则(可在对话中询问 agent
      是否遵循 First-Principles 等规则验证)

---

## 7.5 收录第三方插件(third-party)

仓库收录他人已做好的 DSH 插件快照,供"克隆即装",同时**明确保留上游
地址与来源标注**。规范:

- 目录:`third-party/<包名>/`,包名与插件 `package.json` 的 `name` 一致
  (如 `DSH-better-sidebar` 对应 `dsh-better-sidebar`)
- 每个目录必须有 `UPSTREAM.md`:`上游仓库`、`收录版本`、`上游 commit`、
  `License`、`收录方式`、`更新方式`、`本地安装` 命令
- **快照不改**:收录内容与上游一致(允许整文件格式层同步),功能修改
  一律提交到上游;本地有未提交补丁时在 UPSTREAM.md 中注明
- 排除 `.git`、`node_modules`、`__pycache__`、`*.tgz`(.gitignore 已兜底)
- README「收录的第三方插件」表格同步登记:插件名 / 上游链接 / 版本 /
  收录位置 / 说明

安装收录的插件**不需要单独 add**:主插件 `package.json` 的 `dependencies`
声明了它们(`dsh-better-sidebar@0.10.3` registry + `@dsh-external/dsh-vision-toolkit`
`file:./third-party/...` 快照),一条 `dsh plugin add file:<仓库>` 全部安装
并随主插件 patch 一起挂载:

```bash
dsh plugin --profile web add file:<仓库>
dsh --profile web --dump-config   # # == dizzy-dsh 段出现三个 entry 行
```

> 已验证(`tmp-file*` 临时 profile 完整实测):`file:` 安装主插件时 pnpm
> 递归解析其 dependencies —— better-sidebar 及其全部运行时依赖
> (ws/codemirror/xterm/node-pty 等)从 registry 安装,vision-toolkit 快照
> 及其依赖 saxes 一并装入,hoisted 提升到顶层 node_modules,三个 entry
> 全部 import 成功、dump-config 全部出现。`link:` 方案则不行(不装依赖,
> better-sidebar 缺 ws 直接 import 失败)。首次安装记得配置
> `pnpm-workspace.yaml` 的 `allowBuilds`(node-pty/protobufjs → true),
> 否则 pnpm 以 `ERR_PNPM_IGNORED_BUILDS` 非零退出、reconcile 不执行。

更新上游快照:重新获取发布包/同步 checkout(见各 UPSTREAM.md),更新版本
与 commit 记录后提交。

---

## 7.6 本月用量视图(usage view)

会话页头的「用量」Tab(`conversation.view` 视图环,列在「对话」「轨迹」
右侧),整页仪表面:统计卡 + 月度热力图与近 7 天曲线 + 今日明细(分模型)+ 北京时间峰谷状态。
主数字是本月合计,热力图/明细/时钟都是次级信息。

| 面 | 实现 |
|---|---|
| 数据 | Host 扫描 `~/.dsh/sessions/**/session.jsonl.zstd`,统计 `assistant/message` 事件的 `data.usage`(`inputTokens+outputTokens+cacheReadTokens`)按本地日期聚合;模型归属取同一事件的 `data.message.source`(provider/model,缺省 `unknown`);增量刷新(文件 mtime+size 变化才重读,30s TTL) |
| 路由 | `GET /dizzy/usage?month=YYYY-MM` → `{ month, days, total, detail, scannedAt, errors }`:`days` 保持「日期 → 总 tokens」(后向兼容),`detail` = `{ days: 逐日 input/output/cacheRead 分项, recent7: 近 7 天(与查看月无关,含零用量天), today: 今日分模型 }`;`errors` > 0 时副标题提示「N 个日志文件解析失败,用量可能被低估」。旧 Host(无 `detail`)下 client 自动退化:弹窗只显总量、今日明细显重启提示 |
| 挂载 | Client 注册 `conversation.view` list 插槽(`id: 'usage'`、`order: 20`、`label: '用量'`;chat=0、trajectory=10)。宿主把每个 entry 投影为页头 Tab,`renderSlot(..., { only: activeId })` 一次只渲染激活视图;选中状态存于宿主每会话 store(`persist: dsh.conversation.chat`),刷新页面保持;插件卸载后宿主 `resolveActiveView` 自动回退 chat。视图是普通整页 React 组件,无需 portal/fixed 定位与可见性守卫 |
| 热力图 | 周一起始 `7 × 周数` 网格(34px 格,行=周一~周日、列=周),格内日期数字;DeepSeek 蓝阶四档(lv1–lv4,按当月峰值比例分档),月外 `visibility:hidden`;今日描边+脉冲;hover/focus 浮层显示日期 + 总量 + 输入/输出/缓存分项 |
| 曲线 | 热力图右侧「近 7 天」用量曲线(detail.recent7):Catmull-Rom 转三次贝塞尔平滑过点 + 面积淡填 + 逐点悬浮读数,SVG viewBox 缩放自适应;旧 Host 退化为查看月内 7 天 |
| 月份切换 | 页头 ‹ › ±1 月;点月份打开年/12 月格 + 「回到本月」;Esc / 点外侧关闭。60s 自动重取 + 手动刷新按钮;数据按 `data.month === 查看月` 判定可见(切月即骨架,旧月数据不串月),同月刷新静默 |
| 时钟 | 独立 `PeakClock`(不拖整页重绘);底栏小圆点 + `HH:MM` + 峰谷标签;色从 `--dsw-static-green-500` / `--dsw-static-red-500` 读 rgb 再渐变 |
| 外观 | 居中栏(max-width 860px),全部吃宿主 `--dsw-*` token(明暗主题跟随);纵向滚动由宿主 scrollBody 提供,视图只管内容流;scrollBody 与对话共用,激活时主动 `scrollTop = 0` 回顶(对话自身有每会话滚动位置存档,不受影响) |

> 注意:DeepSeek 官方 API 无按天用量接口(唯一官方数据源是响应里的
> usage 字段,已由 DSH 落进会话日志),本视图展示的是**本地记录的
> DSH 会话 token 消耗**,与官方控制台「用量」页口径可能不同。
> zstd 多帧解压逻辑复刻自 `@deepseek-ai/dsh-session-persistence-jsonl`
> 的 `scanZstdFrames`(按 block 遍历,不依赖 FCS),插件不能 import
> 该包(profile 的 node_modules 里没有 @deepseek-ai/*)。

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
| `duplicate loader entry id: agent-instructions` | patch 里用了官方已占用的 entry id | 改成 `dizzy-agent-instructions`;官方 id 即使用 `disabled: true` 也仍占着 |
| `single slot "conversation.session.header" already has a registration at priority 0` | 误占宿主 single 槽 | 改挂 `conversation.session.header.utilities`(list);不要用换 priority 去 shadow 整条页头 |

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
