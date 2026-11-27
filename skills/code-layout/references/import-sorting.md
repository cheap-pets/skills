# JS / TS / Vue import 排序

脚本：`scripts/sort-imports.cjs`。规则以脚本为准，修改规则时同步更新脚本头部注释与本文。

## 用法

```bash
node <skill目录>/scripts/sort-imports.cjs <路径...> [--dry-run]
```

- 必须显式传入文件或目录路径；无参或传入未知 `-` / `--` 选项时直接报错退出，防止误改整个仓库。
- `--dry-run`：只列出会被修改的文件，不写盘；批量传目录时必须先用此选项确认清单。
- 传目录会递归处理支持的扩展名（自动跳过 `node_modules`、`.git`、`dist`、`build`、`.next`、`.nuxt`、`coverage`）。
- `.vue` 只处理 `<script>` 块（含 `<script setup>`、`lang="ts"`），模板与样式不动。

## 分组

按序排列，组间空 1 行：

| # | 类型 | 来源 | 示例 |
| --- | --- | --- | --- |
| 1 | default | node 内置 | `import fs from 'fs'` |
| 2 | default | 外部包 | `import Vue from 'vue'` |
| 3 | 命名等其它 | node 内置 | `import { join } from 'path'` |
| 4 | 命名等其它 | 外部包 | `import { ref } from 'vue'` |
| 5 | namespace | node 内置 | `import * as os from 'os'` |
| 6 | namespace | 外部包 | `import * as _ from 'lodash'` |
| 7 | default | 本地路径 | `import Foo from './Foo'` |
| 8 | 命名等其它 | 本地路径 | `import { x } from '@/utils'` |
| 9 | namespace | 本地路径 | `import * as u from '@/utils'` |
| 10 | `.vue` 组件 | 任意 | `import Foo from './Foo.vue'` |
| 11 | css / html / side-effect | 任意 | `import './a.css'`、`import 'reflect-metadata'` |
| 12 | 资源文件 | 任意 | `import logo from './logo.svg'` |

- Node 内置包：自动识别 `node:` 前缀与当前 Node 运行时的 `module.builtinModules`。
- 本地路径：`.`、`..` 或以 `./`、`../`、`@/`、`~` 开头。其余非内置来源（含 `#/`、`src/` 等别名）一律按外部包处理。
- `import type` 与普通 import 同组；支持 ES Import Attributes（`with` / `assert`）。

## 组内顺序

- 按导入语句本体（不含紧贴的前导说明注释）的文本长度升序，长度相同按字母序（第 11 组除外，保留原相对顺序以避免破坏样式层叠与副作用执行顺序）。
- 被注释掉的 import 参与分组，排在该组末尾（第 11 组保留原位）。
- 紧贴 import 上方的说明注释跟随该 import 移动；文件头注释与文件级指令（如 `@ts-nocheck`、`/* eslint-disable */`）始终保留在顶部，不会被移走。若文件顶部首条注释无空行紧贴第一条 import（且非单行 lint/ts 指令），脚本按文件头保守留顶、不跟随移动。

## 行为与限制

- 只处理文件顶部（shebang、指令、文件头注释之后）的第一个连续 import 块；若顶部无 import 或遇到无法闭合的异常语句，直接跳过原样返回。
- 块内原有空行先清除再重排，引入区与正文之间规范为 1 个空行；其余空行及 LF / CRLF、BOM 保持原样。
- 动态 `import()`、`import.meta` 不视为 import 语句。
- 第 11 组整体排在常规 import 之后；要求最先执行的裸 side-effect import（如 `reflect-metadata`、polyfill）不要交给脚本，改为手动保序。
