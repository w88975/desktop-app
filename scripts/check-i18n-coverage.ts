/**
 * check-i18n-coverage.ts — 校验代码里引用的文案 key 都在 en.json 中存在。
 *
 * 与 check-i18n-parity.ts 的分工：
 *   parity   —— 6 个非英文 locale 的 key 是否与 en.json 对齐（横向）
 *   coverage —— 代码引用的 key 是否在 en.json 中存在（纵向）
 *
 * 判定：
 *   ❌ 失败：代码里 t('x.y') 引用了 en.json 没有的 key。运行时会直接把
 *            key 原样显示给用户，且没有任何编译期报错。
 *   ℹ️  提示：en.json 中未被静态引用的 key。仅作参考，不影响退出码——
 *            本仓库存在 t(`status.${id}`)、i18n.t(config.someKey) 这类
 *            动态引用，静态扫描无法覆盖，据此删 key 会误删。
 *
 * 退出码：0 通过，1 存在缺失 key。
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve, relative } from 'path'

const ROOT = resolve(import.meta.dir, '..')
const EN_PATH = join(ROOT, 'packages/shared/src/i18n/locales/en.json')
const SCAN_ROOTS = ['apps', 'packages']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'out', 'coverage'])
const EXTS = ['.ts', '.tsx']

// --- 收集源码文件 ---------------------------------------------------------

function walk(dir: string, acc: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return acc
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, acc)
    else if (EXTS.some((e) => name.endsWith(e))) acc.push(full)
  }
  return acc
}

// --- 提取 key ------------------------------------------------------------

/** t('key') / t("key") / i18n.t('key')，允许带第二个参数 */
const STATIC_CALL = /(?:^|[^A-Za-z0-9_$.])(?:i18n\.)?t\(\s*(['"])([A-Za-z0-9_][A-Za-z0-9_.\-]*)\1/g
/** <Trans i18nKey="key"> */
const TRANS_KEY = /i18nKey\s*=\s*(['"])([A-Za-z0-9_][A-Za-z0-9_.\-]*)\1/g
/** 动态引用：t(`...${...}`) 或 t(变量) */
const DYNAMIC_CALL = /(?:^|[^A-Za-z0-9_$.])(?:i18n\.)?t\(\s*(?:`[^`]*\$\{|[A-Za-z_$][A-Za-z0-9_$.]*\s*[,)])/g

const enRaw = JSON.parse(readFileSync(EN_PATH, 'utf-8')) as Record<string, unknown>
const enKeys = new Set(Object.keys(enRaw))

/**
 * 去掉 i18next 复数/序数后缀。
 * 代码写 t('time.daysAgo', { count }) ，locale 里存的是 time.daysAgo_one /
 * _other / _few / _many —— 基础名并不存在，必须归一化后再比对。
 */
const PLURAL_SUFFIX = /_(?:ordinal_)?(?:zero|one|two|few|many|other)$/
const normalize = (key: string): string => key.replace(PLURAL_SUFFIX, '')

/** 归一化后的 en.json key 集合（含原始 key） */
const enNormalized = new Set<string>()
for (const k of enKeys) {
  enNormalized.add(k)
  enNormalized.add(normalize(k))
}

const files = SCAN_ROOTS.flatMap((r) => walk(join(ROOT, r)))

const used = new Map<string, { file: string; line: number }>()
let dynamicCount = 0

for (const file of files) {
  if (file.includes(`${'i18n'}/locales/`)) continue

  let text: string
  try {
    text = readFileSync(file, 'utf-8')
  } catch {
    continue
  }
  if (!text.includes('t(') && !text.includes('i18nKey')) continue

  const lineStarts: number[] = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1)
  const lineOf = (idx: number) => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= idx) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }

  for (const re of [STATIC_CALL, TRANS_KEY]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const key = m[2]
      // 只认带点的命名空间 key，过滤掉 t('x') 这类单词误匹配
      if (!key.includes('.')) continue
      if (!used.has(key)) used.set(key, { file: relative(ROOT, file), line: lineOf(m.index) })
    }
  }

  DYNAMIC_CALL.lastIndex = 0
  while (DYNAMIC_CALL.exec(text) !== null) dynamicCount++
}

// --- 判定 ----------------------------------------------------------------

const missing = [...used.entries()].filter(([k]) => !enNormalized.has(k))

// 代码里引用 time.daysAgo 时，_one/_other 等变体都算被使用
const usedNormalized = new Set([...used.keys()].map(normalize))
const unused = [...enKeys].filter(
  (k) => !used.has(k) && !usedNormalized.has(normalize(k))
)

if (missing.length > 0) {
  console.error(`✖ ${missing.length} 个 key 在代码中被引用，但 en.json 里不存在：\n`)
  for (const [key, loc] of missing.sort((a, b) => a[0].localeCompare(b[0]))) {
    console.error(`  ${key}`)
    console.error(`      ${loc.file}:${loc.line}`)
  }
  console.error(`
这些 key 在运行时会原样显示给用户。请在 en.json 补齐，
再按 lint:i18n:parity 的要求同步到其余 6 个 locale。`)
  process.exit(1)
}

console.log(
  `i18n coverage OK (${used.size} 个静态 key 全部存在于 en.json；en.json 共 ${enKeys.size} 个)`
)

if (unused.length > 0) {
  console.log(
    `\nℹ️  ${unused.length} 个 key 未被静态引用。仓库中另有 ${dynamicCount} 处动态引用` +
      `（t(\`x.\${v}\`) / i18n.t(变量)），静态扫描覆盖不到，**请勿据此直接删除**。`
  )
}
