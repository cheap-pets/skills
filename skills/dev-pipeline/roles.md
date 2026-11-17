# 角色注册表

调度者据此确定角色、契约文件、默认槽位、权限类、`00-task.md` 必需项与产物命名；返回格式与模式见下方「模式矩阵」。新增角色见 `maint/authoring.md`（当前冻结扩展）。契约文件位于 `agents/`。

| 角色 | 契约文件 | 默认槽位（回退） | 权限类 | 独立于 | `00-task.md` 必需项 | 产物 |
|---|---|---|---|---|---|---|
| explorer | pipeline-explorer.md | 常规：`executor`（→peer→primary）；缺陷定位：`primary`（→peer） | 只写产物 | — | 目标 | `01-explore[-<x>\|-补-N\|-回-N].md` |
| designer | pipeline-designer.md | `primary`（→peer） | 改设计 | — | 目标、验收标准 | `02-design.md`；`02-response-r.md`；`02-response-人工-K.md` |
| design-reviewer | pipeline-design-reviewer.md | `peer`（→primary 独立实例） | 只写产物 | designer | 目标、验收标准 | `03-review-r.md` |
| implementer | pipeline-implementer.md | `executor`（→peer→primary） | 改源码 | — | 目标、设计文档路径 | `04-impl[-<片>].md`；`04-impl-<键>-续-N.md`；`04-impl-<键>-修复-N.md`；`04-impl-<键>-人工修复-K.md` + 源码 |
| verifier | pipeline-verifier.md | `executor`（→peer→primary 独立实例） | 只写产物 | implementer | 目标、验收标准、验证命令、基线、验证环境（如有） | `05-verify-<键>-N.md`（`<键>`：`整体` / `片N` / `终`）+ `evidence/` |
| code-reviewer | pipeline-code-reviewer.md | `peer`（→primary 独立实例） | 只写产物 | implementer | 目标、基线 | `06-codereview-N.md` |

## 模式矩阵

模式由派发块指定，未指定即为默认模式；本表是模式词表的唯一来源（契约与流水线不得私自增删模式名）。

| 角色 / 模式 | 触发（派发指定） | 输入要点 | 输出 | 返回格式（末项统一附冲突或问题计数） |
|---|---|---|---|---|
| explorer（唯一模式） | 探索 / 定位 / 补探索 | `00-task.md` +（定位）`00-repro.txt` | `01-explore*.md` | 路径 + 3 条关键发现 + 未解问题数 + `决策冲突：<N>` |
| designer / 默认 | 出设计 | `00-task.md` + `01-explore*.md`（可选） | `02-design.md` | 路径 + 方案一句话 + 未解问题数 |
| designer / 修订 | 评审 REVISE / 人工意见 / 实施偏离 / 补探索 | 最新评审或意见或偏离 + `02-design.md` | `02-design.md` +（评审/人工）回应文件 | 路径 + 方案一句话 + 未解问题数 + 不接受数 + 不可行数 |
| designer / 精简 | 步骤清单已明确 | `00-task.md` + 步骤清单 | `02-design.md`（薄，不切片） | 同默认 |
| designer / 缺陷修复 | `bugfix-verify` B2 | `00-task.md` + `01-explore*.md` | `02-design.md`（≤3 步，回归先行） | 同默认 |
| design-reviewer（唯一模式：独立） | 评审设计 | `00-task.md` + `02-design.md`（复审另读上轮评审、上轮回应及新增人工意见） | `03-review-r.md` | `VERDICT: APPROVE\|REVISE` + 路径 + blocker/major/minor 数 + 最严重问题一句话 |
| implementer / 默认 | 整体按设计实施 | `00-task.md` + `02-design.md` + `00-baseline.txt` | `04-impl.md` + 源码 | `STATUS: DONE\|BLOCKED(类型)` + 路径 + 一句话说明 + `决策冲突：<N>` |
| implementer / 片 | 逐片实施（传片编号） | 同上 + 已完成片 `04-impl-片*.md` | `04-impl-<片>.md` + 源码 | 同默认 |
| implementer / 续做 | 回设计或回方案后重实施 | 全部 `04*` + 更新后的 `02-design.md` | `04-impl-<键>-续-N.md` + 源码 | 同默认 |
| implementer / 修复 | 验证 / 审查 / 人工意见 FAIL | 全部 `04*` + 失败报告或 `05-human-K.md` | 自动/逐片停点：`04-impl-<键>-修复-N.md`；中途人工：`04-impl-<键>-人工修复-K.md` | 同默认 |
| verifier / 默认（整体） | 整体实施独立验证 | `00-task.md` + `02-design.md` + 全部 `04*` + `check-scope` 结果 | `05-verify-整体-N.md` + `evidence/` | `VERDICT: PASS\|FAIL` + 路径 + FAIL/UNVERIFIED/需人工/环境阻塞数 + `决策冲突：<N>` |
| verifier / 片 | 逐片独立验证（传片编号） | `00-task.md` + `02-design.md` + 本片 `04*` + `check-scope` 结果 | `05-verify-<片>-N.md` + `evidence/` | 同默认 |
| verifier / 终验 | 逐片全部完成后全量重验 | `00-task.md` + `02-design.md` + 全部 `04*` + 各片 `05*` 验收入口 + `check-scope` 结果 | `05-verify-终-N.md` + `evidence/` | 同默认 |
| code-reviewer（唯一模式） | 规范与设计一致性审查 | `00-task.md` + `00-baseline.txt` + `02-design.md`（单点可选）+ 全部 `04*` | `06-codereview-N.md` | `VERDICT: PASS\|FAIL` + 路径 + blocker/major/minor 数 + 最严重问题 + `决策冲突：<N>` |

