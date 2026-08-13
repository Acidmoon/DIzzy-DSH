# Dizzy-DSH —— DSH 插件仓库

一个"克隆即装"的 DSH 插件集合,组织方式参考
[oh-my-pi](https://deepwiki.com/can1357/oh-my-pi/3.1-package-structure) 与
[oh-my-opencode](https://deepwiki.com/code-yeongyu/oh-my-opencode/12.1-configuration-schema-reference):
**仓库本身作为一个 DSH bundle 层安装,无需 npm 发布,重启后依然生效。**

> 📖 开发文档:[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) —— 架构、平面规则、
> 双半区开发流程、关键技术机制与常见坑,所有结论均经实际验证。

## 安装(用户侧)

```bash
# 1. 克隆仓库
git clone https://github.com/Acidmoon/DIzzy-DSH.git

# 2. 安装为 web profile 的插件层
dsh plugin --profile web add link:<仓库绝对路径>

# 3. 重启 dsh web,插件生效(含浏览器 UI)
```

卸载:`dsh plugin --profile web remove dizzy-dsh`
更新:`cd <仓库> && git pull`(link: 方式无需重装,重启即生效)

## 原理

`dsh plugin add` 是 DSH 官方的插件安装命令(转发给 pnpm 在 profile 目录安装):

1. `package.json` 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`
2. 安装后 DSH 自动把包加入 profile 的 `dsh.profile.bundles` 层列表
3. 启动时 loader 读取 `cordis.patch.yml`,entry(name = 包名)被挂载:
   - **Host 半区**:按包名 import 包的 `main`(`index.js`)挂载插件
   - **Client 半区**:`client-modules` 按包名扫描 `dsh.client` 声明 +
     `exports["./client"]`,把 `client.js` 注入浏览器

这与 profile 里已有的
`@dsh-external/dsh-vision-toolkit` 完全同构(先例可查)。

## 目录结构

```
Dizzy-DSH/
├── package.json          # name + main + exports["./client"] + dsh.bundle/client 声明
├── cordis.patch.yml      # 插件层:insert 条目列表(entry name = 包名)
├── index.js              # Host 主插件:数据/工具/定时任务/HTTP 路由/系统提示词注入
├── client.js             # Client 半区:浏览器 UI(手写 ModuleLoader bundle,免构建)
├── prompts/
│   └── agent-instructions.md  # 注入系统提示词的 Agent 规则(源自 DSH 的 AGENTS.md)
├── plugins/_template.js  # 参考模板(多插件时拆分子模块)
├── skills/               # 可选:配套技能目录(复制到 ~/.dsh/skills/)
└── third-party/          # 收录的第三方插件快照(见下方章节,每目录含 UPSTREAM.md)
```

## 系统提示词注入(Agent 规则)

Dizzy-DSH 会向 DSH 的系统提示词注入一段 Agent 规则(源自 DeepSeek Harness
项目的 AGENTS.md):First-Principles Coding、No Reinventing The Wheel、
核心 Conventions(注册即副作用 / 判别联合 / waterfall 必须 next() /
模型可见即日志可重建 / 显式优于隐式 / 配置不硬编码)、Adversarial
Self-Review 等。

**注入机制**(已查证 DSH 源码):

| 层 | 机制 |
|---|---|
| 入口 | Host 半区 `index.js` 调用 `ctx.systemPrompt.section({...})` |
| 名称 | `dizzy-dsh:agent-instructions`(唯一,无冲突) |
| 顺序 | `order: -50` —— 在 harness 身份(`-100`)之后、persona(`0`)之前渲染 |
| 内容 | 每次模型步骤组装时**动态读取** `prompts/agent-instructions.md` |
| 生效 | 编辑该文件后**无需重启**,下一次模型步骤即生效 |
| 范围 | bundle 层注册 = 全局 section,所有会话、所有工作区生效 |

系统提示词 sections 按 `order` 升序拼接;负数段在 persona 之前渲染,
因此注入的规则排在模型最优先读取的位置。其他注入点(`context()` 动态
user-role 快照、`variable()` 模板变量)按需使用,当前插件用 `section()`
最直接。

> 与 DSH 内置 `agent-instructions` 的分工:DSH 会自动读取**工作区**的
> AGENTS.md 作为 user-message 注入(仅当工作区存在该文件);
> Dizzy-DSH 注入的是**全局系统提示词段**,不依赖工作区文件 ——
> 两者互补,同时存在也不会冲突(名字不同、注入路径不同)。

## 双半区架构(本仓库的插件形态)

```
浏览器 (client.js)              Host (index.js)
─────────────────              ─────────────────
输入栏徽章 / 设置页  ──fetch──▶  GET /dizzy/balance  余额缓存(每分钟刷新)
    │                           │
    │                           └─ credentials 取 DEEPSEEK_API_KEY
    └── 模型选择状态 ◀──modelDirectories 服务
```

- **浏览器拿不到 API key**:所有密钥操作留在 Host,client 经同源 HTTP 路由中转
- **client.js 免构建**:`window.__ModuleLoader__.load({ id, factory })` 工厂格式,
  `require("react")` 由平台 seed 提供,改完即生效(重启后)
- **重启不丢**:bundle 层随 profile 持久加载 —— 这正是它优于动态插件的地方

## 添加功能

1. **Host 逻辑**:加进 `index.js`(或拆子模块后 import;需 `inject` 的服务先查
   `cordis_inspect_query` 确认签名)
2. **Client UI**:在 `client.js` 的 `apply` 里注册对应 Slot(`slots.inject`),
   数据一律经 host 路由(`ctx.webServer.register`)获取
3. 改动即提交,`git pull` + 重启生效

## 平面规则(重要)

| 能力 | 放哪 |
|---|---|
| 模型工具 / 定时任务 / 数据服务 / HTTP 路由 / **系统提示词注入** | 本仓库 bundle 层(Host,全会话共享) |
| 每会话独立的配置(prompt、persona) | agent preset(`~/.dsh/.agent-presets/`) |
| 浏览器 UI(徽章、设置页) | 本仓库 client.js(`dsh.client` 声明) |

**注意**:bundle 层是 Host 平面,插件注册的工具对所有会话可见。
若某插件 `ctx.provide()` 发布服务,服务名不能与其他插件冲突。

## 收录的第三方插件(Third-party)

本仓库收录社区/官方之外的第三方 DSH 插件快照,全部保留**上游地址**并在本
README 明确标注来源。快照存放在 `third-party/<包名>/`,每个目录内有
`UPSTREAM.md` 记录上游仓库、版本、commit 与更新方式;快照只做同步,不做修改。

| 插件 | 上游仓库 | 版本 | 收录位置 | 说明 |
|---|---|---|---|---|
| dsh-vision-toolkit | [Anionex/dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) | 0.1.2(`8d35621`) | `third-party/dsh-vision-toolkit/` | DSH 视觉工程工具集(`vision_glance` 等),本机已安装(link 指向本地 checkout) |
| dsh-better-sidebar | [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 0.10.3(`efb2e2b`) | `third-party/DSH-better-sidebar/` | VSCode 风格右侧侧边栏:资源管理器 / 编辑器 / 终端 / Git / 浏览器,按会话隔离 |

**安装收录的第三方插件**(与主插件同样的 link: 方式):

```bash
# 示例:安装 dsh-better-sidebar
dsh plugin --profile web add link:<仓库绝对路径>/third-party/DSH-better-sidebar
# 示例:安装 dsh-vision-toolkit(若本机已装可跳过,保持现有 link 即可)
dsh plugin --profile web add link:<仓库绝对路径>/third-party/dsh-vision-toolkit
```

两个插件均自带 `cordis.patch.yml`,安装后自动挂载,无需手改 profile;
重启 `dsh web` 生效。更新方式见各目录的 `UPSTREAM.md`。

## 已收录插件

| 功能 | Host | Client |
|---|---|---|
| DeepSeek 余额查询 | `index.js`:每分钟刷新,`GET /dizzy/balance`,`balance_check` 工具 | `client.js`:`conversation.input.right` 徽章(仅 deepseek-official 显示) |
| Agent 规则注入 | `index.js`:`systemPrompt.section` 注入 `prompts/agent-instructions.md`(源自 DSH 的 AGENTS.md) | — |
