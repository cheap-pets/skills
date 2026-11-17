# 流水线：完整开发（dev）

探索 → 设计 + 评审 → 确认门 → 实施 + 验证。

## 前置

按 `references/start.md` 执行（需问用户的项合并为**一次**提问）：
1. 运行 `node <skill 目录>/scripts/pipeline-ctl.mjs init <task_dir>` 建立任务目录与 `00-baseline.txt`。
2. 编写 `00-task.md`（目标、基线指针、验收标准、验证命令、验证环境、忽略路径、开关，其中 `on_design_blocked` 设为 `return_to_design`）。验收标准缺失或不可逐条打勾时先澄清。
3. 按 `references/start.md`「启动确认窗口」向用户展示全链构成（P1–P4）、各开关当前值与待澄清项，确认后开始派发。

## 阶段与状态转移表

`P2` 内部转移遵循 `pipelines/design-review.md`，`P4` 内部转移遵循 `pipelines/impl-verify.md`。下表定义跨阶段衔接与覆盖转移：

| 阶段 | 角色（默认槽位） | 读 | 写 | 返回值 / 事件 → 下一步动作 | 计数键与上限 | 耗尽去向 |
|---|---|---|---|---|---|---|
| **P1 探索** | explorer（`executor`） | `00-task.md`, `decisions.md` | `01-explore[-<x>].md` | - 启动窗口选“跳过探索” → 直接进 P2<br>- `决策冲突 > 0` 或 `未解问题 > 0`（需用户答复） → 停下合并询问用户，答复记 `decisions.md` 后进 P2<br>- `未解问题 > 0`（需补查代码） → 派 explorer 写 `01-explore-补-1.md` 后进 P2<br>- 正常返回 → 进 P2 | 补探索 ≤ 1（看 `01-explore-补-1.md` 是否存在） | 需第 2 次补探索 → 停下询问用户 |
| **P2 设计 + 评审** | designer（`primary`）+ design-reviewer（`peer`） | 见 `design-review.md` | `02-design.md`, `03-review-r.md`, `02-response-*.md` | - 评审 `APPROVE`（状态 `通过`） → 进 P3 确认门<br>- 修订上限耗尽或人工修订跳过重审（状态 `未通过` / `未经评审`） → 进 P3 确认门 | 自动修订 `k/N`（周期锚点 `r_base`） | `k == N` → 带 `未通过` 进 P3 确认门 |
| **P3 确认门** | 用户 | `02-design.md` | `decisions.md`（如有指令） | - 确认门开关为 `自动` 且设计状态为 `通过` → 打印确认门摘要后直接进 P4<br>- 用户指令“实施 / 确认 / 继续” → 进 P4（若状态为 `未通过` / `未经评审`，将接受风险记入 `decisions.md`）<br>- 用户指令“修订 / 已手改 / 再评审 / 补探索 / 改开关” → 按下方确认门指令表处理 | — | — |
| **P4 实施 + 验证** | implementer（`executor`）+ verifier（`executor`）[+ code-reviewer（`peer`）] | 见 `impl-verify.md` | `04-impl*.md`, `05-verify*.md`, `evidence/`[, `06-codereview-N.md`] | - 终验 `PASS`（且规范审查未开或 `PASS`） → 进「结束」<br>- I1 返回 `BLOCKED(设计遗漏 \| 设计事实有误)`，或 `check-scope` 检出 `清单外改动` 且需补设计 → **自动触发回设计**（见下方回设计流程；非 git 下 `check-scope` 为 `skipped`，无清单外检出，不触发本条） | 修复轮 `k/R`（按每键）；<br>回设计 `j/回头上限` | 任一耗尽 → 停下给三项选择（见 `references/comms.md`） |

**P1 并发探索**：默认单实例写 `01-explore.md`。若代码库跨多个互不重叠的顶层目录 / 子系统，可在同一消息中并发派发多个 `explorer`，各自指定互不重叠的目录范围并分别输出 `01-explore-<x>.md`（`verify-readonly` 的 `--allow` 传入全部 `01-explore-*.md`）；拿不准边界时只派一个。

**回设计流程（P4 触发 `return_to_design` 时）**：
1. 运行 `node <skill 目录>/scripts/pipeline-ctl.mjs status <task_dir>` 获取当前 `return_to_design_j` 与 `max_review_r`。
2. 若 `return_to_design_j >= 回头上限` → 停下向用户汇报偏离事实与产物路径，给出耗尽三项选择（见 `references/comms.md`）。
3. 未达上限 → 在 `decisions.md` 追加一行 `- [回设计 <j+1> | r_base=<max_review_r> | 来源=BLOCKED 或 check-scope] <触发阶段与偏离原因>`（I1 `BLOCKED` 触发记 `来源=BLOCKED`；`check-scope` 清单外改动触发记 `来源=check-scope`；`来源` 供会话恢复判据区分两种触发，见 `references/start.md`）。
4. 回 P2：派 `designer` 修订模式（读取触发该回设计的 `04-impl*.md`「偏离」或 `check-scope` 清单外改动结果，更新 `02-design.md` 并在末尾写 `## 偏离处理`；本次偏离修订不写 `02-response`、不占新周期的 $N$ 额度）→ 派 `design-reviewer` 评审（写 `03-review-(max_review_r+1).md`）。此后新周期的自动修订数 $k$ 从 `r > r_base` 重新起算。
5. P2 重新获得 `APPROVE` 后 → 不经 P3 确认门，直接以 `implementer / 续做` 模式重进 P4 的 I1（若仅补写「改动清单」而无源码步骤变更，则不派 I1，直接重跑 `check-scope` 与 I2）。若 P2 修订耗尽仍 `未通过` → 回到 P3 确认门由用户裁决。

## 确认门（P3）

展示 `design-review.md`「检查点」的全部内容，并附当前实施开关配置（实施粒度、是否逐片验收、TDD、规范审查、验证环境）。指令集在 `design-review.md`「检查点」指令表基础上增加：

| 用户指令 | 动作 |
|---|---|
| 实施 / 确认 / 继续 | 进入 P4（若设计状态为 `未通过` / `未经评审`，将接受已知风险记入 `decisions.md`） |
| 严格 | 开启 `逐片` + `规范审查` + `TDD` + `逐片验收`，更新 `00-task.md`，回到本门（或与“实施”组合直接进 P4） |
| 实施开关：`整体` / `逐片`、`TDD`、`规范审查`、`逐片验收`、`片验证全量` | 更新 `00-task.md`（若由整体改逐片而 `02-design.md` 未切片，先派 `designer` 修订模式补切片），回到本门或直接进 P4 |
| 上限：修订 N / 修复 R / 回头 <数> | 更新 `00-task.md` 并记入 `decisions.md`，回到本门 |
| 终止 | 停止并保留产物，按 `references/comms.md`「结束汇报」输出 |

## 结束

按 `references/comms.md`「结束汇报」模板输出，注明设计评审总轮次（最大 `03-review-*` 序号）、回设计次数及各阶段关键 verdict。
