# 语言分册：Rust

配套 `SKILL.md` 步骤 1–4。Rust 借用检查器天然消除大部分非受控隐式可变状态，静态检索与分析的主要障碍在于内部模块重导出树（`pub use`）、巨型文件与宏展开。

## 1. 静态依赖边定义

- **依赖边**：Crate 间依赖看 `Cargo.toml`；Crate 内部看 `mod` 声明树与 `use crate::...` / `super::...` / `self::...` 路径。

## 2. S1–S8 特化规则与扫描命令

### S7 多职责文件（P0）
- **特化规则**：通用阈值见 `playbook.md`（硬线 `>600` 行 / 软线 `400–600` 行 / 新拆文件目标 `≤350` 行）。Rust 源文件常在文件底部包含内联单元测试 `#[cfg(test)] mod tests`，**判定行数时优先剔除底部 `mod tests` 测试块行数**（或先走 **T2a（免探针基线）** 将内联测试模块拆为同目录独立 `tests.rs` 子模块）。巨型 `.rs` 拆分为子模块时，先走 **T2a** 外提纯函数、常量、独立 `struct`/`enum` 定义，再走 **T2b** 拆分含复杂状态管理的实现块；新子模块必须通过“浅模块删除测试”，且可见性优先使用 `pub(super)` 或 `pub(crate)`，**不得盲目放宽为对外 `pub`**。
- **扫描命令**：
  > **注**：`<模块路径>` 须为仓库相对目录（如 `src` 或 `crates/core/src`），传绝对路径或单文件路径时 `:(glob)` 不匹配，**空结果不等于无大文件**。
```bash
git ls-files -z -c -o --exclude-standard -- ':(glob)<模块路径>/**/*.rs' \
  | xargs -0 wc -l | awk '$1 > 400 && $2 != "total" {print $1, $2}' | sort -rn
```

### S5 跨层与环依赖（P0）
- **特化规则**：Cargo Crate 之间天然无环，重点排查 **Crate 内部子模块间的环依赖与下层→上层反向引用**（下层 mod `use crate::上层`），以及底层模块因引入上层重型 `struct`/`trait` 导致的编译传递闭包膨胀。未安装 `cargo-modules` 时，默认执行下方反向 `use crate::` grep + `mod` 分层核对降级检查（核对通过即计入“S5 已检查”）。
- **扫描命令**：
```bash
# 1. 若已安装 cargo-modules，直接生成模块依赖图检查环与反向边
cargo modules dependencies --lib

# 2. 无工具默认降级核对：排查下层目录反向引用上层模块
grep -rnE "use crate::" --include="*.rs" <下层目录路径>
```

### S6 跨文件命名消歧（P1）
- **特化规则**：豁免标准库与生态通用 Trait 方法名（`from`, `into`, `try_from`, `new`, `default`, `fmt`, `run`, `build`）及局部短生命周期/泛型参数；聚焦因跨模块同名冲突而被迫使用 `use ... as ...` 重命名的类型或函数，新名对齐领域术语。
- **扫描命令**：
```bash
grep -rnE "use .* as \w+;" --include="*.rs" <模块路径>
```

### S4 耦合性同源重复（P1）
- **特化规则**：同通用判据（注意区分因泛型约束或孤儿规则限制而合理存在的 Trait 样板实现，此类样板豁免合并）。
- **扫描命令**：
```bash
grep -rniE "copy of|同源|保持一致|keep in sync" --include="*.rs" <模块路径>
```

