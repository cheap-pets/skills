# 流水线：实施 + 验证（impl-verify）

按已确认的设计实施 → 确定性范围核对 → 独立验证（+ 可选规范与设计一致性审查）→（修复）。

## 前置

1. **独立运行时**（非 `dev` P4 / 非 `bugfix-verify` 进入）：
   - 按 `references/start.md` 执行 `pipeline-ctl.mjs init <task_dir>`（任务目录与 `00-baseline.txt` 已存在则跳过 `init`，沿用原基线），写 `00-task.md`（含验收标准、验证命令、验证环境、忽略路径、开关，其中 `on_design_blocked` 默认设为 `ask_user`）。
   - **设计输入校验**：检查 `.pipeline/<task>/02-design.md`（若用户指定了外部设计文档，复制为 `02-design.md`，原路径记入 `00-task.md`）。确认含「改动清单」「测试计划」「实施步骤」三节：齐全则开启 `references/start.md`「启动确认窗口」后进入 I1；缺任一节则询问用户是用 `design-review` 补全还是终止；若用户只给步骤清单，可派 `designer / 精简` 生成薄 `02-design.md`（标 `未经评审`），展示 ≤15 行摘要经用户确认后继续。
2. **验证环境检查**：若 `02-design.md`「测试计划」含 `浏览器` 或 `HTTP` 手段，确认 `00-task.md` 已填写启动命令与 base URL（含 `浏览器` 时确认子智能体具备可用浏览器工具或 E2E 命令，不可用则提示用户改 `HTTP` 或 `人工`）。

## 阶段与状态转移表

- **整体实施（默认）**：`<键>` 固定为 `整体`。执行一次 `I1（默认模式）` → `check-scope` → `I2（默认/整体模式，输出 05-verify-整体-N.md）` →（若开启规范审查）`I3` → 结束。
- **逐片实施（开启“逐片”或“逐片验收”时）**：按 `02-design.md`「实施步骤」中的片依赖顺序，对每片依次执行 `I1（片模式，<键>=片N）` → `check-scope` → `I2（片模式，输出 05-verify-片N-N.md）`（若开启“逐片验收”，每片 `PASS` 后进入下方「逐片验收停点」）。所有片 `PASS` 后，执行一次终验：`check-scope` → `I2（终验模式，<键>=终，输出 05-verify-终-N.md）` →（若开启规范审查）`I3` → 结束。

| 阶段 | 角色（默认槽位） | 读 | 写 | 返回值 / 脚本输出 → 下一步动作 | 计数键与上限 | 耗尽去向 |
|---|---|---|---|---|---|---|
| **I1 实施** | implementer（`executor`） | `00-task.md`, `decisions.md`, `01-explore*.md`（如有）, `02-design.md`；片模式另读已完成片最新 `04*`；修复 / 续做读全部 `04*` 及触发报告 | `04-impl[-<片>].md` 或 `04-impl-<键>-续-N.md` 或 `04-impl-<键>-修复-N.md` + 源码 | - `决策冲突 > 0` → 停下读正文冲突处并询问用户<br>- `STATUS: BLOCKED(需确认)` → 停下询问用户，获批后记 `decisions.md` 重派<br>- `STATUS: BLOCKED(设计遗漏 \| 设计事实有误)` → 进 **设计受阻路由**<br>- `STATUS: DONE` → **立即由调度者运行 `pipeline-ctl.mjs check-scope <task_dir>`** | 回设计 / 回方案 `j/回头上限` | 耗尽 → 停下给三项选择（见 `references/comms.md`） |
| **S1 范围守门**（调度者脚本） | `pipeline-ctl.mjs check-scope` | `00-baseline.txt`, `00-task.md`, `02-design.md`, 工作区 | 终端 JSON 输出 | - `out_of_scope_changed` 非空（存在清单外改动） → **不派 I2**，直接进 **清单外改动处理**<br>- `out_of_scope_changed` 为空 → 派 **I2 验证**（将 `check-scope` 输出的 `in_scope_changed` 与 `in_scope_unchanged` 传入追加约束供 verifier 引用）<br>- `mode: non_git` / `skipped: true`（退出码 4） → 不做脚本范围核对、不触发清单外改动处理，派 **I2 验证**（将各 `04-impl*.md`「改动文件」并集传入追加约束，由 verifier 人工核对范围，不做 `[范围遗漏]` 判定） | — | — |
| **I2 验证** | verifier（`executor` 独立实例） | `00-task.md`, `00-baseline.txt`, `decisions.md`, `02-design.md`；片模式读本片 `04*`，整体 / 终验读全部 `04*`；同键最新一份 `05*` | `05-verify-<键>-N.md` + `evidence/` | 先由调度者按 `SKILL.md`「派发后确定性校验」完成 `verify-readonly` save / check 后派发；逐片模式向用户输出一行：`片 <编号> <VERDICT>（修复 k/R）`<br>- 若处于终验（或整体）且开启了规范审查 → **无论 I2 PASS 或 FAIL，均继续派 I3**，待 I3 返回后合并处理<br>- `VERDICT: PASS`（未开 I3 的片验证） → 开启逐片验收则进「逐片验收停点」，否则进入下一片（全片完成进终验）<br>- `VERDICT: PASS`（未开 I3 的整体 / 终验） → 进「结束」<br>- `VERDICT: FAIL`（未开 I3） → 进 **验证失败路由** | 修复轮 `k/R`（按 `<键>` 统计 `04-impl-<键>-修复-*.md` 个数） | `k >= R` → 停下汇报未解失败项与路径，给三项选择 |
| **I3 规范审查**（仅开启时，终验后） | code-reviewer（`peer`） | `00-task.md`, `00-baseline.txt`, `decisions.md`, `02-design.md`, 全部 `04*`, 最新 `06*`（如有） | `06-codereview-N.md` | 先执行 `verify-readonly` 校验<br>- `I2 PASS` 且 `I3 PASS` → 进「结束」<br>- `I2 FAIL` 或 `I3 FAIL` → 将 I2 失败项与 I3 blocker / major **合并进一次验证失败路由**（修复键为 `整体` 或 `终`，修复后重派终验 I2 + I3） | 与终验 / 整体共用同一个修复键 `k/R` | `k >= R` → 停下给三项选择 |

