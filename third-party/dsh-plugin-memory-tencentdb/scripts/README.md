# 运维脚本

- `dsh-restart.sh`：重启 DSH Web（记忆/知识 sidecar 由插件自身随 DSH 启停）。
- `tdai-memory-gateway.sh` / `tdai-memory-knowledge.sh`：手工兜底脚本。
  默认由 `runtime.manageSidecars=true` 托管，通常无需使用。
