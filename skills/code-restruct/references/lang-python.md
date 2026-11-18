# 语言分册：Python

配套 `SKILL.md` 步骤 1–4。推荐配合 Python 标准库 `ast`、`tokenize` 或 `ast-grep` 执行结构化扫描与批量改写。

## 1. 静态依赖边定义

- **依赖边**：模块顶层 `import <mod>` 与 `from <mod> import <sym>`。
- **隐蔽边重点排查**：为绕过 `ImportError` 循环依赖而写在函数/方法体内部的延迟导入（local import）。

## 2. S1–S8 特化规则与扫描命令

### S7 多职责文件（P0）
- **特化规则**：通用阈值见 `playbook.md`（硬线 `>600` 行 / 软线 `400–600` 行 / 新拆文件目标 `≤350` 行）。巨型 `.py` 模块按业务域拆分为子模块（先走 **T2a（免探针基线）** 外提纯函数、常量、`dataclass`/`TypedDict`/`Pydantic` 模型，再走 **T2b** 拆分有状态服务或类），新模块须通过“浅模块删除测试”。
- **扫描命令**：
  > **注**：`<模块路径>` 须为仓库相对目录（如 `src/auth`），传绝对路径或单文件路径时 `:(glob)` 不匹配，**空结果不等于无大文件**。
```bash
git ls-files -z -c -o --exclude-standard -- ':(glob)<模块路径>/**/*.py' \
  | xargs -0 wc -l | awk '$1 > 400 && $2 != "total" {print $1, $2}' | sort -rn
```

### S5 跨层与环依赖（P0）
- **特化规则**：排查模块循环导入、下层反向引用上层，以及函数体内为掩盖循环依赖而写的延迟 `import`。无第三方工具时，默认运行下方 Python AST 延迟导入扫描 + 下层反向 `import` grep 降级核对（核对通过即计入“S5 已检查”）。
- **豁免说明**：① `if TYPE_CHECKING:` 块内的导入仅在静态类型检查时生效，不构成运行时环依赖，予以豁免；② 函数内 `try ... except ImportError:` 可选依赖兼容导入，或为避免启动时加载重型库（如大型科学计算/ML 库）而有意设计的按需延迟导入，人工核实后予以豁免。
- **扫描命令**：
```bash
# 1. 若已安装 import-linter 或 ruff（PLC0415 检查函数内非顶层导入）
lint-imports
ruff check --select PLC0415 <模块路径>

# 2. 默认降级核对（零外部依赖）：使用 Python AST 扫描函数/方法体内的延迟导入行号
python3 - <模块路径> <<'EOF'
import ast, glob, os, sys, tokenize
root = sys.argv[1] if len(sys.argv) > 1 else "src"
pattern = os.path.join(root, "**", "*.py") if os.path.isdir(root) else root
for p in sorted(glob.glob(pattern, recursive=True)):
    try:
        with tokenize.open(p) as f:
            tree = ast.parse(f.read(), filename=p)
    except Exception:
        continue
    hits = set()
    for fn in ast.walk(tree):
        if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            hits.update(n.lineno for n in ast.walk(fn) if isinstance(n, (ast.Import, ast.ImportFrom)))
    for ln in sorted(hits):
        print(f"{p}:{ln}")
EOF

# 3. 反向 import 核对：列出下层目录全部顶层导入语句，人工核对其中对上层模块的引用
grep -rnE "^(from|import) " --include="*.py" <下层目录路径>
```

### S6 跨文件命名消歧（P1）
- **特化规则**：豁免 Python 惯用短名（`cls`, `self`, `df`, `db`, `pk`, `id`, `err`）、私有符号（`_` 开头）、测试函数（`test_` 开头）与入口 `main`。聚焦跨模块重复定义的同名顶层函数、类名或全局配置名。
- **扫描命令**：
```bash
python3 - <模块路径> <<'EOF'
import ast, collections, glob, os, sys, tokenize
root = sys.argv[1] if len(sys.argv) > 1 else "src"
pattern = os.path.join(root, "**", "*.py") if os.path.isdir(root) else root
names = collections.defaultdict(list)
for p in sorted(glob.glob(pattern, recursive=True)):
    try:
        with tokenize.open(p) as f:
            tree = ast.parse(f.read(), filename=p)
    except Exception:
        continue
    for n in tree.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) \
           and not n.name.startswith(("_", "test_")) and n.name != "main":
            names[n.name].append(p)
for k, v in sorted(names.items(), key=lambda kv: -len(kv[1])):
    if len(v) > 1:
        print(f"{len(v):3d} {k}: {', '.join(v[:4])}")
EOF
```

### S4 耦合性同源重复（P1）
- **特化规则**：双证据任一（注释自认需同步，或 `ast` 模块归一化比对完全一致）。
- **扫描命令**：
```bash
grep -rniE "copy of|同源|保持一致|keep in sync" --include="*.py" <模块路径>
```

