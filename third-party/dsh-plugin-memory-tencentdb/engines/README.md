# 内置 sidecar 引擎

本目录是 [TencentCloud/TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)
的 **稀疏快照**，让 Dizzy-DSH 换机即用，不再依赖开发机绝对路径。

| 子目录 | 作用 | 默认端口 |
|---|---|---|
| `MemoryCore/` | 个人对话记忆 L0–L3 | 8420 |
| `MemoryKnowledge/` | LLM-Wiki + CodeGraph | 8421 |

- 上游分支：`feat/server_team`
- 上游 commit：`97f9465`（完整 hash `97f94654280b2932c35ba4806a491999ed244cc9`）
- 许可：见 `LICENSE-TencentDB-Agent-Memory`
- **不收录** MemoryPanel / MemoryProxy / `assets/` / `hermes-plugin` / `openclaw-plugin` / Knowledge 的 `docker/` 与内网 `start.sh`
- `node_modules/` 与 `dist/` 不入库；sidecar 首次启动只对**本目录**执行 `npm install`（不走 pnpm postinstall，避免 file: 包被 allowBuilds 拦住）
- 本地补丁：Knowledge 默认绑定 `127.0.0.1`；`tsx` 放进 MemoryKnowledge `dependencies`（上游是 devDependency）

覆盖路径（可选）写在 `settings.yaml` 的 `tdai-memory.runtime.gatewayDir` /
`knowledgeDir`。留空即用本目录。
