/**
 * sort-imports.cjs
 *
 * 格式化源文件中 import 语句的顺序，分组规则（每组内部按字符串长度升序，
 * 长度相同时按字母序稳定排序；第 11 组保留原有相对顺序以保护样式层叠与副作用顺序；
 * 保留原换行风格/缩进）：
 *
 *   1. default import  - node 内置包      import defaultName from 'fs'
 *   2. default import  - 外部包           import defaultName from 'vue'
 *   3. 其它 import      - node 内置包      import { x } from 'fs'
 *   4. 其它 import      - 外部包           import { x } from 'vue'
 *   5. namespace import - node 内置包      import * as ns from 'fs'
 *   6. namespace import - 外部包           import * as ns from 'vue'
 *   7. default import  - 本地路径          import Foo from './Foo'
 *   8. 其它 import      - 本地路径          import { x } from '@/utils'
 *   9. namespace import - 本地路径          import * as ns from '@/utils'
 *  10. .vue 组件 import                     import Foo from './Foo.vue'
 *  11. css / html / side-effect import     import './a.css'
 *                                          import 'reflect-metadata'
 *  12. 资源文件 import                     import logo from './logo.svg'
 *                                          import data from './data.json'
 *
 * 组与组之间保留一个空行；同一个连续 import 块内部原有的空行会先被清掉再重排。
 * import 块之外的空行（例如 import 之后到业务代码之间的空行）原样保留。
 *
 * 支持：
 *   - .js / .mjs / .jsx / .ts / .mts / .tsx 文件：整个文件按 import 块处理。
 *   - .vue 文件：只处理 <script> ... </script> 块（含 <script setup> 与 lang="ts"），模板/样式不动。
 *   - TypeScript `import type` 语法与多行 import。
 *   - 紧贴 import 的前导说明注释（// ... 或 /* ... *\/，且本身不是 import）会跟随该 import 一起移动。
 *   - 被注释掉的 import（// import ... / /* import ... *\/）：识别为 import 并参与排序，
 *     按其 from 来源归入对应分组，排在该组所有未注释 import 之后；多个注释项之间仍按长度升序。
 *
 * 用法：
 *   node scripts/sort-imports.cjs [路径...]           # 默认直接落盘改写
 *   node scripts/sort-imports.cjs [路径...] --dry-run # 只打印变更，不写文件
 *   node scripts/sort-imports.cjs                     # 不传路径，默认处理 cwd
 *   node scripts/sort-imports.cjs src/foo.vue         # 处理单个文件
 *
 * 路径基于 cwd 解析，可以是文件或目录；目录会递归处理支持的扩展名。
 */
'use strict'

const { readFileSync, writeFileSync, readdirSync, statSync } = require('fs')
const { join, extname, resolve } = require('path')

// import 语句起始：排除动态 import(...) 与 import.meta
const IMPORT_RE = /^(?:export\s+)?import\b(?!\s*[(.])/

const SUPPORTED_EXTS = new Set(['.js', '.mjs', '.jsx', '.ts', '.mts', '.tsx', '.vue'])

// ---- CLI 解析（模块级，供 main / processFile 读取）----
const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const targets = argv.filter(a => !a.startsWith('--'))
const roots = targets.length ? targets : [process.cwd()]

// Node.js 内置模块列表（含常见前缀如 node:）。非内置包一律视为外部包。
const BUILTIN_MODULES = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls',
  'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads',
  'zlib'
])

// 剥离注释，返回“等价的 import 源文本”，便于后续 extractSource / isDefaultImport 判定。
function stripCommentMarker (raw) {
  const lines = raw.split('\n')
  let idx = 0
  let inBlock = false
  while (idx < lines.length) {
    const t = lines[idx].trim()
    if (inBlock) {
      if (t.includes('*/')) inBlock = false
      idx++
      continue
    }
    if (t === '') { idx++; continue }
    if (t.startsWith('/*') && t.includes('*/') && t.indexOf('*/') === t.length - 2) {
      const inner = t.slice(2, -2).trim()
      if (IMPORT_RE.test(inner)) {
        const sliced = lines.slice(idx).join('\n')
        return sliced.replace(/^(\s*)\/\*\s*/, '$1').replace(/\s*\*\/\s*$/, '')
      }
      idx++
      continue
    }
    if (t.startsWith('/*') && !t.includes('*/')) {
      inBlock = true
      idx++
      continue
    }
    if (t.startsWith('//') || t.startsWith('*')) {
      const after = t.replace(/^\/\/\s*/, '').replace(/^\/\*\s*/, '').replace(/^\*\s*/, '').trim()
      if (IMPORT_RE.test(after)) {
        const sliced = lines.slice(idx).join('\n')
        return sliced.replace(/^(\s*)\/\/\s*/, '$1').replace(/^(\s*)\/\*\s*/, '$1').replace(/^(\s*)\*\s*/, '$1')
      }
      idx++
      continue
    }
    break
  }
  const sliced = lines.slice(idx).join('\n')
  return sliced.replace(/^(\s*)\/\/\s*/, '$1').replace(/^(\s*)\/\*\s*/, '$1').replace(/^(\s*)\*\s*/, '$1')
}

