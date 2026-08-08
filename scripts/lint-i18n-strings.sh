#!/usr/bin/env bash
#
# lint-i18n-strings.sh — 检出源码里硬编码的中日韩文案。
#
# 背景：本项目 UI 文案统一走 react-i18next，key 定义在
# packages/shared/src/i18n/locales/。直接把中文写进 JSX 或字符串字面量，
# 会导致该文案无法切换语言，也不会出现在任何 locale 文件里。
#
# 为什么只查 CJK 而不查所有硬编码英文：上游代码基线是英文，泛化的
# "硬编码字符串" 扫描会产生海量误报（日志、错误码、className……）。
# 对本团队而言，出现 CJK 字面量几乎百分之百意味着「有人跳过了 t()」，
# 信噪比极高。
#
# 用法：
#   bash scripts/lint-i18n-strings.sh              扫描全部源码
#   bash scripts/lint-i18n-strings.sh <文件...>    只扫描指定文件
#
# 例外：注释行不算；确需硬编码时在该行加 `i18n-ok`。
#
# 退出码：0 通过，1 发现硬编码文案。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CJK='[一-鿿぀-ゟ゠-ヿ가-힣]'

# 合法持有 CJK 的位置
is_excluded() {
  case "$1" in
    */node_modules/*|*/dist/*|*/build/*)      return 0 ;;
    *__tests__*|*.test.ts|*.test.tsx)         return 0 ;;  # 测试夹具
    *packages/shared/src/i18n/*)              return 0 ;;  # locale 与语言名注册表
    *) return 1 ;;
  esac
}

# 判断是否为注释行（团队可以用中文写注释）
is_comment_line() {
  printf '%s' "$1" | grep -qE '^[[:space:]]*(//|\*|/\*)'
}

if [ "$#" -gt 0 ]; then
  files="$*"
else
  files=$(find apps packages -type f \( -name '*.ts' -o -name '*.tsx' \) \
            -not -path '*/node_modules/*' -not -path '*/dist/*' | sort)
fi

violations=0

for file in $files; do
  [ -f "$file" ] || continue
  is_excluded "$file" && continue

  while IFS=: read -r lineno text; do
    [ -n "${lineno:-}" ] || continue
    is_comment_line "$text" && continue
    printf '%s' "$text" | grep -q 'i18n-ok' && continue

    if [ "$violations" -eq 0 ]; then
      echo "✖ 发现硬编码的中日韩文案（应改用 t()）："
      echo
    fi
    violations=$((violations + 1))
    printf '  %s:%s\n      %s\n' "$file" "$lineno" \
      "$(printf '%s' "$text" | sed 's/^[[:space:]]*//' | cut -c1-120)"
  done < <(grep -nE "$CJK" "$file" 2>/dev/null)
done

if [ "$violations" -gt 0 ]; then
  cat <<'EOF'

请把文案挪到 packages/shared/src/i18n/locales/en.json 并用 t('key') 引用，
然后按 lint:i18n:parity 的要求同步到其余 6 个 locale。
注释行不受此检查限制；确需硬编码时在该行加 `i18n-ok`。
EOF
  exit 1
fi

echo "lint-i18n-strings OK (无硬编码 CJK 文案)"
