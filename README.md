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
├── index.js              # Host 主插件:数据/工具/定时任务/HTTP 路由
├── client.js             # Client 半区:浏览器 UI(手写 ModuleLoader bundle,免构建)
├── plugins/_template.js  # 参考模板(多插件时拆分子模块)
└── skills/               # 可选:配套技能目录(复制到 ~/.dsh/skills/)
```

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
| 模型工具 / 定时任务 / 数据服务 / HTTP 路由 | 本仓库 bundle 层(Host,全会话共享) |
| 每会话独立的配置(prompt、persona) | agent preset(`~/.dsh/.agent-presets/`) |
| 浏览器 UI(徽章、设置页) | 本仓库 client.js(`dsh.client` 声明) |

**注意**:bundle 层是 Host 平面,插件注册的工具对所有会话可见。
若某插件 `ctx.provide()` 发布服务,服务名不能与其他插件冲突。

## 已收录插件

| 功能 | Host | Client |
|---|---|---|
| DeepSeek 余额查询 | `index.js`:每分钟刷新,`GET /dizzy/balance`,`balance_check` 工具 | `client.js`:`conversation.input.right` 徽章(仅 deepseek-official 显示) |
