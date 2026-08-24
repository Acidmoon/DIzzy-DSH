# dsh-plugin-memory-tencentdb —— DSH 适配层 + 内置引擎

> 本目录是 **TencentDB Agent Memory 的 DSH 适配层**，并由 Dizzy-DSH
> 以主插件 `dependencies` 的
> `file:./third-party/dsh-plugin-memory-tencentdb` 依赖随主插件安装。
> MemoryCore / MemoryKnowledge 源码快照在 `engines/`，换机即用。

## 上游信息

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/TencentCloud/TencentDB-Agent-Memory |
| 上游分支 | `feat/server_team` |
| 引擎 commit | `97f9465`（`97f94654280b2932c35ba4806a491999ed244cc9`） |
| 适配层版本 | `0.1.2` |
| License | MIT（适配层）+ 上游 LICENSE（`engines/LICENSE-TencentDB-Agent-Memory`） |
| 功能 | 个人长期记忆（L0-L3）+ LLM-Wiki + CodeGraph；自动捕获/召回/画像注入；conversation.view「记忆」页；MemoryCore / MemoryKnowledge sidecar 托管 |

## 收录说明

- 适配层是 DSH 客户端：工具、UI、捕获、注入；不修改上游引擎源码。
- 引擎以稀疏快照放在 `engines/MemoryCore` 与 `engines/MemoryKnowledge`。
  **不收录** MemoryPanel、MemoryProxy、`assets/`。
- sidecar 默认 cwd 为上述 `engines/` 目录；`runtime.gatewayDir` /
  `runtime.knowledgeDir` 留空即用内置路径。Node 用 `process.execPath`。
- `node_modules` 不入库。sidecar 首次 spawn 时运行 `scripts/ensure-engine-deps.mjs`
  **只对包内 engines/** 执行 `npm install`（不走 pnpm postinstall，避免 file: 包被 allowBuilds 拦住）。
- 包自带 `dsh.bundle.patch`，合集安装时挂载由主插件 `cordis.patch.yml`
  的 entry（id `memory-tencentdb`）完成。

## 更新方式

```bash
# 1) 稀疏拉取上游 MemoryCore + MemoryKnowledge（必须钉 feat/server_team）
git clone --depth 1 --filter=blob:none --sparse \
  --branch feat/server_team \
  https://github.com/TencentCloud/TencentDB-Agent-Memory.git /tmp/tdai
git -C /tmp/tdai sparse-checkout set MemoryCore MemoryKnowledge LICENSE

# 2) 覆盖 engines/（排除 node_modules / dist）
rsync -a --delete --exclude node_modules --exclude dist --exclude .git \
  --exclude hermes-plugin --exclude openclaw-plugin --exclude openclaw.plugin.json \
  --exclude Dockerfile \
  /tmp/tdai/MemoryCore/ \
  third-party/dsh-plugin-memory-tencentdb/engines/MemoryCore/
rsync -a --delete --exclude node_modules --exclude dist --exclude .git \
  --exclude docker --exclude Dockerfile --exclude docker-compose.yml --exclude start.sh \
  /tmp/tdai/MemoryKnowledge/ \
  third-party/dsh-plugin-memory-tencentdb/engines/MemoryKnowledge/
cp /tmp/tdai/LICENSE \
  third-party/dsh-plugin-memory-tencentdb/engines/LICENSE-TencentDB-Agent-Memory

# 3) 重放合集补丁（Knowledge 绑定 127.0.0.1 + tsx 进 dependencies）
#    在仓库根目录：
node scripts/reapply-third-party-patches.mjs dsh-plugin-memory-tencentdb

# 4) 更新本文件与 docs/THIRD-PARTY-*.md 中的 commit
```

适配层代码仍在本目录 `src/` / `client.js`；不要用上游整仓覆盖适配层。
引擎快照的本地改动必须落在 `patches/dsh-plugin-memory-tencentdb-*.patch`。

## 本地安装

本插件无需单独安装：它是主插件 `dizzy-dsh` 的 `package.json`
`dependencies` 声明，安装主插件时随依赖自动装入：

```bash
dsh plugin --profile web add file:<仓库绝对路径>
```

重启 `dsh web` 生效。卸载随主插件 `remove dizzy-dsh` 一起移除。
CodeGraph 需要本机有 `git`。记忆数据在 `~/.memory-tencentdb/`，不进仓库。
