/**
 * sort-imports.cjs
 *
 * 格式化源文件中 import 语句的顺序，分组规则（每组内部按导入语句本体长度升序，
 * 长度相同时按字母序稳定排序；第 11 组保留原有相对顺序以保护样式层叠与副作用顺序；
 * 保留原换行风格/缩进/BOM）：
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
 * 组与组之间保留一个空行；同一个连续 import 块内部原有的空行会先被清掉再重排，
 * 引入区与正文之间规范为 1 个空行，其余空行原样保留。
 *
 * 支持：
 *   - .js / .mjs / .jsx / .ts / .mts / .tsx 文件：处理顶部第一个连续 import 块。
 *   - .vue 文件：只处理 <script> ... </script> 块（含 <script setup> 与 lang="ts"），模板/样式不动。
 *   - TypeScript `import type`、多行 import 及 ES Import Attributes（`with` / `assert`）。
 *   - 紧贴 import 的前导说明注释（// ... 或 /* ... *\/，且本身不是 import）会跟随该 import 一起移动；
 *     文件头注释与文件级指令（如 @ts-nocheck、eslint-disable）始终保留在顶部。
 *   - 被注释掉的 import（// import ... / /* import ... *\/）：识别为 import 并参与排序，
 *     按其 from 来源归入对应分组，排在该组所有未注释 import 之后（第 11 组保留原位）。
 *
 * 用法：
 *   node scripts/sort-imports.cjs <路径...>           # 直接落盘改写
 *   node scripts/sort-imports.cjs <路径...> --dry-run # 只打印变更清单，不写文件
 *
 * 必须显式传入文件或目录路径（无参或未知选项报错退出）；目录会递归处理支持的扩展名。
 */

'use strict'

const { readFileSync, writeFileSync, readdirSync, statSync } = require('fs')
const { join, extname, resolve } = require('path')
const { builtinModules } = require('module')

