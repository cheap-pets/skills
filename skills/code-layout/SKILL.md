---
name: code-layout
description: 约束程序源码的纵向排版：用空行按意图分段，并规范引入语句（import / include / use 等）的顺序。新写、大段改写或重构程序源码（单行小改不需要），或用户提到排版、分段、空行、整理引入语句、“代码太挤”、“可读性”时使用。
---

# 代码纵向排版

空行是代码的段落分隔：一段一个意图，扫一眼空行即可看出执行步骤。

符号、水平空格、缩进、引号、分号、行宽交给 linter/formatter，本 skill 只管**空行分段**与**引入语句排序**。

## 原则与运行模式

- **Linter 优先**：项目 linter/formatter 已强制的规则优先于本文；若项目配置了 ESLint / Ruff 等自动修复，调整完结构后对改动文件运行 `--fix` 收尾。
- **日常伴随模式（默认，静默执行）**：写代码时一次成型，无需报备或额外确认。
  - **局部修改**：只调整本次新增或修改的代码块，不动无关行；新增引入语句时顺着原文件现有的分组与排序风格手动插入，不重排已有引入。
  - **单文件新建 / 整文件重构**：整文件按空行规则分段；引入排序见下方脚本条件。
- **显式批量模式（仅用户明确要求整理目录或多文件时触发）**：
  - 批量整理以**确定性工具**为主，不逐文件手改大批量空行。
  - **空行**：运行项目已有的 linter/formatter `--fix`；若仓库缺少结构性空行规则，如实告知并建议补充 linter 配置，不要静默退化为逐文件手改。
  - **引入排序**：当项目未配置 import 排序 linter 时，传明确路径先跑 `sort-imports.cjs --dry-run` 列出待改清单，排查含前置 side-effect 的入口文件，确认后再落盘。
  - **小范围语义精修**：仅在用户明确指定少量具体文件要求按意图重新分段时逐文件调整，完成后跑 `git diff --ignore-blank-lines` 校验零代码改动（若同时整理引入，两步分开验收）。
- **语言特例**：处理对应语言时读取 `references/python.md`、`references/vue-sfc.md`。

## 空行规则

以下结构性空行规则优先于“同一意图内连写”：

### 1. 边界与密度

- 连续空行最多 1 行；块首（`{` `[` 后）与块尾（`}` `]` 前）不留空行。
- 同一意图内连续语句连写，意图变化时留 1 空行；单段超过约 10 行时按子步骤再分（无自然边界则不强拆）。

### 2. 赋值与多行块

- **赋值语句（含变量声明）与非赋值语句之间必须空 1 行**。
- 同一意图内连续的单行同类赋值连写；相邻的**解构赋值**与**普通赋值**之间空 1 行（无顺序依赖时尽量同类聚拢）。
- **多行语句块**（跨多行的对象/数组赋值、带回调块的多行函数调用如 `watch` / `onMounted` / `forEach`）前后与其他语句之间必须空 1 行。

### 3. 控制流与返回

- **多行控制流语句**（`if` / `for` / `while` / `switch` / `try`，含不带花括号的多行 `if ... else ...`）前后与其他语句之间必须空 1 行。
- 单行控制流语句上下各空 1 行（仅函数或代码块开头的连续单行前置校验，或连续并列的同类单行分发可连写，之后空 1 行）。
- 任意代码块内的 `return` 与其前面的同级语句之间必须空 1 行（位于块首时不空）。

### 4. 顶层与注释

- 所有顶层声明与导出（`const`/`let`、`type`/`interface`、`function`、`class`、`export`）之间空 1 行；仅相邻的单行同类声明或导出可连写。
- 独立成行的注释（含对象字面量、数组、接口、枚举内部）：上方空 1 行、下方 0 行，贴住其描述的代码；位于块首时上方不空行；文件头注释除外，其后空 1 行。

## 引入语句排序

- **位置锚点**：引入区必须保留在**文件头注释、shebang、`'use strict'` / `'use client'` 等文件级指令之后**，严禁挪到文件头注释上方。
- **通用规则**（非 JS/TS/Vue 或无脚本场景，如 `#include` / `use` / `using` / `require`）：按“标准库 / 外部依赖 / 项目内部”分组，组间空 1 行；整个引入区之后空 1 行。
- **JS / TS / Vue**（`.js` `.mjs` `.jsx` `.ts` `.mts` `.tsx` `.vue`）：当项目未配置 import 排序 linter、且文件不含必须前置执行的 side-effect import（如 polyfill、`reflect-metadata`）时，在新建、整文件重构或显式批量整理中运行脚本，不要手动重排：

  ```bash
  node <skill目录>/scripts/sort-imports.cjs <路径...> [--dry-run]
  ```

  必须显式传入文件或目录路径（无参或未知选项直接报错退出）；批量传目录时须先加 `--dry-run` 确认变更范围。分组细则与限制见 `references/import-sorting.md`。
- 局部新增引入语句时不运行脚本，顺着当前文件已有的分组与排序风格插入对应位置。

## 示例

```ts
/**
 * 同步条目列表
 */

import { save } from './api'

async function syncItems(items: Item[], options: Options) {
  if (!items.length) return 0
  if (!options.enabled) return 0

  const { prefix, dryRun } = options
  const { userId } = options.meta

  const cache = await loadCache(userId)

  if (!cache) return 0

  const payload = {
    userId,
    total: items.length,
  }

  let count = 0

  for (const item of items) {
    const raw = item.name.trim()
    let key = `${prefix}:${raw}`

    if (!raw) key = `${prefix}:default`

    if (dryRun) count += 1
    else count += await save(userId, key, payload)

    if (count >= 100) {
      // 达到单次同步上限
      break
    }
  }

  // 记录汇总结果
  await logSync(userId, count)

  return count
}
```
