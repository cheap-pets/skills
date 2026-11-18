# 语言分册：JavaScript / TypeScript / Vue

配套 `SKILL.md` 步骤 1–4。以 JavaScript（ESM 与 CommonJS）及 TypeScript 为覆盖对象，同时涵盖 Vue（含 MUSSEL 等组件库）与 React 前端及 Node.js 模块。推荐配合 `ast-grep`（注意：Linux 下请使用完整命令名 `ast-grep`，勿简写为 `sg` 以免与系统自带 `sg` 命令冲突）或 LSP 执行结构化扫描与批量改写。

## 1. 静态依赖边定义

- **依赖边**：ES Module 的静态 `import ... from` 与 `export ... from` 语句，以及 CommonJS 的 `require()` 调用（ESM 与 CJS 同权计入）。

## 2. S1–S8 特化规则与扫描命令

### S7 多职责文件（P0）
- **特化规则**：通用阈值见 `playbook.md`（硬线 `>600` 行 / 软线 `400–600` 行 / 新拆文件目标 `≤350` 行）。`.vue` 单文件组件若含大段 `<template>` / `<style>`，以**整文件 `>600` 行（硬线）**或 **`<script>` 块 `>400` 行**作为触发条件；拆分时优先先走 **T2a（免探针基线）** 外提纯工具函数、静态配置与 TS `interface`/`type`，再走 **T2b** 抽离高内聚 Composable（`use*.ts` / `use*.js`），严禁拆出透传 props/events 的碎片浅组件。自动排除 `*.d.ts` 类型声明文件。
- **扫描命令**：
  > **注**：`<模块路径>` 须为仓库相对目录（如 `src/auth`），传绝对路径或单文件路径时 `:(glob)` 不匹配，**空结果不等于无大文件**。
```bash
git ls-files -z -c -o --exclude-standard -- \
  ':(glob)<模块路径>/**/*.ts' ':(glob)<模块路径>/**/*.tsx' \
  ':(glob)<模块路径>/**/*.js' ':(glob)<模块路径>/**/*.jsx' \
  ':(glob)<模块路径>/**/*.mjs' ':(glob)<模块路径>/**/*.cjs' \
  ':(glob)<模块路径>/**/*.vue' ':(glob,exclude)**/*.d.ts' \
  | xargs -0 wc -l | awk '$1 > 400 && $2 != "total" {print $1, $2}' | sort -rn
```

### S5 跨层与环依赖（P0）
- **特化规则**：排查模块环依赖，以及底层工具/模型层反向 `import` 上层 UI 组件或视图层。
  - **首选工具**：`dependency-cruiser`（原生支持 `.vue` 与 TS `paths` 别名；若无配置可通过 `npx depcruise --init` 生成，解析 `.vue` 需项目已装 `@vue/compiler-sfc`）。
  - **备选工具**：纯 JS/TS 项目可用 `madge` 零配置扫描（对 `.vue` 支持有限）。
  - **无工具默认降级核对**：当上述工具均不可用时，默认运行下方反向 `import` grep + 目录分层人工核对（核对通过即计入“S5 已检查”）；S7 拆大文件前同样可用该 grep 检查目标文件是否与邻近模块互引成环。
- **扫描命令**：
```bash
# 1. 首选（支持 .vue 与 tsconfig 路径）
npx depcruise <模块路径>

# 2. 备选（纯 JS/TS 环依赖快速扫描）
npx madge --circular --extensions ts,tsx,js,jsx --ts-config tsconfig.json <模块路径>

# 3. 无工具默认降级核对：排查下层目录反向 import 上层视图/组件目录
grep -rnE "from ['\"].*(views|pages|components)/|require\(['\"].*(views|pages|components)/" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.mjs" --include="*.cjs" --include="*.vue" \
  <下层目录路径>
```

### S6 跨文件命名消歧（P1）
- **特化规则**：豁免标准生命周期、局部短变量与框架保留字（`ref`, `h`, `el`, `id`, `fn`）。聚焦**跨文件重复导出的同名符号**，以及 Pinia/Vuex Store 字段、组件 `Props`/`Emits`、参数袋键名中的泛化同名异义词（如跨模块混用的 `data`, `info`, `item`, `list`, `value`, `res`, `obj`）。优先用 LSP Rename 或 `ast-grep` 重命名。
- **扫描与定位命令**：
```bash
# 1. 扫描跨文件重复声明导出的同名标识符
# 局限说明：不覆盖 export { a, b } 列表式导出与 .vue 内联导出；Props/Emits 等按文件局部命名的类型同名属正常现象，人工忽略
grep -rhoE "export (default )?(async )?(const|let|function|class|type|interface|enum) [A-Za-z0-9_]+" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.mjs" --include="*.cjs" --include="*.vue" <模块路径> \
  | awk '{print $NF}' | sort | uniq -c | awk '$1 > 1' | sort -rn

# 2. 定位命中符号所在的具体文件与行号（将 <符号> 替换为上一步命中的名称）
grep -rnE "export (default )?(async )?(const|let|function|class|type|interface|enum) <符号>\b" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.mjs" --include="*.cjs" --include="*.vue" <模块路径>
```
  > **补充排查**：Store/Context 字段与参数袋键名不被上述 `export` 命令覆盖，在阅读目标模块 Store 定义与上下文对象时，按特化规则逐个人工或用 `ast-grep` 核对。

