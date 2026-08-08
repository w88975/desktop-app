#!/usr/bin/env bash
#
# check-raw-sends.sh — 禁止主进程绕过 RPC event sink 直接推送事件。
#
# 背景：本项目渲染层通过 WS RPC 通信（见 .claude/skills/electron-ipc）。
# 主进程向窗口推送事件应走 WindowManager 的 pushToWindow()，它会经由
# eventSink 投递，从而让同一套代码在本地 Electron、webui 和远程服务器
# 三种形态下行为一致。直接调用 webContents.send() 只在 Electron 本地
# 生效，远程 workspace 下事件会静默丢失。
#
# 合法例外见下方 ALLOWLIST；新增例外请在该行或上一行加注释标记
# `raw-send-ok:<原因>`。
#
# 退出码：0 通过，1 发现违规。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SCAN_DIR="apps/electron/src/main"

# 文件级例外 —— 每条都必须有理由
ALLOWLIST_PATTERN='apps/electron/src/main/(window-manager|browser-pane-manager)\.ts$'
#   window-manager.ts      pushToWindow() 内部的兜底分支：WS 握手完成前
#                          eventSink 尚未就绪，此时只能直接 send。
#   browser-pane-manager.ts 浏览器工具栏是独立的 WebContentsView，不是 RPC
#                          客户端，走 TOOLBAR_CHANNELS 自有通道。

if [ ! -d "$SCAN_DIR" ]; then
  echo "check-raw-sends: 目录不存在，跳过：$SCAN_DIR"
  exit 0
fi

violations=0

while IFS= read -r file; do
  case "$file" in
    *.ts) ;;
    *) continue ;;
  esac

  if printf '%s' "$file" | grep -qE "$ALLOWLIST_PATTERN"; then
    continue
  fi

  while IFS=: read -r lineno text; do
    [ -n "${lineno:-}" ] || continue

    # 同行标记
    if printf '%s' "$text" | grep -q 'raw-send-ok'; then
      continue
    fi
    # 上一行标记
    prev=$((lineno - 1))
    if [ "$prev" -ge 1 ] && sed -n "${prev}p" "$file" 2>/dev/null | grep -q 'raw-send-ok'; then
      continue
    fi

    if [ "$violations" -eq 0 ]; then
      echo "✖ 发现绕过 RPC event sink 的直接推送："
      echo
    fi
    violations=$((violations + 1))
    printf '  %s:%s\n      %s\n' "$file" "$lineno" "$(printf '%s' "$text" | sed 's/^[[:space:]]*//')"
  done < <(grep -nE 'webContents\.send\(' "$file" 2>/dev/null)
done < <(find "$SCAN_DIR" -type f -name '*.ts' | sort)

if [ "$violations" -gt 0 ]; then
  cat <<'EOF'

请改用 WindowManager 的 pushToWindow()（或其对外方法）推送事件。
确属例外时，在该行或上一行加注释 `raw-send-ok:<原因>`。
EOF
  exit 1
fi

echo "check-raw-sends OK (扫描 ${SCAN_DIR}，无绕过 RPC 的直接推送)"
