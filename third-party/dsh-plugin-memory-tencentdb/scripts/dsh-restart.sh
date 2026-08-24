#!/usr/bin/env bash
# 重启当前 DSH web（默认 profile=web, 端口 3080）。
#
# 用法:
#   ./scripts/dsh-restart.sh
#   RESTART_DELAY_SECONDS=20 ./scripts/dsh-restart.sh &
#
# 行为:
#   1. 匹配 `--profile web` 的 dsh 进程
#   2. SIGTERM 优雅停止(最多等 20s，超时 SIGKILL)
#   3. 等待 3080 释放
#   4. setsid + nohup 重新拉起，日志写入 ~/.dsh/logs/dsh-web.log
#   5. 等待 3080 重新可访问后打印新 PID 与日志尾部

set -euo pipefail

PROFILE="${DSH_PROFILE:-web}"
PORT="${DSH_PORT:-3080}"
BIN="${DSH_BIN:-$(command -v dsh || true)}"
if [ -z "${BIN}" ]; then
  echo "找不到 dsh，请把 Node/dsh 加入 PATH 或设 DSH_BIN" >&2
  exit 1
fi
LOG_DIR="$HOME/.dsh/logs"
LOG="$LOG_DIR/dsh-web.log"
PID_FILE="$LOG_DIR/dsh-web.pid"

mkdir -p "$LOG_DIR"
sleep "${RESTART_DELAY_SECONDS:-0}"

find_dsh_pids() {
  local pid cmd pattern
  for pattern in "dsh --profile ${PROFILE}" "dsh web"; do
    for pid in $(pgrep -f "$pattern" 2>/dev/null || true); do
      if [ -r "/proc/$pid/cmdline" ]; then
        cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline")
        cmd="${cmd% }"
        # 精确匹配当前 web 进程（两种启动形态），避免误杀 grep/shell 包装进程
        case "$cmd" in
          "node $BIN --profile $PROFILE"|"node $BIN web")
            echo "$pid"
            ;;
        esac
      fi
    done
  done
}

OLD_PIDS=$(find_dsh_pids || true)
if [ -n "$OLD_PIDS" ]; then
  for pid in $OLD_PIDS; do
    echo "[restart-dsh] stopping old dsh pid=$pid"
    kill -TERM "$pid" 2>/dev/null || true
  done

  for _ in $(seq 1 20); do
    REMAIN=$(find_dsh_pids || true)
    [ -z "$REMAIN" ] && break
    sleep 1
  done

  REMAIN=$(find_dsh_pids || true)
  if [ -n "$REMAIN" ]; then
    echo "[restart-dsh] graceful shutdown timed out, sending SIGKILL"
    for pid in $REMAIN; do kill -KILL "$pid" 2>/dev/null || true; done
    sleep 1
  fi
else
  echo "[restart-dsh] no running dsh web process found"
fi

# 等待端口释放
for _ in $(seq 1 20); do
  if ! ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":$PORT$"; then
    break
  fi
  sleep 1
done

# 记忆与知识服务由 dsh-plugin-memory-tencentdb 作为子进程托管，
# 随本脚本启动的 DSH 一起拉起/回收，无需在此单独启动。

START_ARGS=(--profile "$PROFILE" --port "$PORT")
if [ -n "${DSH_TRUSTED_HOST:-}" ]; then
  START_ARGS+=(--trusted-host "$DSH_TRUSTED_HOST")
fi
echo "[restart-dsh] starting new dsh web (${START_ARGS[*]}), log=$LOG"
cd "$HOME"
setsid nohup "$BIN" "${START_ARGS[@]}" >> "$LOG" 2>&1 < /dev/null &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"

# 等待 web 端口可访问(HTTP 有响应即算 up，不要求状态码 2xx)
for _ in $(seq 1 60); do
  if curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORT/" 2>/dev/null; then
    break
  fi
  sleep 1
done

sleep 2
if kill -0 "$NEW_PID" 2>/dev/null; then
  echo "[restart-dsh] new dsh is running: pid=$NEW_PID (pidfile=$PID_FILE)"
else
  echo "[restart-dsh] ERROR: new dsh process exited unexpectedly" >&2
fi
echo "[restart-dsh] last log lines:"
tail -n 20 "$LOG" 2>/dev/null || true
