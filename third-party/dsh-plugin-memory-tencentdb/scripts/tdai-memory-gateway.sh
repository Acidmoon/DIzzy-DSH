#!/usr/bin/env bash
# TencentDB Agent Memory Gateway 个人模式管理器。
#
# 用法:
#   tdai-memory-gateway.sh serve   # 前台运行（systemd user service 使用）
#   tdai-memory-gateway.sh start   # 后台启动并等待健康
#   tdai-memory-gateway.sh stop    # 停止
#   tdai-memory-gateway.sh status  # 查看状态
#
# 特征:
#   - 自动从 ~/.dsh/.credentials.yaml 读取 DEEPSEEK_API_KEY（不打印）
#   - 日志/PID 持久化在 ~/.dsh/logs（不在 /tmp，重启不丢）
#   - 由 systemd --user 托管后崩溃自动拉起，无需人工干预

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MEMORY_CORE_DIR="${MEMORY_CORE_DIR:-$PLUGIN_ROOT/engines/MemoryCore}"
GATEWAY_CONFIG="${TDAI_GATEWAY_CONFIG:-$MEMORY_CORE_DIR/tdai-gateway.standalone.yaml}"
BASE_URL="${TDAI_LLM_BASE_URL:-https://api.deepseek.com/v1}"
MODEL="${TDAI_LLM_MODEL:-deepseek-chat}"
PROTOCOL="${TDAI_LLM_PROTOCOL:-openai}"
if [ -n "${NODE_BIN:-}" ]; then
  :
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  NODE_BIN="node"
fi
LOG_DIR="$HOME/.dsh/logs"
LOG="$LOG_DIR/tdai-gateway.log"
PID_FILE="$LOG_DIR/tdai-gateway.pid"
PORT="${TDAI_GATEWAY_PORT:-8420}"
HOST="127.0.0.1"

mkdir -p "$LOG_DIR"

read_key() {
  awk '/^[[:space:]]*DEEPSEEK_API_KEY:/{print $2; exit}' "$HOME/.dsh/.credentials.yaml" 2>/dev/null || true
}

export_env() {
  export TDAI_GATEWAY_CONFIG="$GATEWAY_CONFIG"
  export TDAI_GATEWAY_PORT="$PORT"
  export TDAI_GATEWAY_HOST="$HOST"
  export TDAI_GATEWAY_API_KEY="${TDAI_GATEWAY_API_KEY:-local}"
  export TDAI_LLM_BASE_URL="$BASE_URL"
  export TDAI_LLM_API_KEY="$(read_key)"
  export TDAI_LLM_MODEL="$MODEL"
  export TDAI_LLM_PROTOCOL="$PROTOCOL"
}

health() {
  curl -sf -m 2 "http://$HOST:$PORT/health" >/dev/null 2>&1
}

find_pid() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then echo "$pid"; return; fi
  fi
  local p cmd
  for p in $(pgrep -f 'gateway/server.ts' 2>/dev/null || true); do
    cmd=$(tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null || true)
    case "$cmd" in
      *"node --import tsx src/gateway/server.ts"*|*"gateway/server.ts"*) echo "$p"; return ;;
    esac
  done
}

cmd_serve() {
  if [ -z "$(read_key)" ]; then
    echo "[tdai-gateway] 未在 ~/.dsh/.credentials.yaml 找到 DEEPSEEK_API_KEY，拒绝启动" >&2
    exit 1
  fi
  cd "$MEMORY_CORE_DIR"
  export_env
  echo "[tdai-gateway] serving on $HOST:$PORT (model=$MODEL, log=$LOG)"
  exec "$NODE_BIN" --import tsx src/gateway/server.ts
}

cmd_start() {
  if health; then
    echo "[tdai-gateway] already running (http://$HOST:$PORT)"
    return 0
  fi
  local old
  old=$(find_pid || true)
  if [ -n "${old:-}" ]; then
    echo "[tdai-gateway] process exists pid=$old but health failed; killing stale process"
    kill "$old" 2>/dev/null || true
    sleep 2
  fi
  cmd_serve >> "$LOG" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_FILE"
  for _ in $(seq 1 30); do
    health && break
    sleep 1
  done
  if health; then
    echo "[tdai-gateway] started pid=$pid (pidfile=$PID_FILE)"
  else
    echo "[tdai-gateway] start failed, last log:" >&2
    tail -n 20 "$LOG" >&2 || true
    return 1
  fi
}

cmd_stop() {
  local pid
  pid=$(find_pid || true)
  if [ -z "${pid:-}" ]; then
    echo "[tdai-gateway] not running"
    return 0
  fi
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  echo "[tdai-gateway] stopped pid=$pid"
}

cmd_status() {
  if health; then
    echo "[tdai-gateway] running: http://$HOST:$PORT ($(curl -s -m 2 http://$HOST:$PORT/health | head -c 120))"
  else
    echo "[tdai-gateway] not running"
  fi
  local pid
  pid=$(find_pid || true)
  [ -n "${pid:-}" ] && echo "[tdai-gateway] pid=$pid" || true
}

case "${1:-}" in
  serve) cmd_serve ;;
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  *) echo "usage: $0 serve|start|stop|status" >&2; exit 2 ;;
esac
