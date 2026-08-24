#!/usr/bin/env bash
# MemoryKnowledge（LLM-Wiki + CodeGraph）个人模式管理器。
# 用法: serve | start | stop | status
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
KS_DIR="${KS_DIR:-$PLUGIN_ROOT/engines/MemoryKnowledge}"
LOG_DIR="$HOME/.dsh/logs"
LOG="$LOG_DIR/tdai-knowledge.log"
PID_FILE="$LOG_DIR/tdai-knowledge.pid"
PORT="${KNOWLEDGE_PORT:-8421}"
HOST="127.0.0.1"
if [ -n "${NODE_BIN:-}" ]; then
  :
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  NODE_BIN="node"
fi

mkdir -p "$LOG_DIR"

read_key() {
  awk '/^[[:space:]]*DEEPSEEK_API_KEY:/{print $2; exit}' "$HOME/.dsh/.credentials.yaml" 2>/dev/null || true
}

export_env() {
  export HOST="$HOST"
  export PORT="$PORT"
  export API_PREFIX="/v3"
  export LOG_LEVEL="info"
  export KNOWLEDGE_DATA_DIR="$HOME/.memory-tencentdb/knowledge"
  export KNOWLEDGE_DB_PATH="$HOME/.memory-tencentdb/knowledge/knowledge.db"
  export KNOWLEDGE_PUBLIC_BASE_URL="http://$HOST:$PORT/v3"
  export TMC_CALLBACK_URL=""
  export LLM_MODE="custom"
  export LLM_PROVIDER="openai"
  export LLM_BASE_URL="https://api.deepseek.com/v1"
  export LLM_API_KEY="$(read_key)"
  export LLM_MODEL="deepseek-chat"
  export LLM_MAX_TOKENS="8192"
  export LLM_TIMEOUT_MS="180000"
}

health() { curl -sf -m 2 "http://$HOST:$PORT/health" >/dev/null 2>&1; }

find_pid() {
  if [ -f "$PID_FILE" ]; then
    local pid; pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then echo "$pid"; return; fi
  fi
  local p cmd
  for p in $(pgrep -f 'MemoryKnowledge.*server.ts' 2>/dev/null || true); do
    cmd=$(tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null || true)
    case "$cmd" in *"server.ts"*) echo "$p"; return ;; esac
  done
}

cmd_serve() {
  if [ -z "$(read_key)" ]; then
    echo "[tdai-knowledge] 未找到 DEEPSEEK_API_KEY，拒绝启动" >&2
    exit 1
  fi
  cd "$KS_DIR"
  export_env
  echo "[tdai-knowledge] serving on $HOST:$PORT (LLM_MODE=custom, model=deepseek-chat)"
  exec "$NODE_BIN" --import tsx src/server.ts
}

cmd_start() {
  if health; then echo "[tdai-knowledge] already running"; return 0; fi
  local old; old=$(find_pid || true)
  if [ -n "${old:-}" ]; then echo "[tdai-knowledge] stale pid=$old, killing"; kill "$old" 2>/dev/null || true; sleep 2; fi
  cmd_serve >> "$LOG" 2>&1 &
  local pid=$!; echo "$pid" > "$PID_FILE"
  for _ in $(seq 1 40); do health && break; sleep 1; done
  if health; then echo "[tdai-knowledge] started pid=$pid"; else echo "[tdai-knowledge] start failed"; tail -n 20 "$LOG" >&2 || true; return 1; fi
}

cmd_stop() {
  local pid; pid=$(find_pid || true)
  if [ -z "${pid:-}" ]; then echo "[tdai-knowledge] not running"; return 0; fi
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "[tdai-knowledge] stopped pid=$pid"
}

cmd_status() {
  if health; then echo "[tdai-knowledge] running: http://$HOST:$PORT"; else echo "[tdai-knowledge] not running"; fi
}

case "${1:-}" in
  serve) cmd_serve ;;
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  *) echo "usage: $0 serve|start|stop|status" >&2; exit 2 ;;
esac
