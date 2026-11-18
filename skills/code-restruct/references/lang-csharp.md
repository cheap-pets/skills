# 语言分册：C# (.NET)

配套 `SKILL.md` 步骤 1–4。C# 为强类型命名空间机制，静态依赖与脚本语言差异较大，按本分册规则执行。

## 1. 静态依赖边定义

- **核心注意**：C# 的 `using <Namespace>;` 指向命名空间而非具体物理文件，同命名空间内跨文件引用无需 `using`。**禁止单纯依赖 grep `using` 构建文件级依赖图**。
- **依赖边采集**：
  1. **项目级**：解析 `.csproj` 中的 `<ProjectReference>`。
  2. **文件/类级**：扫描类的构造函数注入参数类型、属性/字段类型声明与静态方法调用。

## 2. S1–S8 特化规则与扫描命令

### S7 多职责文件（P0）
- **特化规则**：通用阈值见 `playbook.md`（硬线 `>600` 行 / 软线 `400–600` 行 / 新拆文件目标 `≤350` 行）。自动排除 `*.g.cs`、`*.Designer.cs`、`*.AssemblyInfo.cs` 等生成代码，遵循“一文件一主类”惯例。拆分巨型类（God Class）时分两档处理：
  1. **紧耦合大类按业务域拆 `partial class`（归入 T2a，免探针基线）**：拆分为 `ClassName.Domain.cs`（同类型、无外部引用改写、不改 DI 注册与对外签名）。**静态核对项**：新文件各自补齐所需 `using`、`#nullable` 与 `#pragma` 指令；类级 Attribute 保持唯一不重复；若项目使用依赖文件名或语法树位置的 Source Generator，核对生成结果。
  2. **逻辑解耦提取独立 Service / Component（归入 T2b）**：新类须通过“浅模块删除测试”，并同步更新 DI 容器注册与构造函数注入点。
- **扫描命令**：
  > **注**：`<模块路径>` 须为仓库相对目录（如 `src/MyService`），传绝对路径或单文件路径时 `:(glob)` 不匹配，**空结果不等于无大文件**。
```bash
git ls-files -z -c -o --exclude-standard -- \
  ':(glob)<模块路径>/**/*.cs' \
  ':(glob,exclude)**/*.g.cs' ':(glob,exclude)**/*.Designer.cs' ':(glob,exclude)**/*.AssemblyInfo.cs' \
  | xargs -0 wc -l | awk '$1 > 400 && $2 != "total" {print $1, $2}' | sort -rn
```

### S5 跨层与环依赖（P0）
- **特化规则**：检查 `.csproj` 项目引用层级违例，以及 Infrastructure / Domain 层反向引用 Application / Web / UI / Controllers 层命名空间。若项目已有 ArchUnitNET 等架构测试，直接运行验证；无架构测试工具时，默认执行下方 `dotnet list reference` + 反向 `using` grep 降级核对（核对通过即计入“S5 已检查”）。
- **扫描命令**：
```bash
dotnet list <模块或解决方案路径> reference
grep -rnE "^using .*(\.Web|\.UI|\.Controllers)" --include="*.cs" <下层目录>
```

### S6 跨文件命名消歧（P1）
- **特化规则**：**大幅豁免**——强类型方法重载（Overload）、接口实现、LINQ 简写变量（`x`, `e`）一律不计入。仅消歧跨领域重名的同名 `class` / `interface` / `enum`（即导致文件头被迫写全限定名或 `using Alias = ...` 的冲突项），新名对齐领域术语。
- **扫描命令**：
```bash
grep -rnE "^using \w+\s*=\s*" --include="*.cs" <模块路径>
```

### S4 耦合性同源重复（P1）
- **特化规则**：同通用判据（注释自认需同步，或 `ast-grep` / AST 归一化比对完全一致）。
- **扫描命令**：
```bash
grep -rniE "copy of|同源|保持一致|keep in sync" --include="*.cs" <模块路径>
```

### S8 参数形态（P2，机会性接触即改）
- **特化规则**：
  - **构造函数注入参数 `>5`**：视为类职责过重，**关联 S7 拆分服务**，严禁把多个 DI 服务打包成无意义的 Wrapper 类。
  - **普通方法位置参数 `>5`（或 `≥3` 且含布尔旗标/同类型相邻/`null` 占位）**：接触调用点时顺带封装为 `record` 或 Parameter Class（**T4**）。
  - **豁免**：接口实现方法、抽象类/虚方法重写（`override`）、事件委托签名（`EventHandler` 等）、外部公共 API 方法。
- **扫描方式**：不采用易受跨行签名与泛型 `<K, V>` 逗号干扰的单行正则；优先使用 Roslyn / SonarAnalyzer 规则 **`S107`**（方法参数过多，将阈值设为 5）或 `ast-grep` / IDE 诊断在接触文件时核对。

### S1 内部纯转口（默认关闭）
- **特化规则**：C# 默认关闭 S1。仅在发现滥用 `global using` 别名转发或毫无自有逻辑的纯静态 Facade 转发类时顺带清理。
- **辅助扫描命令**：
```bash
grep -rnE "^global using " --include="*.cs" <模块路径>
```

### S2 / S3 隐式注入与可变状态（登记并顺带收敛）
- **特化规则**：不加 `@publishes/@handles/@resolves/@writes` 自定义注解，不写审计脚本。排查服务定位器反模式（`IServiceProvider.GetService`）、MediatR/事件总线跨模块隐式发布订阅（S2），以及 `static` 可变属性、Singleton 服务中的非线程安全可变字段、`HttpContext.Items["key"]` 字典（S3）。命中项在计划中登记为“已知隐式边”，在拆分（S7）顺带接触时优先改为显式构造函数注入或强类型上下文。
- **辅助排查命令**：
```bash
# S2 动态解析与事件发布排查
grep -rnE "GetService<|GetRequiredService<|\.Publish\(|\.Send\(" --include="*.cs" <模块路径>

# S3 静态可变状态与 HttpContext.Items 排查
grep -rnE "public static .* \{ get; set; \}|HttpContext\.Items\[" --include="*.cs" <模块路径>
```

## 3. R4 触点（C# 特化）

1. **反射与表达式树**：`Type.GetType`、`MethodInfo.Invoke`、`Activator.CreateInstance`、`nameof` 以外的硬编码类型/方法名字符串、动态编译表达式树。
2. **DI 容器按约定自动扫描注册**：如 Scrutor、AutoFac 按类名后缀或命名空间批量扫描注册（修改类名、提取新类或移动命名空间可能改变 DI 注册行为；单纯同命名空间拆 `partial class` 不改变类型元数据，但若存在按文件扫描的 Source Generator 需核对）。
3. **序列化与 ORM 跨边界契约**：JSON 序列化属性名（未显式标注 `[JsonPropertyName("...")]` 时改属性名会破坏接口契约）、EF Core 实体属性与表字段映射（未标 `[Column("...")]` 或 Fluent API 映射时改名会影响数据库查询与迁移）。

## 4. 验证工具链（遵循“不新增告警”口径）

- **build / 类型与编译检查**：
  ```bash
  dotnet build <模块或解决方案路径> --no-incremental
  ```
  比对起点 HEAD 的 warning 数量，确保**零 error 且不新增 warning**（仅当起点 HEAD 本身已零 warning 时，才附加 `-warnaserror`）。
- **既有测试**：
  ```bash
  dotnet test <测试项目路径> --no-build
  ```
- **探针基线口径（仅无测试且触发 R4/T2b 例外时使用）**：集成测试输出日志序列、关键 API 响应 JSON 快照。
