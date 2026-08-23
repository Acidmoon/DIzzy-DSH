# dsh-plugin-memory-tencentdb —— 收录的本地适配层插件

> 本目录是 **TencentDB Agent Memory 的 DSH 适配层快照**，由 Dizzy-DSH
> 收录以便“克隆即装”，并以主插件 `dependencies` 的
> `file:./third-party/dsh-plugin-memory-tencentdb` 依赖随主插件安装。

## 上游信息

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/TencentCloud/TencentDB-Agent-Memory |
| 本地适配层仓库 | /home/Acidmoon/Coding/dsh-plugin-memory-tencentdb（commit `9e8aa6f`） |
| 收录版本 | `0.1.0` |
| License | MIT |
| 功能 | 个人长期记忆（L0-L3）+ LLM-Wiki + CodeGraph；自动捕获/召回/画像注入；conversation.view「记忆」页；MemoryCore / MemoryKnowledge sidecar 托管 |

## 收录说明

- 本插件是本地编写的 DSH 适配层，底层引擎来自
  [TencentCloud/TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)
  的 `MemoryCore` 与 `MemoryKnowledge`，引擎源码不在本快照内；
- sidecar 启动路径由主插件 `cordis.patch.yml` 中 `memory-tencentdb` entry
  的 `runtime.gatewayDir` / `runtime.knowledgeDir` 配置，当前指向本机
  `/home/Acidmoon/Coding/TencentDB-Agent-Memory` 源码 checkout；
- 包自带 `dsh.bundle.patch`，但合集安装时它不会作为独立 bundle 生效；
  挂载由主插件 `cordis.patch.yml` 的 entry（id `memory-tencentdb`）完成。

## 更新方式

```bash
# 从本地适配层仓库覆盖本目录
tar -C /home/Acidmoon/Coding/dsh-plugin-memory-tencentdb \
  --exclude=.git --exclude=node_modules --exclude=package-lock.json \
  -cf - . | tar -C third-party/dsh-plugin-memory-tencentdb -xf -
# 保留本 UPSTREAM.md 不被覆盖；同步核对主插件 cordis.patch.yml 的 entry config
# 并更新 docs/THIRD-PARTY-SNAPSHOTS.md 与 docs/THIRD-PARTY-UPDATE.md
```

## 本地安装

本插件无需单独安装：它是主插件 `dizzy-dsh` 的 `package.json`
`dependencies` 声明（`"dsh-plugin-memory-tencentdb": "file:./third-party/dsh-plugin-memory-tencentdb"`），
安装主插件时随依赖自动装入：

```bash
dsh plugin --profile web add file:<仓库绝对路径>
```

重启 `dsh web` 生效；打开任意会话后进入「记忆」页签。卸载随主插件
`remove dizzy-dsh` 一起移除。
