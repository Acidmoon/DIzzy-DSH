# Dizzy-DSH —— DSH 插件仓库

一个"克隆即装"的 DSH 插件集合,组织方式参考
[oh-my-pi](https://deepwiki.com/can1357/oh-my-pi/3.1-package-structure) 与
[oh-my-opencode](https://deepwiki.com/code-yeongyu/oh-my-opencode/12.1-configuration-schema-reference):
**每个独立功能一个插件文件,仓库本身作为一个 DSH bundle 层安装,无需 npm 发布。**

## 安装(用户侧)

```bash
# 1. 克隆仓库
git clone https://github.com/Acidmoon/DIzzy-DSH.git

# 2. 安装为 web profile 的插件层
dsh plugin --profile web add <仓库绝对路径>
#   或者用 link: 前缀保留仓库原位(推荐,git pull 即更新):
dsh plugin --profile web add link:<仓库绝对路径>

# 3. 重启 dsh web,插件生效
```

卸载:`dsh plugin --profile web remove dizzy-dsh`
更新:`cd <仓库> && git pull`(link: 方式无需重装)

## 原理

`dsh plugin add` 是 DSH 官方的插件安装命令(转发给 pnpm 在 profile 目录安装):

1. `package.json` 里声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`
2. 安装后 DSH 自动把本包加入 profile 的 `dsh.profile.bundles` 层列表
3. 启动时 loader 读取 `cordis.patch.yml`,其中的 `- insert:` 条目全部挂载
4. 插件文件经包名子路径加载:`name: 'dizzy-dsh/plugins/balance.js'`

这与你 profile 里已有的
`@dsh-external/dsh-vision-toolkit: link:E:/vibecoding/dsh-vision-toolkit` 是同一机制。

## 目录结构

```
Dizzy-DSH/
├── package.json          # name + type:module + dsh.bundle.patch 声明
├── cordis.patch.yml      # 插件层:insert 条目列表,新增插件在这里登记
├── plugins/
│   ├── balance.js        # 示例:DeepSeek 余额查询(模型工具 balance_check)
│   └── _template.js      # 新插件模板
└── skills/               # 可选:配套技能目录(复制到 ~/.dsh/skills/)
```

## 添加一个插件

1. `cp plugins/_template.js plugins/你的功能.js`
2. 写逻辑:插件运行在**完整 Node 环境**(直接可用 `fetch`、`ctx.tools.register`
   注册模型工具、`ctx.interval` 跑定时任务)。**不要 import 其他 npm 包**,
   依赖都通过 `inject` 注入的 ctx 服务获取。
3. 在 `cordis.patch.yml` 的 insert 列表里加一行:

```yaml
- id: kit-你的功能
  name: 'dizzy-dsh/plugins/你的功能.js'
  disabled: true   # 默认关闭这样标
```

## 平面规则(重要)

| 能力 | 放哪 |
|---|---|
| 模型工具 / 定时任务 / 数据服务 | 本仓库 bundle 层(Host 组合,全会话共享) |
| 每会话独立的配置(prompt、persona) | agent preset(`~/.dsh/.agent-presets/`) |
| 浏览器 UI(输入栏徽章等) | 动态插件,或声明 `dsh.client` 的 npm 包 |

**注意**:bundle 层是 Host 平面,插件注册的工具对所有会话可见。
若某插件 `ctx.provide()` 发布服务,服务名不能与其他插件冲突
(同进程全局注册表);跨会话共享正是放这里的原因。

## 浏览器 UI 怎么办

静态 bundle 插件只做 Host 端。需要 UI 的插件(如余额徽章):
1. **动态插件**(快速):会话内 `cordis_define` 定义 `code.client`,注册到
   对应 Slot(如 `conversation.input.right`),数据经 `harness.handle` 获取。
2. **npm 包**(正式):包声明 `dsh.client` + `exports["./client"]` + 构建 bundle,
   `client-modules` 自动扫描挂载。

本仓库 `plugins/balance.js` 的余额数据层两种 UI 都能复用。

## 已收录插件

| 插件 | 功能 |
|---|---|
| `plugins/balance.js` | DeepSeek 余额查询,每分钟刷新,注册 `balance_check` 工具 |
