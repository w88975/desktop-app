#!/usr/bin/env bash
#
# lint-i18n-staged.sh — 只对 git 暂存区里的源码跑 i18n 文案检查。
#
# 供 pre-commit 使用：全量扫描要遍历上千个文件，提交时太慢。
# 检查规则与 lint-i18n-strings.sh 完全一致，此处只负责挑出待检文件。
#
# 退出码：0 通过（含无暂存文件），1 发现硬编码文案。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "lint-i18n-staged: 不在 git 仓库中，跳过"
  exit 0
fi

# 只取仍存在于工作区的暂存文件（排除已删除的）
staged=$(git diff --cached --name-only --diff-filter=ACMR -- '*.ts' '*.tsx' 2>/dev/null)

if [ -z "$staged" ]; then
  echo "lint-i18n-staged: 暂存区无 .ts/.tsx 改动，跳过"
  exit 0
fi

count=$(printf '%s\n' "$staged" | grep -c . || true)
echo "lint-i18n-staged: 检查 ${count} 个暂存文件"

# shellcheck disable=SC2086
exec bash "$ROOT/scripts/lint-i18n-strings.sh" $staged
