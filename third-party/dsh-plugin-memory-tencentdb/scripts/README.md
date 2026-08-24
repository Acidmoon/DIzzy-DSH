# 运维脚本

- `ensure-engine-deps.mjs`：只为包内 `engines/MemoryCore` 与 `engines/MemoryKnowledge` 执行 `npm install`（sidecar 首次启动会调用；也可手动 `node scripts/ensure-engine-deps.mjs`）。自定义引擎目录不会被安装。
- `dsh-restart.sh`：重启 DSH Web（记忆/知识 sidecar 由插件自身随 DSH 启停）。
- `tdai-memory-gateway.sh` / `tdai-memory-knowledge.sh`：手工兜底；默认读包内 `engines/`，Node 用 `PATH` 上的 `node`。