## 路由细则

1. **设计受阻路由（I1 返回 `BLOCKED(设计遗漏 | 设计事实有误)`）**：
   - 读取 `04-impl*.md` 的「偏离」节，查 `00-task.md` 中的 `on_design_blocked` 策略：
   - `return_to_design`（`dev` 模式）：按 `pipelines/dev.md`「回设计流程」执行（记 `[回设计 j | r_base=<r>]`，回 P2 修订并评审通过后以 `implementer / 续做` 模式重进 I1）。
   - `return_to_plan`（`bugfix-verify` 模式）：按 `pipelines/bugfix-verify.md`「回方案流程」执行。
   - `ask_user`（独立运行 `impl-verify`）：停下向用户汇报偏离类型、设计步骤与证据，建议启用 `design-review` 修订 `02-design.md`，修订完成后以 `implementer / 续做` 模式重进 I1。
2. **清单外改动处理（S1 `check-scope` 检出 `out_of_scope_changed` 非空）**：
   - 不消耗修复轮 `R`，不派 `verifier`。
   - 若 `on_design_blocked == return_to_design` 且改动确系实施必需（记录在 `04-impl*.md` 中）：自动走回设计流程补入 `02-design.md`「改动清单」，评审通过后直接重跑 `check-scope` 并进 I2（无需重跑 I1）。
   - 其余情形（或未记录在 `04-impl*.md` 中的意外改动）：停下向用户列出 `out_of_scope_changed` 文件，给出三项选择：① 补进 `02-design.md`「改动清单」；② 由用户手动还原后重跑 `check-scope`（调度者不执行 `checkout`）；③ 记入 `decisions.md` 并在 `00-task.md` 忽略路径中豁免后继续。
3. **验证失败路由（I2 `FAIL` 或 I3 `FAIL`）**：
   - 读取 `05-verify-<键>-N.md` 的「环境阻塞」「失败项」「测试质量问题」（及 `06-codereview-N.md` 的「问题清单」）：
   - **含环境阻塞**（缺工具、服务起不来、依赖缺失）：**不派修复**，先停下询问用户：① 解除环境阻塞后重跑 I2；② 豁免对应标准（记入 `decisions.md` 并在 `00-task.md` 标注“环境豁免”）；③ 终止。若豁免后仍有代码 FAIL / 测试质量问题 / I3 blocker-major，再继续下方代码修复。
   - **代码 FAIL / `[测试质量]` / `[范围遗漏]` / I3 blocker-major**：运行 `pipeline-ctl.mjs status <task_dir>` 检查当前 `<键>` 的修复轮计数 `k`（`[范围遗漏]` 判定属设计缺口、需扩「改动清单」时，走上方设计受阻路由而非修复）：
     - 若 `k >= R` → 停下向用户汇报剩余失败项与报告路径，给出耗尽三项选择（见 `references/comms.md`）；
     - 若 `k < R` → 派发 `implementer / 修复`（输出 `04-impl-<键>-修复-(k+1).md`）→ 返回 `DONE` 后跑 `check-scope` → 重派对应阶段的 I2（终验含 I3）。

## 逐片验收停点（仅当“逐片验收”开启时）

每片 I2 返回 `PASS` 后停下，向用户展示：
- 片编号与行为判据（取自 `02-design.md`「实施步骤」）；
- 验收入口（≤3 行，取自 `05-verify-<片>-N.md`「验收入口」节）；
- 该片已用修复轮 `k/R`。

**停止并等待用户回复**：
- `继续`：该片完成，进入下一片（最后一片完成后进入终验）。
- `修复：<意见>`：若该片 `k >= R`，先提示修复轮耗尽并询问是否追加上限；否则将用户意见原文按 `- [K-n] <用户原文>` 写入 `05-human-K.md`（首行 `VERDICT: FAIL`），派 `implementer / 修复`（输出 `04-impl-<片>-修复-(k+1).md`，计入该片修复轮 $R$）→ `check-scope` → 重派该片 I2，完成后回到本停点。
- `终止`：停止并保留产物，按 `references/comms.md`「结束汇报」输出。

## 结束

按 `references/comms.md`「结束汇报」模板输出，实施类必含：
- **改动文件摘要**与还原提示；
- **验收入口**：取终验 `PASS` 报告（整体为 `05-verify-整体-N.md`，逐片为 `05-verify-终-N.md`）的「验收入口」节（≤3 行摘要 + 报告路径）；若中途终止无终验 `PASS`，取最后一份已 `PASS` 的片验证报告并注明“终验未完成”；
- **建议人工定点审阅**（≤3 条 `path:line` + 原因；无触发条件则省略）：触发条件为 ① `02-design.md`「风险与回滚」标为单向门或涉及公共接口 / 数据迁移 / 权限；② 存在经用户豁免的清单外改动；③ 修复轮耗尽后用户选择“接受当前结果”。
