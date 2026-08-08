#!/usr/bin/env bash
#
# typecheck-staged.sh — 只对暂存改动所涉及的 workspace 跑类型检查。
#
# 供 pre-commit 使用：typecheck:all 会串行检查 8 个包，提交时太慢。
# 这里先把暂存文件映射到所属 workspace（apps/* 或 packages/*），
# 再只检查受影响的那几个。
#
# tsc 是按包整体检查的，无法只检查单个文件——所以粒度是「包」而非「文件」。
#
# 退出码：0 全部通过（含无暂存文件），1 存在类型错误。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "typecheck-staged: 不在 git 仓库中，跳过"
  exit 0
fi

staged=$(git diff --cached --name-only --diff-filter=ACMR -- '*.ts' '*.tsx' 2>/dev/null)

if [ -z "$staged" ]; then
  echo "typecheck-staged: 暂存区无 .ts/.tsx 改动，跳过"
  exit 0
fi

# 映射到 workspace 目录并去重
workspaces=$(printf '%s\n' "$staged" \
  | grep -E '^(apps|packages)/' \
  | cut -d/ -f1,2 \
  | sort -u)

if [ -z "$workspaces" ]; then
  echo "typecheck-staged: 暂存改动不在 apps/ 或 packages/ 下，跳过"
  exit 0
fi

echo "typecheck-staged: 受影响的 workspace —"
printf '  %s\n' $workspaces
echo

failed=""

for ws in $workspaces; do
  [ -d "$ws" ] || continue
  [ -f "$ws/tsconfig.json" ] || { echo "⏭  $ws（无 tsconfig.json，跳过）"; continue; }

  # 包自带 typecheck 脚本就用它，否则退回 tsc --noEmit
  if [ -f "$ws/package.json" ] && grep -q '"typecheck"[[:space:]]*:' "$ws/package.json"; then
    cmd="bun run typecheck"
  else
    cmd="bun run tsc --noEmit"
  fi

  echo "▶  $ws  ($cmd)"
  if ( cd "$ws" && eval "$cmd" ); then
    echo "✅ $ws"
  else
    echo "❌ $ws"
    failed="$failed $ws"
  fi
  echo
done

if [ -n "$failed" ]; then
  echo "✖ 类型检查未通过：$failed"
  exit 1
fi

echo "typecheck-staged OK"
