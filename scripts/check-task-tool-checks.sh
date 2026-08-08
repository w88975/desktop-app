#!/usr/bin/env bash
#
# check-task-tool-checks.sh — 禁止直接比较子代理工具名字面量。
#
# 背景：packages/shared/src/utils/toolNames.ts 里写着——
#   "The SDK renamed 'Task' to 'Agent' in v0.2.72 — both must be recognised.
#    Add future renames here instead of scattering checks across the codebase."
#
# 也就是说判断「这是不是一个启动子代理的工具」必须走 isParentTaskTool()，
# 由 PARENT_TASK_TOOLS 这一个集合统一收口。散落的 toolName === 'Task'
# 会在 SDK 下次改名时静默失效——UI 不再识别子代理，且没有任何报错。
#
# 退出码：0 通过，1 发现违规。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SCAN_DIRS="apps packages"

# 收口点自身，允许出现字面量
ALLOWLIST_PATTERN='packages/shared/src/utils/toolNames\.ts$'

# toolName 与 'Task'/'Agent' 的直接比较（含反向书写与 !==）
PATTERN="(toolName|tool_name)[[:space:]]*[!=]==[[:space:]]*['\"](Task|Agent)['\"]|['\"](Task|Agent)['\"][[:space:]]*[!=]==[[:space:]]*(toolName|tool_name)"

violations=0

while IFS= read -r file; do
  if printf '%s' "$file" | grep -qE "$ALLOWLIST_PATTERN"; then
    continue
  fi

  while IFS=: read -r lineno text; do
    [ -n "${lineno:-}" ] || continue

    if printf '%s' "$text" | grep -q 'parent-task-ok'; then
      continue
    fi
    prev=$((lineno - 1))
    if [ "$prev" -ge 1 ] && sed -n "${prev}p" "$file" 2>/dev/null | grep -q 'parent-task-ok'; then
      continue
    fi

    if [ "$violations" -eq 0 ]; then
      echo "✖ 发现直接比较子代理工具名字面量："
      echo
    fi
    violations=$((violations + 1))
    printf '  %s:%s\n      %s\n' "$file" "$lineno" "$(printf '%s' "$text" | sed 's/^[[:space:]]*//')"
  done < <(grep -nE "$PATTERN" "$file" 2>/dev/null)
done < <(find $SCAN_DIRS -type f \( -name '*.ts' -o -name '*.tsx' \) -not -path '*/node_modules/*' -not -path '*/dist/*' | sort)

if [ "$violations" -gt 0 ]; then
  cat <<'EOF'

请改用 isParentTaskTool(name)：

  import { isParentTaskTool } from '@craft-agent/shared/utils/toolNames'
  if (isParentTaskTool(activity.toolName ?? '')) { ... }

新增的子代理工具名请加进 toolNames.ts 的 PARENT_TASK_TOOLS。
确属例外时，在该行或上一行加注释 `parent-task-ok:<原因>`。
EOF
  exit 1
fi

echo "check-task-tool-checks OK (无绕过 isParentTaskTool 的字面量比较)"