### S8 参数形态（P2，机会性接触即改）
- **特化规则**：接触时顺带收敛。位置参数 `>5`（剔除首个 `self`/`cls`），或 `≥3` 且含布尔旗标/同类型相邻/`None` 占位时，优先在签名中加入 `*,` 转为 **Keyword-Only 参数**，或收敛为 `@dataclass(frozen=True)` / `TypedDict` / `Pydantic BaseModel`。
- **红线与注意**：① **严禁退化为无类型 `dict` 或 `**kwargs`**（否则直接制造新的 S2 隐式依赖）；② 将位置参数改为 Keyword-Only 会破坏按位置传参的调用点，必须同批核对并更新全部调用点（有类型注解时 `mypy` / `pyright` 可自动报错兜底）；③ 豁免 Web 框架路由函数、Pytest fixture、Django/blinker 信号 `receiver`、抽象基类 `abstractmethod` 重写及公共导出函数。
- **扫描命令**（使用 `tokenize.open` 兼容文件编码声明，精确统计 `posonlyargs + args`）：
```bash
python3 -c "import ast, glob, os, sys, tokenize; root = sys.argv[1] if len(sys.argv) > 1 else 'src'; pat = os.path.join(root, '**', '*.py') if os.path.isdir(root) else root; [print(f'{p}:{n.lineno} {n.name} ({a} pos args)') for p in sorted(glob.glob(pat, recursive=True)) for n in ast.walk(ast.parse(tokenize.open(p).read())) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) for a in [len(n.args.posonlyargs) + len(n.args.args) - (1 if n.args.args and n.args.args[0].arg in ('self', 'cls') else 0)] if a > 5]" <模块路径>
```

### S1 内部纯转口（P2，按需清理）
- **特化规则**：**生态豁免**——包根部通过 `__init__.py` 显式声明 `__all__` 暴露公共 API 属 Python 标准惯例，保留并在计划或收尾汇总中登记。仅清理引发 S5 环依赖、**未声明 `__all__` 的通配转口（`from .x import *`）**、或内部子目录中不含任何 `def`/`class` 定义的二跳纯中转模块（含相对导入与同包绝对导入转发）。
- **扫描命令**：
  > **注**：`<模块路径>` 须为仓库相对目录（如 `src/auth`）。
```bash
# 1. 扫描 __init__.py 中的相对导入转口与通配转口
grep -rnE "^from \..* import" --include="__init__.py" <模块路径>

# 2. 列出模块内不含任何函数或类定义的 .py 文件作为纯转口候选（人工核对是否仅含 import/__all__）
git ls-files -c -o --exclude-standard -- ':(glob)<模块路径>/**/*.py' | while read -r f; do
  grep -qE "^(async def|def|class) " "$f" || echo "$f"
done
```

### S2 / S3 隐式注入与可变状态（登记并顺带收敛）
- **特化规则**：不加 `@reads/@writes` 注解，不写审计脚本。针对跨文件透传的大 `dict`/`**kwargs`、动态 `setattr/getattr` 上下文对象（S2）及模块级可变全局容器（全局 `dict`/`list`，S3），在计划中登记为“已知隐式边”；在执行 S7/S5 顺带接触时，优先收敛为显式 `dataclass`/`TypedDict` 参数或类方法。
- **辅助排查命令**：
```bash
grep -rnE "^[A-Za-z_]\w*\s*=\s*(\{|\[\]|dict\(|list\(|set\()" --include="*.py" <模块路径>
```

## 3. R4 触点（Python 特化）

1. **反射与动态导入**：`getattr()` / `setattr()` / `globals()` / `importlib.import_module()` 动态调用。
2. **装饰器与模块顶层注册副作用**：Flask/FastAPI 路由装饰器、Celery `@app.task`、Pytest `@pytest.fixture`、SQLAlchemy 模型元类注册、Django 信号接收器——搬移或删减 `import` 若导致模块在启动时未被导入，会使注册静默丢失。
3. **跨边界字符串契约**：字典序列化键名、Pydantic `Field(alias=...)`、ORM 模型字段名（映射数据库列）、原生 SQL 字符串拼接。

## 4. 验证工具链（遵循“不新增告警”口径）

- **build / 类型与静态检查**：
  ```bash
  python3 -m compileall -q <模块路径>
  mypy <模块路径>       # 或 pyright <模块路径>（比对起点 HEAD，不新增错误/告警）
  ruff check <模块路径> # 比对起点 HEAD，不新增告警
  ```
- **既有测试**：`pytest`（只读冻结）。
- **探针基线口径（仅无测试且触发 R4/T2b 例外时使用）**：`pytest -s` 或入口脚本捕获的标准输出/结构化日志序列 + 关键函数返回值 JSON 序列化快照。