### S4 耦合性同源重复（P1）
- **特化规则**：双证据任一（注释自认需同步，或 `ast-grep` / AST 归一化比对完全一致）。
- **扫描命令**：
```bash
grep -rniE "copy of|同源|保持一致|keep in sync" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.mjs" --include="*.cjs" --include="*.vue" \
  <模块路径>
```

### S8 参数形态（P2，机会性接触即改）
- **特化规则**：接触函数时顺带处理，不开专项批次。位置参数 `>5`，或 `≥3` 且含布尔旗标/同类型相邻/`undefined` 占位/连续透传 `≥2` 层时，转为 Options 对象（TS 用 `interface`，纯 JS 用对象字面量 + JSDoc `@typedef`）。
- **豁免**：框架或组件库规定的回调签名（如 MUSSEL 组件的 `formatter` / `validator` 回调、Vue `emit`、数组高阶函数回调）、接口实现方法、被包外消费的公共导出函数（走 API 冻结）、S2 参数袋。
- **Composable 响应性红线**：Options 对象传入 Composable 时，响应式参数必须传 `Ref` 或 getter（`() => state.xxx`，内部配合 `toValue`），**严禁在调用点解构 `reactive` 后传原始值**，否则丢失响应性。
- **扫描命令**：
```bash
# 首选：项目已有 ESLint 配置时，一条规则覆盖函数声明、箭头函数与对象方法简写
npx eslint <模块路径> --rule '{"max-params": ["warn", 5]}'

# 退化路径：无 ESLint 配置或命令失败时，改用 ast-grep 扫描 >5 参数函数，或在接触文件时人工核对签名
ast-grep run -p 'function $FN($A, $B, $C, $D, $E, $F, $$$) { $$$ }' <模块路径>
```

### S1 内部纯转口（P2，按需清理）
- **特化规则**：包对外入口（`package.json` 的 `main`/`exports` 指向的根 `index.js` / `index.ts`）保留并在计划或收尾汇总中登记（走 API 冻结）；**仅清理引发 S5 环依赖或二跳以上嵌套转发的内部 `index.js` / `index.ts`**（含 ESM `export ... from` 与 CJS `module.exports = require(...)`）。
- **扫描命令**：
```bash
grep -rnE "^export (\*|\{[^}]*\}) from|^module\.exports = require\(|^exports\.\w+ = require\(|^Object\.assign\(module\.exports" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.mjs" --include="*.cjs" --include="*.vue" \
  <模块路径>
```

### S2 / S3 隐式注入与可变状态（登记并顺带收敛）
- **特化规则**：不加 `@reads/@writes` 注解，不写审计脚本。S3 在 TS + Pinia 栈中由 LSP 追踪即可，对于过大的 Pinia Store，在拆分或接触时引导将直接字段赋值收敛至 Store `actions`；无类型 JS 的跨文件可变上下文或参数袋在计划中登记为“已知隐式边”。
- **辅助排查命令**：
```bash
grep -rnE "\b<袋名>\.<键名>\b" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.mjs" --include="*.cjs" --include="*.vue" <模块路径>
grep -rnE "<状态对象名>\.\w+\s*=[^=]" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.mjs" --include="*.cjs" --include="*.vue" <模块路径>
```

## 3. R4 触点（JS / TS / Vue 特化）

1. **动态访问与当值传递**：动态 `import()`、对象动态属性访问 `obj[key]`、字符串模板拼接键名；函数被作为值传递（`arr.map(fn)`、`@click="fn"`、`.bind/.call/.apply`、作为回调传给子组件——改参数签名会静默错位）。
2. **模块顶层副作用**：含顶层自执行逻辑或全局注册的模块（删转口或解环可能改变模块初始化求值顺序）。
3. **Vue 与跨边界字符串契约**：
   - `<template>` 模板内隐式绑定引用、动态组件名、`emit` 事件名、slot 插槽名、`v-model` 参数名（含 MUSSEL 组件契约）。
   - `<script setup>` 的 `defineExpose` 暴露成员、`provide / inject` 的 key。
   - **Composable 抽取时序**：从组件 `setup` 中抽离含 `watch`、`watchEffect`、`onMounted` 等生命周期钩子的 Composable（T2b）时，必须保持钩子注册的相对先后顺序不变。
   - 前后端 JSON 序列化字段名、路由参数名、i18n 国际化字典 key。

## 4. 验证工具链（遵循“不新增告警”口径）

- **build / 类型检查**：
  - Vue + TS 项目：`npx vue-tsc --noEmit` + `npm run build`（必须用 `vue-tsc` 检查模板绑定，单跑 `tsc` 看不到 `<template>` 错误）。
  - 纯 TS 项目：`npx tsc --noEmit` + `npm run build`。
  - 纯 JS 项目：`npm run build` + `npx eslint <模块路径>`（比对起点 HEAD，零错误且不新增 warning）。
- **既有测试**：`npx vitest run` 或 `npx jest`（只读冻结）。
- **探针基线口径（仅无测试且触发 R4/T2b 例外时使用）**：控制台 `console.warn` / `console.error` 原文序列 + 关键渲染节点计数或 DOM 快照（也可经用户确认用人工冒烟清单替代）。