### S8 参数形态（P2，机会性接触即改）
- **特化规则**：接触时顺带收敛。位置参数 `>5`（或 `≥3` 且含布尔旗标/同类型相邻/`Option` 连续占位）时，收敛为强类型 Config / Params `struct`（配合 `#[derive(Default)]` 或 Builder 模式，归入 **T4**）。
- **豁免**：`trait` 实现方法（`impl Trait for Type` 的方法签名由 Trait 定义锁定）、FFI 导出函数（`extern "C"`）、公共 Crate 暴露的对外 API 函数（走 API 冻结）。
- **扫描命令**（使用官方 Clippy 并将参数阈值临时设为 5；**使用当前工作目录下的相对路径 `.clippy-conf` 并在执行后清理，勿用 `/tmp` 以免在 Windows MSYS 环境下因路径映射静默失效**）：
```bash
mkdir -p .clippy-conf && echo 'too-many-arguments-threshold = 5' > .clippy-conf/clippy.toml
CLIPPY_CONF_DIR=.clippy-conf cargo clippy --all-targets -- -A clippy::all -W clippy::too_many_arguments
rm -rf .clippy-conf
```

### S1 内部纯转口（P2，按需清理）
- **特化规则**：**边界区分**——`lib.rs` 顶层用 `pub use` 聚合对外公共 API（Facade 模式）属 Rust 标准惯例，作为公共入口保留并在计划或收尾汇总中登记；**仅清理引发 Crate 内子模块环依赖（S5）或内部子模块间二跳以上的 `pub use` / `pub(crate) use` 纯转发与 `pub use *` 通配符转发**，令内部模块直接 `use` 定义所在 `mod`。
- **扫描命令**：
```bash
grep -rnE "^pub(\([^)]+\))? use " --include="*.rs" <模块路径>
```

### S2 / S3 隐式注入与可变状态（登记并顺带收敛）
- **特化规则**：不加 `@expands/@dispatches/@writes` 自定义注解，不写审计脚本。排查两类静态断链：① `macro_rules!` 动态生成标识符或过程宏属性隐式注入调用、以及 `Box<dyn Trait>` / `Arc<dyn Trait>` / `Any` downcast 动态分发（S2）；② 全局可变状态（`static mut`、`OnceLock<Mutex<...>>`、`LazyLock<RwLock<...>>`）及包含 `>20` 字段且到处传递 `&mut Context` 的巨型可变上下文结构体（S3）。命中项在计划中登记为“已知隐式边”，在拆分（S7）顺带接触时优先按子域拆小 Context 借用范围。
- **辅助排查命令**：
```bash
# S2 宏定义与动态分发排查
grep -rnE "Box<dyn |Arc<dyn |macro_rules!" --include="*.rs" <模块路径>

# S3 全局可变状态排查
grep -rnE "static (mut )?\w+:.*(Mutex|RwLock|OnceLock|LazyLock)" --include="*.rs" <模块路径>
```

## 3. R4 触点（Rust 特化）

1. **宏展开与 FFI 边界**：声明宏与过程宏展开（改名或拆模块可能破坏宏内部硬编码路径 `$crate::...`）、FFI 跨语言边界（`#[no_mangle]`、`extern "C"`）。
2. **`serde` 序列化契约**：标注了 `#[derive(Serialize, Deserialize)]` 的 `struct` 或 `enum`，在未显式指定 `#[serde(rename = "...")]` 时，修改字段名或枚举变体名会直接破坏持久化数据与外部通信协议。
3. **`Drop` 析构与锁释放顺序**：依赖 RAII `Drop` 析构先后顺序的资源管理代码或 `MutexGuard`/`RwLockWriteGuard` 作用域（拆分结构体字段或改变局部变量绑定顺序可能影响锁释放时序甚至引发死锁）。

## 4. 验证工具链（遵循“不新增告警”口径）

- **build / 类型与静态检查**：
  ```bash
  cargo check --all-targets
  cargo clippy --all-targets
  ```
  比对起点 HEAD 的 warning 数量，确保**零 error 且不新增 warning**（仅当起点 HEAD 本身已零 warning 时，才附加 `-- -D warnings`）。
- **既有测试**：
  ```bash
  cargo test
  ```
- **探针基线口径（仅无测试且触发 R4/T2b 例外时使用）**：`cargo test -- --nocapture` 捕获的日志/tracing 序列与关键结构断言快照。