// 从 import 语句源文本里抽出导入源路径。
function extractSource (raw) {
  const norm = stripCommentMarker(raw)
  const fromMatch = norm.match(/\bfrom\s*['"`]([^'"`]+)['"`]/)
  if (fromMatch) return fromMatch[1]
  const reqMatch = norm.match(/\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/)
  if (reqMatch) return reqMatch[1]
  const sideMatch = norm.match(/^\s*(?:export\s+)?import\s*['"`]([^'"`]+)['"`]/)
  return sideMatch ? sideMatch[1] : ''
}

// 判断是否 node 内置包。支持 'fs'、'node:fs'、'fs/promises'、'path/posix'
function isBuiltin (src) {
  if (!src) return false
  const stripped = src.startsWith('node:') ? src.slice(5) : src
  const top = stripped.split('/')[0]
  return BUILTIN_MODULES.has(top)
}

// 判断是否本地路径：必须以 ./ ../ @/ ~ 开头。
function isLocalPath (src) {
  if (!src) return false
  return (
    src.startsWith('./') ||
    src.startsWith('../') ||
    src.startsWith('@/') ||
    src.startsWith('~')
  )
}

function isCssOrHtml (src) {
  if (!src) return false
  return /\.(css|scss|less|sass|styl|html|htm)$/i.test(src.split('?')[0])
}

function isAssetFile (src) {
  if (!src) return false
  return /\.(json|txt|text|svg|ico|jpg|jpeg|png|gif|webp|bmp|woff|woff2|ttf|eot|mp4|mp3|wav|pdf)$/i.test(src.split('?')[0])
}

function isVueComponent (src) {
  if (!src) return false
  return /\.vue$/i.test(src.split('?')[0])
}

function isImportStart (line) {
  return IMPORT_RE.test(line.trim())
}

function isCommentedImportStart (line) {
  const t = line.trim()
  if (!t.startsWith('//') && !t.startsWith('/*')) return false
  const stripped = t.replace(/^\/\/\s*/, '').replace(/^\/\*\s*/, '').replace(/^\*\s*/, '').trim()
  return IMPORT_RE.test(stripped)
}

function isCommentLine (line) {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')
}

function isDirectiveLine (line) {
  return /^['"]use (?:strict|client|server)['"]\s*;?$/.test(line.trim())
}

function isSideEffectImport (raw) {
  const norm = stripCommentMarker(raw)
  return /^\s*(?:export\s+)?import\s*['"`]/.test(norm)
}

// 判断 import 是否 default 形式（支持 import type Foo from ...）
function isDefaultImport (raw) {
  if (isNamespaceImport(raw)) return false
  const norm = stripCommentMarker(raw)
  if (/^\s*(?:export\s+)?import\s*['"`]/.test(norm)) return false
  const fromIdx = norm.search(/\bfrom\b/)
  const head = fromIdx >= 0 ? norm.slice(0, fromIdx) : norm
  const cleaned = head
    .replace(/^\s*(?:export\s+)?import(?:\s+type)?\s*/, '')
    .trim()
  if (!cleaned) return false
  if (cleaned.startsWith('{') || cleaned.startsWith('*')) return false
  return true
}

// 判断是否 namespace import（支持 import type * as ns from ...）
function isNamespaceImport (raw) {
  const norm = stripCommentMarker(raw)
  const fromIdx = norm.search(/\bfrom\b/)
  const head = fromIdx >= 0 ? norm.slice(0, fromIdx) : norm
  const cleaned = head
    .replace(/^\s*(?:export\s+)?import(?:\s+type)?\s*/, '')
    .trim()
  return cleaned.startsWith('*')
}

// ---- 分组编号 ----
// 0: default    + builtin
// 1: default    + external
// 2: other      + builtin
// 3: other      + external
// 4: namespace  + builtin
// 5: namespace  + external
// 6: default    + local
// 7: other      + local
// 8: namespace  + local
// 9: .vue 组件
// 10: css / html / side-effect
// 11: 资源文件（json/txt/svg/图片等）
function groupOf (raw) {
  const src = extractSource(raw)
  if (isSideEffectImport(raw)) return 10
  if (isAssetFile(src)) return 11
  if (isCssOrHtml(src)) return 10
  if (isVueComponent(src)) return 9
  const def = isDefaultImport(raw)
  const ns = isNamespaceImport(raw)
  if (isLocalPath(src)) {
    if (def) return 6
    if (ns) return 8
    return 7
  }
  if (isBuiltin(src)) {
    if (def) return 0
    if (ns) return 4
    return 2
  }
  if (def) return 1
  if (ns) return 5
  return 3
}

// 判断一段文本是否已经是一条“完整闭合”的 import 语句（兼容行尾注释与单行块注释 /* import ... */）
function importLineClosed (text) {
  if (/^\s*(?:\/\/\s*|\/\*\s*)?(?:export\s+)?import\s+[\w$]+\s*=\s*require\s*\([^)]*\)/m.test(text)) return true
  if (/\bfrom\s*['"`][^'"`]+['"`]\s*;?/.test(text)) {
    const tail = text.replace(/\s+$/, '')
    return /['"`]\s*;?(?:\s*\*\/)?(?:\s*\/\/.*|\s*\/\*[\s\S]*?\*\/)?$/.test(tail)
  }
  if (/^\s*(?:\/\/\s*|\/\*\s*)?(?:export\s+)?import\s*['"`][^'"`]+['"`]\s*;?/m.test(text)) return true
  return false
}

// 跳过连续的非 import 说明注释行，返回其后第一行的索引
function skipLeadingComments (lines, startIdx) {
  let j = startIdx
  let inBlock = false
  while (j < lines.length) {
    const t = lines[j].trim()
    if (inBlock) {
      if (t.includes('*/')) inBlock = false
      j++
      continue
    }
    if (isCommentedImportStart(lines[j])) break
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true
      j++
      continue
    }
    if (t.startsWith('//') || t.startsWith('*')) {
      j++
      continue
    }
    break
  }
  return j
}

// 定位文件顶部第一个 import 块的起始行；若顶部先遇到普通代码则返回 -1
function findTopImportStart (lines) {
  let i = 0
  let inBlock = false
  while (i < lines.length) {
    const line = lines[i]
    const t = line.trim()
    if (inBlock) {
      if (t.includes('*/')) inBlock = false
      i++
      continue
    }
    if (isImportStart(line) || isCommentedImportStart(line)) return i
    if (t === '' || t.startsWith('#!') || isDirectiveLine(line)) { i++; continue }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true
      i++
      continue
    }
    if (t.startsWith('//')) { i++; continue }
    return -1
  }
  return -1
}

// ---- 解析一个连续 import 块 ----
function parseImportBlock (lines, startIdx) {
  const entries = []
  let i = startIdx
  const n = lines.length
  while (i < n) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed === '') {
      let j = i + 1
      while (j < n && lines[j].trim() === '') j++
      if (j < n) {
        if (isImportStart(lines[j]) || isCommentedImportStart(lines[j])) { i = j; continue }
        const afterComments = skipLeadingComments(lines, j)
        if (afterComments > j && afterComments < n &&
            (isImportStart(lines[afterComments]) || isCommentedImportStart(lines[afterComments]))) {
          i = j
          continue
        }
      }
      break
    }

    if (isCommentedImportStart(line)) {
      const buf = [line]; i++
      while (i < n && !importLineClosed(buf.join('\n'))) { buf.push(lines[i]); i++ }
      entries.push({ text: buf.join('\n'), commented: true })
      continue
    }

    if (isCommentLine(line)) {
      const j = skipLeadingComments(lines, i)
      if (j > i && j < n && (isImportStart(lines[j]) || isCommentedImportStart(lines[j]))) {
        const commented = isCommentedImportStart(lines[j])
        const buf = lines.slice(i, j + 1)
        i = j + 1
        while (i < n && !importLineClosed(buf.join('\n'))) { buf.push(lines[i]); i++ }
        entries.push({ text: buf.join('\n'), commented })
        continue
      }
      break
    }

    if (isImportStart(line)) {
      const buf = [line]; i++
      while (i < n && !importLineClosed(buf.join('\n'))) { buf.push(lines[i]); i++ }
      entries.push({ text: buf.join('\n'), commented: false })
      continue
    }

    break
  }
  return { entries, endIdx: i }
}

// ---- 重排一个 import 块 ----
function sortBlock (entries) {
  if (entries.length <= 1) return entries.map(e => e.text)

  const cmp = (a, b) => {
    if (a.commented !== b.commented) return a.commented ? 1 : -1
    const la = a.text.length
    const lb = b.text.length
    if (la !== lb) return la - lb
    return a.text < b.text ? -1 : a.text > b.text ? 1 : 0
  }

  const groups = Array.from({ length: 12 }, () => [])
  for (const e of entries) groups[groupOf(e.text)].push(e)
  const out = []
  for (let g = 0; g < groups.length; g++) {
    if (!groups[g].length) continue
    // 第 11 组（css / html / side-effect）保留原有相对顺序，避免破坏样式层叠与副作用执行顺序
    if (g !== 10) groups[g].sort(cmp)
    if (out.length) out.push('')
    for (const e of groups[g]) out.push(e.text)
  }
  return out
}

// ---- 处理单段文本（.js/.ts 整文件，或 .vue 的单个 <script> 块内容） ----
function transformSource (code) {
  const eol = code.includes('\r\n') ? '\r\n' : '\n'
  const normalized = eol === '\r\n' ? code.replace(/\r\n/g, '\n') : code
  const lines = normalized.split('\n')
  if (!lines.length) return code

  const idx = findTopImportStart(lines)
  if (idx < 0) return code

  const head = lines.slice(0, idx)
  const { entries, endIdx } = parseImportBlock(lines, idx)
  if (!entries.length) return code

  const sorted = sortBlock(entries)
  const tail = lines.slice(endIdx)
  const result = [...head, ...sorted]
  if (tail.length) {
    const firstTail = tail[0]
    const lastSorted = result[result.length - 1]
    if (firstTail.trim() !== '' && lastSorted.trim() !== '') {
      result.push('')
    }
  }
  const out = [...result, ...tail].join('\n')
  return eol === '\r\n' ? out.replace(/\n/g, '\r\n') : out
}

// ---- 处理 .vue：抽取所有 <script> 块逐个处理 ----
function transformVue (code) {
  const scriptRe = /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi
  let changed = false
  const out = code.replace(scriptRe, (m, openTag, body, closeTag) => {
    const after = transformSource(body)
    if (after !== body) changed = true
    return openTag + after + closeTag
  })
  return changed ? out : code
}

// ---- 文件入口 ----
function processFile (absPath) {
  const ext = extname(absPath).toLowerCase()
  if (!SUPPORTED_EXTS.has(ext)) return false
  const text = readFileSync(absPath, 'utf8')
  // BOM 不参与排序，处理完原样补回，避免它随首条 import 移到文件中间
  const bom = text.charCodeAt(0) === 0xFEFF ? '\uFEFF' : ''
  const raw = bom ? text.slice(1) : text
  const next = ext === '.vue' ? transformVue(raw) : transformSource(raw)
  if (next === raw) return false
  if (!dryRun) writeFileSync(absPath, bom + next, 'utf8')
  return true
}

// ---- 目录遍历 ----
function walk (dir, acc) {
  let ents
  try { ents = readdirSync(dir) } catch { return }
  for (const name of ents) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue
    const full = join(dir, name)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) walk(full, acc)
    else if (st.isFile()) acc.push(full)
  }
}

// ---- 主流程 ----
function main () {
  const files = []
  for (const r of roots) {
    const abs = resolve(process.cwd(), r)
    let st
    try { st = statSync(abs) } catch {
      console.error(`路径不存在: ${abs}`)
      continue
    }
    if (st.isDirectory()) walk(abs, files)
    else files.push(abs)
  }

  const targetFiles = files.filter(f => SUPPORTED_EXTS.has(extname(f).toLowerCase()))
  const skipped = files.length - targetFiles.length
  let changed = 0
  const changedFiles = []
  for (const f of targetFiles) {
    try {
      if (processFile(f)) {
        changed++
        changedFiles.push(f)
      }
    } catch (e) {
      console.error(`处理失败: ${f}\n  ${e.message}`)
    }
  }

  console.log(`扫描 ${targetFiles.length} 个目标文件，跳过 ${skipped} 个其它文件`)
  console.log(`${dryRun ? '[dry-run] 需要修改' : '已修改'} ${changed} 个文件`)
  if (changedFiles.length) {
    console.log('\n变更清单:')
    for (const f of changedFiles) console.log('  ' + f)
  }
}

module.exports = {
  stripCommentMarker,
  extractSource,
  isBuiltin,
  isLocalPath,
  isCssOrHtml,
  isAssetFile,
  isVueComponent,
  isSideEffectImport,
  isDefaultImport,
  isNamespaceImport,
  groupOf,
  sortBlock,
  transformSource,
  transformVue
}

if (require.main === module) {
  main()
}