## 约定

- **槽位别名**：`executor` 也可写作 `exec`。
- **权限类**（三层保障：槽位级宿主 `tools` 强制（`slots/*.md`）+ 角色级契约约束 + 派发后 `pipeline-ctl.mjs verify-readonly` 确定性校验；通用子智能体降级路径无第一层）：
  - **只写产物**：不改源码、不改设计文档，只写自身输出文件（`verifier` 另可写 `evidence/`）；
  - **改设计**：仅 `designer` 持有，可 Write / Edit `02-design.md` 并 Write 回应文件，不改源码，Bash 仅限只读；
  - **改源码**：仅 `implementer` 持有，可 Edit / Write 源码并 Write 实施记录。
- **断点接续（仅限 implementer）**：当 `implementer` 异常中断，其输出文件已存在且首行为占位值 `STATUS: 进行中` 时，调度者重派同一模式并在追加约束注明`接续（沿用原输出文件路径 <path>）`；只读角色（explorer / design-reviewer / verifier / code-reviewer）中断直接重跑，不走接续。
- **命名与计数键约定**：
  - 段号：`01` 探索、`02` 设计与回应、`03` 设计评审与设计人工意见、`04` 实施、`05` 验证与实施人工意见、`06` 规范审查。同前缀序号按最大序号 + 1 递增，绝不覆盖旧文件。
  - `<键>` 统一枚举：`整体`（整体实施模式）、`片1`..`片S`（逐片模式各片）、`终`（逐片模式的终验阶段）。`04-impl-<键>-修复-N.md` 与 `05-verify-<键>-N.md` 的 `<键>` 严格对应。
  - 回应文件与被回应评审文件同号配对：`02-response-r.md` ↔ `03-review-r.md`；人工修订回应：`02-response-人工-K.md` ↔ `03-human-K.md`。
  - 辅助协议文件：`00-task.md`（任务定义，≤60 行）、`00-baseline.txt`（基线快照与文件哈希）、`00-repro.txt`（缺陷原始报错栈与长复现日志，可选）、`decisions.md`（已确认决策与回设计/回方案标记）、`run.log`（派发审计台账）。
- **人工意见文件**：
  - 设计意见：写入 `03-human-K.md`（首行 `VERDICT: REVISE`）；
  - 实施意见：写入 `05-human-K.md`（首行 `VERDICT: FAIL`）；
  - 每条格式固定为 `- [K-n] <用户原文>`，不改写、不合并，两前缀序号各自递增。
