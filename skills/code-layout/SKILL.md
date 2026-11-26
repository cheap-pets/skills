---
name: code-layout
description: 约束代码的纵向排版：用空行按意图分段，并规范引入语句（import / include / use 等）的顺序。新写、大段改写或重构代码（单行小改不需要），或用户提到排版、分段、空行、整理引入语句、"代码太挤"、"可读性"时使用。
---

# 代码纵向排版

空行是代码的段落分隔：一段一个意图，扫一眼空行即可看出执行步骤。

符号、水平空格、缩进、引号、分号、行宽交给 linter/formatter，本 skill 只管**空行分段**与**引入语句排序**。

## 原则

- 项目 linter/formatter 已强制的规则优先于本文（含自动 import 排序）。
- 只调整本次编写或修改的代码范围，不顺手重排无关行。
- 语言特例见 `references/python.md`、`references/vue-sfc.md`（处理对应语言时读取）。

## 空行规则

### 1. 边界与密度

- 连续空行最多 1 行；块首（`{` 后）与块尾（`}` 前）不留空行。
- 意图变化时留 1 空行；同一意图内连续语句连写。
- 单段过长（超过约 10 行）时按子步骤再分，无自然边界则不强拆。

### 2. 赋值与声明

- **赋值语句（含变量声明）与非赋值语句之间必须空 1 行**。
- 同一意图内连续的同类赋值连写；相邻的**解构赋值**与**普通赋值**之间空 1 行（无顺序依赖时尽量同类聚拢）。

### 3. 控制流与返回

- **多行控制流语句**（`if` / `for` / `while` / `switch` / `try`，**含不带花括号的多行 `if ... else ...`**）视为多行代码块，前后与其他代码行之间必须空 1 行。
- 单行控制流语句上下各空 1 行（仅函数或代码块开头的连续单行前置校验可连写，之后空 1 行）。
- 函数末尾 `return` 与前面的代码行之间必须空 1 行（块首不空行，故 `return` 为唯一语句时不空）。

### 4. 顶层与注释

- 顶层常量/类型与函数之间空 1 行；函数、类、方法定义之间空 1 行；同类单行定义连写。
- 独立成行的注释：上方空 1 行、下方 0 行，贴住其描述的代码；文件头注释除外，其后空 1 行。

## 引入语句排序

- **通用规则**（所有语言，如 `import` / `#include` / `use` / `using` / `require`）：按“标准库 / 外部依赖 / 项目内部”分组，组间空 1 行；整个引入区之后空 1 行。
- **JS / TS / Vue**（`.js` `.mjs` `.jsx` `.ts` `.mts` `.tsx` `.vue`）：新建文件、整体重写/重构、或用户明确要求整理时，运行脚本，不要手动排序：

  ```bash
  node <skill目录>/scripts/sort-imports.cjs <改动的文件路径...>
  ```

  只传文件路径，勿传目录或无参运行。分组细则与限制见 `references/import-sorting.md`。
- 局部新增引入语句时不运行脚本，按通用规则插入对应分组。

## 示例

```ts
async function syncItems(items: Item[], options: Options) {
  if (!items.length) return []
  if (!options.enabled) return []

  const { prefix, dryRun } = options
  const { userId } = options.meta

  const cache = await loadCache(userId)

  if (!cache) return []

  let count = 0

  for (const item of items) {
    const raw = item.name.trim()
    let key = `${prefix}:${raw}`

    if (!raw) key = `${prefix}:default`

    if (dryRun) count += 1
    else count += await save(userId, key)

    if (count >= 100) break
  }

  // 记录汇总结果
  await logSync(userId, count)

  return count
}
```
