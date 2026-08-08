#!/usr/bin/env bun
/**
 * check-docs-links — 校验 docs/ 下的文档里引用的仓库路径是否仍然存在。
 *
 * 为什么需要：docs/dev/ 的约定是「引用只写到文件与符号名，不写行号」。
 * 行号会漂移所以不写，但路径会因上游改目录结构而失效 —— 这是文档腐烂
 * 最常见的形式，也是最容易自动检出的一种。
 *
 * 检查两类引用：
 *   1. 反引号里的仓库路径 —— 只认以已知顶层目录开头的（apps/ packages/ …），
 *      避免把章节内的相对引用（如 shared 一节里的 `agent/`）当成错误。
 *   2. Markdown 相对链接 —— [文字](02-repo-map.md) / (../upstream-sync.md)
 *
 * 刻意不存在的路径用 `<!-- docs-links-ok: 原因 -->` 豁免（作用于整个文件），
 * 或在同一行加 `docs-links-ok` 注释豁免该行。
 *
 * 用法：
 *   bun run scripts/check-docs-links.ts          # 校验
 *   bun run scripts/check-docs-links.ts --list   # 同时列出全部通过的引用
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const DOCS_DIR = join(ROOT, 'docs')
const LIST = process.argv.includes('--list')

/** 顶层目录白名单 —— 只有以这些开头的反引号内容才被当作仓库路径校验。 */
const REPO_ROOTS = ['apps/', 'packages/', 'scripts/', 'docs/', '.claude/', '.github/', '.husky/']

/** 已知刻意不存在的路径（构建产物、前向引用、故意举例的失效路径）。 */
const KNOWN_ABSENT = new Set([
  // 构建产物，只在对应构建步骤之后存在
  'apps/electron/dist/interceptor.cjs',
  'apps/viewer/dist',
  // 上游私有仓库里有、未随开源导出 —— 文档正是在说明它们不存在
  'apps/marketing',
  'apps/online-docs',
  'packages/craft-agents-commands',
  'packages/craft-cli',
  // 刻意不存在：文档在说明「这个钩子文件缺失所以 pre-commit 不生效」
  '.husky/pre-commit',
])

interface Finding {
  file: string
  line: number
  ref: string
  kind: 'path' | 'link'
}

function walkMarkdown(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walkMarkdown(full))
    else if (entry.endsWith('.md')) out.push(full)
  }
  return out
}

/** 反引号里的仓库路径，如 `packages/shared/src/protocol/channels.ts` */
const BACKTICK_PATH = /`([a-zA-Z0-9_@./-]+)`/g
/** Markdown 相对链接，如 [文字](02-repo-map.md#锚点) —— 排除 http(s) 与纯锚点 */
const MD_LINK = /\[[^\]]*\]\((?!https?:|#)([^)\s]+)\)/g

function check(file: string): { ok: string[]; bad: Finding[] } {
  const ok: string[] = []
  const bad: Finding[] = []
  const src = readFileSync(file, 'utf8')

  // 整个文件豁免
  if (src.includes('docs-links-ok:')) return { ok, bad }

  const rel = relative(ROOT, file)

  src.split('\n').forEach((text, i) => {
    if (text.includes('docs-links-ok')) return
    const lineNo = i + 1

    for (const m of text.matchAll(BACKTICK_PATH)) {
      const ref = m[1]
      if (!REPO_ROOTS.some(r => ref.startsWith(r))) continue
      if (ref.includes('*')) continue           // glob 模式
      if (KNOWN_ABSENT.has(ref.replace(/\/$/, ''))) continue
      if (existsSync(join(ROOT, ref))) ok.push(`${rel}:${lineNo} ${ref}`)
      else bad.push({ file: rel, line: lineNo, ref, kind: 'path' })
    }

    for (const m of text.matchAll(MD_LINK)) {
      const target = m[1].split('#')[0]
      if (!target) continue                     // 纯锚点
      const resolved = join(dirname(file), target)
      if (existsSync(resolved)) ok.push(`${rel}:${lineNo} → ${target}`)
      else bad.push({ file: rel, line: lineNo, ref: target, kind: 'link' })
    }
  })

  return { ok, bad }
}

const files = walkMarkdown(DOCS_DIR)
const allOk: string[] = []
const allBad: Finding[] = []

for (const f of files) {
  const { ok, bad } = check(f)
  allOk.push(...ok)
  allBad.push(...bad)
}

if (LIST) for (const line of allOk) console.log(`  ✅ ${line}`)

if (allBad.length > 0) {
  console.error(`\ncheck-docs-links 失败 —— ${allBad.length} 处引用已失效：\n`)
  for (const f of allBad) {
    const what = f.kind === 'link' ? '文档链接' : '仓库路径'
    console.error(`  ❌ ${f.file}:${f.line}  ${what} ${f.ref}`)
  }
  console.error(
    `\n修法：更新引用指向新位置；如果该路径本就刻意不存在（构建产物、`
    + `用于说明"这个文件已失效"的举例），加进本脚本的 KNOWN_ABSENT，`
    + `或在该行加 docs-links-ok 注释。\n`
  )
  process.exit(1)
}

console.log(
  `check-docs-links OK（${files.length} 个文档，${allOk.length} 处引用全部有效）`
)