// 严格匹配有效 import 语句起始（排除动态 import(...)、import.meta 以及以 import 开头的普通英文注释）
const IMPORT_START_RE = /^(?:export\s+)?import(?:\s*['"`]|(?:\s+type\b(?!\s*(?:from\b|,|=)))?(?:\s*(?:\*\s*as\b|\{)|\s+[A-Za-z_$][\w$]*\s*(?:from\b|,|=)))/

const SUPPORTED_EXTS = new Set(['.js', '.mjs', '.jsx', '.ts', '.mts', '.tsx', '.vue'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage'])

const BUILTIN_MODULES = new Set(
  builtinModules.map(m => m.replace(/^node:/, '').split('/')[0])
)

// 文件级指令注释（绝不随第一条 import 移动）
const FILE_PRAGMA_RE = /@(?:ts-nocheck|ts-check|jsx(?:ImportSource|Frag|Runtime)?|license|copyright|file|module)\b|eslint-disable(?!-next-line|-line)\b|\/\*\s*globals?\s+|\beslint-env\b/i

// 单行作用域指令注释（紧贴首条 import 时也应随该 import 移动）
const NEXT_LINE_PRAGMA_RE = /(?:eslint-disable-next-line|oxlint-disable-next-line|@ts-expect-error|@ts-ignore|biome-ignore|prettier-ignore)\b/i

// 安全剥离 JS 注释（保留字符串字面量内的 // 与 /*）
function stripJsComments (src) {
  let out = ''
  let i = 0
  const n = src.length

  while (i < n) {
    const ch = src[i]
    const next = src[i + 1]

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch

      out += ch
      i++

      while (i < n) {
        const c = src[i]

        out += c

        if (c === '\\' && i + 1 < n) {
          out += src[i + 1]
          i += 2

          continue
        }

        i++

        if (c === quote) break
      }

      continue
    }

    if (ch === '/' && next === '/') {
      i += 2

      while (i < n && src[i] !== '\n') i++

      continue
    }

    if (ch === '/' && next === '*') {
      i += 2

      while (i < n) {
        if (src[i] === '*' && src[i + 1] === '/') {
          i += 2

          break
        }

        if (src[i] === '\n') out += '\n'

        i++
      }

      out += ' '

      continue
    }

    out += ch
    i++
  }

  return out
}

// 解包被注释掉的 import 文本（支持逐行 // 与 /* ... */ 块注释）
function unwrapCommentedCode (text) {
  const trimmed = text.trim()

  if (trimmed.startsWith('/*')) {
    const inner = trimmed.replace(/^\/\*\s*/, '').replace(/\s*\*\/$/, '')

    return inner
      .split('\n')
      .map(line => line.replace(/^\s*\*\s?/, ''))
      .join('\n')
  }

  return text
    .split('\n')
    .map(line => line.replace(/^(\s*)\/\/\s?/, '$1'))
    .join('\n')
}

// 提取条目中的 import 本体（不含前置的非 import 说明注释），用于排序长度比较
function extractImportCode (raw) {
  const lines = raw.split('\n')
  let idx = 0
  let inBlock = false

  while (idx < lines.length) {
    const line = lines[idx]
    const t = line.trim()

    if (inBlock) {
      if (t.includes('*/')) inBlock = false

      idx++

      continue
    }

    if (t === '') {
      idx++

      continue
    }

    if (isImportStart(line)) break
    if (isCommentedImportStart(line) && tryConsumeCommentedImport(lines, idx)) break

    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true

      idx++

      continue
    }

    if (t.startsWith('//') || t.startsWith('*')) {
      idx++

      continue
    }

    break
  }

  return lines.slice(idx).join('\n')
}

// 剥离前置说明注释及被注释 import 的外层注释符，返回“等价的 import 源文本”
function stripCommentMarker (raw) {
  const code = extractImportCode(raw)

  if (isImportStart(code.split('\n')[0] || '')) return code

  return unwrapCommentedCode(code)
}

// 从 import 语句源文本里抽出导入源路径
function extractSource (raw) {
  const norm = stripJsComments(stripCommentMarker(raw))
  const fromMatches = [...norm.matchAll(/\bfrom\s*['"`]([^'"`]+)['"`]/g)]

  if (fromMatches.length) return fromMatches[fromMatches.length - 1][1]

  const reqMatch = norm.match(/\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/)

  if (reqMatch) return reqMatch[1]

  const sideMatch = norm.match(/^\s*(?:export\s+)?import\s*['"`]([^'"`]+)['"`]/)

  return sideMatch ? sideMatch[1] : ''
}

// 判断是否 node 内置包。支持 'fs'、'node:fs'、'node:test'、'fs/promises'、'path/posix'
function isBuiltin (src) {
  if (!src) return false
  if (src.startsWith('node:')) return true

  const top = src.split('/')[0]

  return BUILTIN_MODULES.has(top)
}

// 判断是否本地路径：. / .. 或以 ./ ../ @/ ~ 开头
function isLocalPath (src) {
  if (!src) return false

  return (
    src === '.' ||
    src === '..' ||
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

  return /\.(json|txt|text|svg|ico|jpg|jpeg|png|gif|webp|avif|bmp|woff|woff2|ttf|otf|eot|mp4|mp3|wav|ogg|webm|pdf|wasm|yaml|yml|csv|xml)$/i.test(src.split('?')[0])
}

function isVueComponent (src) {
  if (!src) return false

  return /\.vue$/i.test(src.split('?')[0])
}

function isImportStart (line) {
  return IMPORT_START_RE.test(line.trim())
}

function isCommentedImportStart (line) {
  const t = line.trim()

  if (!t.startsWith('//') && !t.startsWith('/*')) return false

  const stripped = t
    .replace(/^\/\/\s*/, '')
    .replace(/^\/\*\s*/, '')
    .replace(/\s*\*\/\s*$/, '')
    .trim()

  return IMPORT_START_RE.test(stripped)
}

function isCommentLine (line) {
  const t = line.trim()

  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')
}

function isDirectiveLine (line) {
  return /^['"]use (?:strict|client|server)['"]\s*;?$/.test(line.trim())
}

function isSideEffectImport (raw) {
  const norm = stripJsComments(stripCommentMarker(raw))

  return /^\s*(?:export\s+)?import\s*['"`]/.test(norm)
}

function stripImportHeadKeyword (head) {
  return head
    .replace(/^\s*(?:export\s+)?import(?:\s+type\b(?!\s*(?:from\b|,|=))(?=\s*[\w$*{]))?\s*/, '')
    .trim()
}

// 判断是否 namespace import（支持 import type * as ns from ...）
function isNamespaceImport (raw) {
  const norm = stripJsComments(stripCommentMarker(raw))
  const fromIdx = norm.search(/\bfrom\b/)
  const head = fromIdx >= 0 ? norm.slice(0, fromIdx) : norm

  return stripImportHeadKeyword(head).startsWith('*')
}

// 判断 import 是否 default 形式（支持 import type Foo from ... 与 import type from ...）
function isDefaultImport (raw) {
  if (isNamespaceImport(raw)) return false

  const norm = stripJsComments(stripCommentMarker(raw))

  if (/^\s*(?:export\s+)?import\s*['"`]/.test(norm)) return false

  const fromIdx = norm.search(/\bfrom\b/)
  const head = fromIdx >= 0 ? norm.slice(0, fromIdx) : norm
  const cleaned = stripImportHeadKeyword(head)

  if (!cleaned) return false
  if (cleaned.startsWith('{') || cleaned.startsWith('*')) return false

  return true
}

// ---- 分组索引 0..11（对应文档第 1..12 组）----
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

// 检查 with { ... } / assert { ... } 导入属性子句是否完整闭合
function isCompleteImportAttributes (after) {
  const m = after.match(/^(?:with|assert)\s*\{/)

  if (!m) return false

  let depth = 0
  let i = m[0].length - 1
  const n = after.length

  while (i < n) {
    const ch = after[i]

    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch

      i++

      while (i < n) {
        if (after[i] === '\\') {
          i += 2

          continue
        }

        if (after[i] === q) {
          i++

          break
        }

        i++
      }

      continue
    }

    if (ch === '{') depth++
    else if (ch === '}') {
      depth--

      if (depth === 0) {
        const rest = after.slice(i + 1).trim()

        return rest === '' || rest === ';'
      }
    }

    i++
  }

  return false
}

// 检查字符串字面量后剩余部分是否构成合法语句结尾
function isCompleteImportTail (after) {
  const t = after.trim()

  if (t === '' || t === ';') return true
  if (/^(?:with|assert)\b/.test(t)) return isCompleteImportAttributes(t)

  return false
}

// 判断一段文本是否已经是一条“完整闭合”的 import 语句
function importLineClosed (text, isCommented = false) {
  if (isCommented) {
    const t = text.trim()

    if (t.startsWith('/*') && !t.includes('*/')) return false
  }

  const code = isCommented ? unwrapCommentedCode(text) : text
  const clean = stripJsComments(code).trim()

  if (!clean) return false

  if (/^(?:export\s+)?import\s+[\w$]+\s*=\s*require\s*\(\s*['"`][^'"`]+['"`]\s*\)\s*;?$/.test(clean)) {
    return true
  }

  const sideMatch = clean.match(/^(?:export\s+)?import\s*['"`][^'"`]+['"`]/)

  if (sideMatch) {
    return isCompleteImportTail(clean.slice(sideMatch[0].length))
  }

  const fromMatches = [...clean.matchAll(/\bfrom\s*['"`][^'"`]+['"`]/g)]

  if (fromMatches.length) {
    const last = fromMatches[fromMatches.length - 1]
    const beforeFrom = clean.slice(0, last.index)

    let braceDepth = 0

    for (let i = 0; i < beforeFrom.length; i++) {
      const c = beforeFrom[i]

      if (c === "'" || c === '"' || c === '`') {
        const q = c

        i++

        while (i < beforeFrom.length) {
          if (beforeFrom[i] === '\\') {
            i += 2

            continue
          }

          if (beforeFrom[i] === q) break

          i++
        }

        continue
      }

      if (c === '{') braceDepth++
      else if (c === '}') braceDepth--
    }

    if (braceDepth !== 0) return false

    return isCompleteImportTail(clean.slice(last.index + last[0].length))
  }

  return false
}

// 尝试消费一条被注释掉的 import；若无法在纯注释行内闭合则返回 null（回退为普通注释）
function tryConsumeCommentedImport (lines, startIdx) {
  const first = lines[startIdx]
  const isBlock = first.trim().startsWith('/*')
  const buf = [first]
  let i = startIdx + 1

  if (importLineClosed(buf.join('\n'), true)) {
    return { text: buf.join('\n'), nextIdx: i }
  }

  const n = lines.length

  while (i < n) {
    const line = lines[i]
    const t = line.trim()

    if (!isBlock && !t.startsWith('//')) return null

    buf.push(line)
    i++

    if (importLineClosed(buf.join('\n'), true)) {
      return { text: buf.join('\n'), nextIdx: i }
    }

    if (isBlock && t.includes('*/')) return null
  }

  return null
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

    if (isCommentedImportStart(lines[j]) && tryConsumeCommentedImport(lines, j)) break

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

// 反向回溯紧贴首条 import 的前导注释，决定是否并入首条 entry
function attachFirstLeadingComments (lines, importIdx) {
  if (importIdx <= 0) return importIdx

  const prev = lines[importIdx - 1].trim()

  if (prev === '' || prev.startsWith('#!') || isDirectiveLine(lines[importIdx - 1])) {
    return importIdx
  }

  let k = importIdx - 1

  while (k >= 0) {
    const t = lines[k].trim()

    if (t === '' || t.startsWith('#!') || isDirectiveLine(lines[k])) break

    if (t.endsWith('*/')) {
      while (k >= 0 && !lines[k].trim().startsWith('/*')) k--

      if (k < 0) return importIdx

      k--

      continue
    }

    if (t.startsWith('//')) {
      k--

      continue
    }

    return importIdx
  }

  const commentStart = k + 1

  if (commentStart >= importIdx) return importIdx

  const commentText = lines.slice(commentStart, importIdx).join('\n')

  if (FILE_PRAGMA_RE.test(commentText)) return importIdx
  if (NEXT_LINE_PRAGMA_RE.test(commentText)) return commentStart

  // 仅当注释块上方已存在“文件头/指令 + 空行”时，才将其视为首条 import 的说明注释
  if (k >= 0 && lines[k].trim() === '') {
    const hasHeaderAbove = lines.slice(0, k).some(l => l.trim() !== '')

    if (hasHeaderAbove) return commentStart
  }

  return importIdx
}

// 跳过空行与注释，检查后续是否存在活跃 import（用于判断顶部注释掉的 import 是否属于引入区）
function hasFollowingActiveImport (lines, startIdx) {
  let j = startIdx
  let inBlock = false

  while (j < lines.length) {
    const line = lines[j]
    const t = line.trim()

    if (inBlock) {
      if (t.includes('*/')) inBlock = false

      j++

      continue
    }

    if (isImportStart(line)) return true

    if (t === '' || t.startsWith('//')) {
      j++

      continue
    }

    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true

      j++

      continue
    }

    return false
  }

  return false
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

    if (isImportStart(line)) return attachFirstLeadingComments(lines, i)

    if (isCommentedImportStart(line)) {
      const consumed = tryConsumeCommentedImport(lines, i)

      if (consumed) {
        if (hasFollowingActiveImport(lines, consumed.nextIdx)) {
          return attachFirstLeadingComments(lines, i)
        }

        i = consumed.nextIdx

        continue
      }
    }

    if (t === '' || t.startsWith('#!') || isDirectiveLine(line)) {
      i++

      continue
    }

    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true

      i++

      continue
    }

    if (t.startsWith('//')) {
      i++

      continue
    }

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
        if (isImportStart(lines[j])) {
          i = j

          continue
        }

        if (isCommentedImportStart(lines[j]) && tryConsumeCommentedImport(lines, j)) {
          i = j

          continue
        }

        const afterComments = skipLeadingComments(lines, j)

        if (afterComments > j && afterComments < n) {
          const isNextValid =
            isImportStart(lines[afterComments]) ||
            (isCommentedImportStart(lines[afterComments]) && Boolean(tryConsumeCommentedImport(lines, afterComments)))

          if (isNextValid) {
            i = j

            continue
          }
        }
      }

      break
    }

    if (isCommentedImportStart(line)) {
      const consumed = tryConsumeCommentedImport(lines, i)

      if (consumed) {
        entries.push({ text: consumed.text, commented: true })
        i = consumed.nextIdx

        continue
      }
    }

    if (isCommentLine(line)) {
      const j = skipLeadingComments(lines, i)

      if (j > i && j < n) {
        if (isImportStart(lines[j])) {
          const leading = lines.slice(i, j)
          const importBuf = [lines[j]]

          i = j + 1

          while (i < n && !importLineClosed(importBuf.join('\n'), false)) {
            importBuf.push(lines[i])
            i++
          }

          if (!importLineClosed(importBuf.join('\n'), false)) {
            return { entries: [], endIdx: startIdx, aborted: true }
          }

          entries.push({ text: [...leading, ...importBuf].join('\n'), commented: false })

          continue
        }

        if (isCommentedImportStart(lines[j])) {
          const consumed = tryConsumeCommentedImport(lines, j)

          if (consumed) {
            const leading = lines.slice(i, j)

            entries.push({ text: [...leading, consumed.text].join('\n'), commented: true })
            i = consumed.nextIdx

            continue
          }
        }
      }

      break
    }

    if (isImportStart(line)) {
      const buf = [line]

      i++

      while (i < n && !importLineClosed(buf.join('\n'), false)) {
        buf.push(lines[i])
        i++
      }

      if (!importLineClosed(buf.join('\n'), false)) {
        return { entries: [], endIdx: startIdx, aborted: true }
      }

      entries.push({ text: buf.join('\n'), commented: false })

      continue
    }

    break
  }

  return { entries, endIdx: i, aborted: false }
}

// ---- 重排一个 import 块 ----
function sortBlock (entries) {
  if (entries.length <= 1) return entries.map(e => e.text)

  const decorated = entries.map(e => {
    const code = extractImportCode(e.text)

    return { ...e, code, codeLen: code.length }
  })

  const cmp = (a, b) => {
    if (a.commented !== b.commented) return a.commented ? 1 : -1
    if (a.codeLen !== b.codeLen) return a.codeLen - b.codeLen
    if (a.code !== b.code) return a.code < b.code ? -1 : 1

    return a.text < b.text ? -1 : a.text > b.text ? 1 : 0
  }

  const groups = Array.from({ length: 12 }, () => [])

  for (const e of decorated) groups[groupOf(e.text)].push(e)

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
  const { entries, endIdx, aborted } = parseImportBlock(lines, idx)

  if (aborted || !entries.length) return code

  const sorted = sortBlock(entries)
  const tail = lines.slice(endIdx)
  const hasTailCode = tail.some(l => l.trim() !== '')

  let outLines

  if (hasTailCode) {
    let firstCode = 0

    while (firstCode < tail.length && tail[firstCode].trim() === '') firstCode++

    outLines = [...head, ...sorted, '', ...tail.slice(firstCode)]
  } else {
    outLines = [...head, ...sorted, ...tail]
  }

  const out = outLines.join('\n')

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
function processFile (absPath, dryRun) {
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
    if (SKIP_DIRS.has(name)) continue

    const full = join(dir, name)
    let st

    try { st = statSync(full) } catch { continue }

    if (st.isDirectory()) walk(full, acc)
    else if (st.isFile()) acc.push(full)
  }
}

function printUsage (stream) {
  stream.write(
    '用法: node sort-imports.cjs <路径...> [--dry-run]\n' +
    '  <路径...>   必填，支持一个或多个文件/目录路径\n' +
    '  --dry-run   仅预览变更清单，不写盘\n'
  )
}

// ---- CLI 解析与主流程 ----
function main (argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage(process.stdout)

    return 0
  }

  const unknownFlags = argv.filter(a => a.startsWith('-') && a !== '--dry-run')

  if (unknownFlags.length) {
    console.error(`未知选项: ${unknownFlags.join(', ')}`)
    printUsage(process.stderr)

    return 1
  }

  const dryRun = argv.includes('--dry-run')
  const targets = argv.filter(a => !a.startsWith('-'))

  if (!targets.length) {
    console.error('错误: 请显式传入至少一个文件或目录路径（禁止无参扫描当前目录）')
    printUsage(process.stderr)

    return 1
  }

  const files = []
  let hasMissing = false

  for (const r of targets) {
    const abs = resolve(process.cwd(), r)
    let st

    try { st = statSync(abs) } catch {
      console.error(`路径不存在: ${abs}`)
      hasMissing = true

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
      if (processFile(f, dryRun)) {
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

  return hasMissing ? 1 : 0
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
  process.exitCode = main()
}
