# 流水线：设计 + 评审（design-review）

设计 → 独立评审 →（修订 → 复审）→ 检查点。只产出并打磨设计文档，不改源码。

## 前置

1. **独立运行时**：按 `references/start.md` 执行 `pipeline-ctl.mjs init <task_dir>`（任务目录与 `00-baseline.txt` 已存在则跳过 `init`，沿用原基线），写 `00-task.md`（目标、基线、约束、**可验证的验收标准**、开关）并开启启动确认窗口（标注“本次只执行到设计检查点，实施由后续 `impl-verify` 承接”）。`dev` P2 进入时跳过本步。
2. **验收标准澄清**：若 `00-task.md` 验收标准缺失或不可逐条打勾验证，先向用户提问澄清（最多 2 轮，答复记入 `decisions.md`）再继续。
3. **已有设计输入**：若用户提供了现成设计文档，复制为 `.pipeline/<task>/02-design.md`（原路径记入 `00-task.md`），告知用户后续修订作用于副本，跳过 D1 直接从 D2 开始。

## 阶段与状态转移表

派发 `designer` 与 `design-reviewer` 前后均须执行 `pipeline-ctl.mjs verify-readonly` 校验。当 `00-task.md` 中实施粒度为默认的 `整体` 时，派发 D1 追加约束注明`整体实施：实施步骤不切片`；实施粒度为 `逐片` 时注明`逐片实施：按纵向行为切片`。

| 阶段 | 角色（默认槽位） | 读 | 写 | 返回值 → 下一步动作 | 计数键与上限 | 耗尽去向 |
|---|---|---|---|---|---|---|
| **D1 设计** | designer（`primary`） | `00-task.md`, `decisions.md`, `01-explore*.md`（如有） | `02-design.md` | - `未解问题 > 0` → 按 `references/comms.md`「未解问题处理」询问用户或补探索（`01-explore-补-1.md`）后由 designer 更新 `02-design.md`，再进 D2<br>- `未解问题 == 0` → 进 D2 评审 | 补探索 ≤ 1 | 需第 2 次补探索 → 停下询问用户 |
| **D2 评审** | design-reviewer（`peer`） | `00-task.md`, `decisions.md`, `01-explore*.md`（如有）, `02-design.md`；复审另读 `03-review-(r-1).md`, `02-response-(r-1).md` 及上轮后新增的 `03-human-*.md` / `02-response-人工-*.md` | `03-review-r.md` | 先向用户输出一行进度：`第 r 次评审 <VERDICT>（修订 k/N）：blocker x / major y / minor z；最严重：<一句话>`<br>- `APPROVE` → 设计状态标 `通过`，进「检查点」<br>- `REVISE` 且 `k < N` → 进 **D1R 自动修订**（人工修订重审除外：直接回检查点标 `未通过`，不再自动循环）<br>- `REVISE` 且 `k >= N` → 设计状态标 `未通过`，进「检查点」 | 自动修订 `k/N`（由 `pipeline-ctl.mjs status` 统计 `r > r_base` 的 `02-response-<r>.md` 个数） | `k == N`（或 `N == 0`） → 停止自动修订，带 `未通过` 进「检查点」 |
| **D1R 自动修订** | designer / 修订（`primary`） | `00-task.md`, `decisions.md`, `02-design.md`, `03-review-r.md`, 最新新增的 `03-human-*.md`（如有） | `02-design.md`, `02-response-r.md` | 先向用户输出一行进度：`设计者回应（修订 k/N）：不接受 w / 不可行 v`<br>- `不可行数 > 0` → **立即停下**，读取回应文件与对应意见，附证据交用户裁决<br>- `未解问题 > 0` → 按「未解问题处理」解决后进 D2 复审<br>- 正常返回 → 进 D2 复审（写 `03-review-(r+1).md`） | 同上 | — |

## 检查点

D2 结束（`APPROVE`、修订上限耗尽、或人工修订指定免重审）时，读取 `02-design.md` 的「方案概述」「改动清单」「测试计划」「风险与回滚」（若 `未通过` 另读最新 `03-review-r.md` 的「问题清单」与对应 `02-response-r.md`），向用户展示：

1. **路径与设计状态**（注明 `评审模型：异构 | 同模型独立 | 宿主默认`）：
   - `通过`：最近一次评审为 `APPROVE`；
   - `未通过`：自动修订达上限 `N` 仍为 `REVISE`，或人工修订重审返回 `REVISE`（逐条列出未解决的 blocker / major，设计者标“不接受”而评审员维持的附双方理由）；
   - `未经评审`：用户执行了“已手改”或“修订后免重审”。
2. **验收对照**（逐条单列）：`标准 → 归属片（或整体/终验） → 验证手段 + 具体检查方式`。
3. **设计摘要**（≤15 行）：方案概述与改动清单要点、合并风险（1 行）、遗留 minor 数、未解问题。
4. **计数状态**（1 行）：`设计修订 k/N（当前周期）；回设计 j/上限（dev 模式）`。

**停止并等待用户指令**（`dev` P3 开启“确认门：自动”且设计状态为 `通过` 时打印上述摘要后直接进入 P4）：

| 用户指令 | 动作 |
|---|---|
| 实施 / 确认 / 继续 | 续接 `pipelines/impl-verify.md`（`dev` 中进入 P4）。若状态为 `未通过` / `未经评审`，将接受风险记入 `decisions.md` |
| 修订：<意见>（可附“免重审”） | 按 `references/comms.md`「人工修订」写入 `03-human-K.md`，派 `designer / 修订` 写 `02-response-人工-K.md`；默认再派 `design-reviewer` 重审（返回 `REVISE` 不再自动循环，直接回本检查点标 `未通过`）；若用户明确说“免重审”则直接回本检查点标 `未经评审` |
| 已手改 | 用户已直接修改 `02-design.md`；要点记入 `decisions.md`，状态标 `未经评审`，回到本检查点 |
| 再评审 | 派 `design-reviewer` 重审（写 `03-review-(r+1).md`，不占自动修订额度），完成后回本检查点 |
| 补探索：<范围> | 派 `explorer` 写 `01-explore-补-N.md`（若已有 `补-1` 先确认）→ `designer / 修订` 消化 → `design-reviewer` 重审 → 回本检查点 |
| 上限：修订 N | 更新 `00-task.md` 并记入 `decisions.md`，若此前因耗尽停下且 `k < 新N` 则继续自动修订循环，否则回本检查点 |
| 结束 / 终止 | 停止并保留产物，按 `references/comms.md`「结束汇报」输出（提示后续可随时用 `impl-verify` 承接实施） |
