# 回归推演清单（dry-run，维护文档）

修改协议或守门脚本后，先运行 `node <skill 目录>/scripts/pipeline-ctl.mjs lint` 通过静态一致性检查，再按本清单逐场景推演调度者的状态转移、脚本调用与停点行为，确认与「预期」完全一致。

S 编号说明：S1~S12 沿用旧版 12 场景清单，缺号对应已删除场景；S13 起为槽位化与非 git 修订新增场景。

默认参数前提：`N = 2`（设计自动修订上限）、`R = 2`（每键自动修复上限）、`回头上限 = 2`（回设计 / 回方案）、实施粒度默认 `整体`。

---

## 场景 1（S1）：`impl-verify` 整体实施，验证 FAIL 后自动修复与耗尽停点

- **条件**：整体实施（`<键>=整体`），未开规范审查；I1 返回 `DONE`，`check-scope` 通过；I2 首次返回 `FAIL`（代码失败 2 项）。
- **推演**：
  1. 调度者读取 `05-verify-整体-1.md` 的「环境阻塞」「失败项」「测试质量问题」→ 确认为代码失败；
  2. 运行 `pipeline-ctl.mjs status` 得 `repairs_by_key.整体 = 0 < R(2)`；
  3. 派发 `implementer / 修复` 输出 `04-impl-整体-修复-1.md` → 返回 `DONE` 后运行 `check-scope` → 重派 I2 输出 `05-verify-整体-2.md`；
  4. 若再次 `FAIL`，同理派发修复输出 `04-impl-整体-修复-2.md` 并重派 I2；
  5. 若第 3 次仍 `FAIL`，`status` 显示 `repairs_by_key.整体 = 2 == R(2)` → 触发耗尽停点，向用户给出三项选择（追加上限 / 接受当前结果 / 终止）。
- **预期**：前两轮自动修复与重验全程顺畅；第 3 次修复前准确触发 `R` 耗尽停点；若中途用户插话发起人工修复，产物命名为 `04-impl-整体-人工修复-1.md`，不占用自动修复额度 `R`。

## 场景 2（S2）：`dev` 流水线，P4 返回 `BLOCKED(设计事实有误)` 触发回设计

- **条件**：`dev` 在 P2 经过 2 轮评审（已存在 `03-review-1.md`、`02-response-1.md`、`03-review-2.md` APPROVE）进入 P4；I1 返回 `STATUS: BLOCKED(设计事实有误)`；此前无回设计记录（`return_to_design_j = 0`）。
- **推演**：
  1. 调度者读取 `04-impl.md`「偏离」节；运行 `pipeline-ctl.mjs status` 得 `return_to_design_j = 0 < 2`、`max_review_r = 2`；
  2. 在 `decisions.md` 追加 `- [回设计 1 | r_base=2] P4 实施发现接口签名与代码不符`；
  3. 回 P2：派 `designer / 修订` 按偏离更新 `02-design.md`（末尾写 `## 偏离处理`，不写 `02-response` 文件）→ 派 `design-reviewer` 输出 `03-review-3.md`；
  4. 若 `03-review-3.md` 返回 `REVISE`，此时 `status` 计算 `r > r_base(2)` 的回应文件数为 `0 < N(2)`，正常派 `designer / 修订` 输出 `02-response-3.md`（新周期 `k = 1/2`）→ 复审 `03-review-4.md` 返回 `APPROVE`；
  5. 不经 P3 确认门，直接派 `implementer / 续做` 输出 `04-impl-整体-续-1.md`。
- **预期**：`r_base=2` 锚点使回设计后的新周期拥有完整的 `N=2` 自动修订额度，不会因上一周期的 `02-response-1.md` 误判耗尽；当第 3 次触发回设计前（`j == 2`）准确停下给出三项选择。

## 场景 3（S3）：`bugfix-verify` 回归先行证伪触发回方案

- **条件**：`bugfix-verify` 进入 I1，`implementer` 按回归先行编写单元测试并运行，发现修复前测试已通过（根因假设不成立），立即停止并返回 `STATUS: BLOCKED(设计事实有误)`。
- **推演**：
  1. 调度者读取 `04-impl.md`「偏离」节；运行 `status` 得 `return_to_plan_j = 0 < 2`；
  2. 在 `decisions.md` 追加 `- [回方案 1] 修复前回归测试已通过，原根因假设不成立`；
  3. 派 `explorer`（`primary`）重定位输出 `01-explore-回-1.md`（不占补探索额度）→ 派 `designer / 修订` 更新 `02-design.md` → 派 `implementer / 续做` 输出 `04-impl-整体-续-1.md`。
- **预期**：未修改任何业务源码即拦截错误根因假设；重定位与方案更新闭环推进；`j == 2` 耗尽时停下给三项选择。

## 场景 4（S4）：I1 完成后 `check-scope` 立即拦截清单外改动

- **条件**：I1 返回 `STATUS: DONE`；调度者立即运行 `pipeline-ctl.mjs check-scope <task_dir>`，脚本返回 `out_of_scope_changed: ["src/utils/helper.ts"]`（退出码 3）。
- **推演**：
  - 独立运行 `impl-verify`（`on_design_blocked: ask_user`）：**不派发 I2 verifier**，立即停下向用户列出 `src/utils/helper.ts`，给出三项选择（补进 `02-design.md` 改动清单 / 用户手动还原后重跑 `check-scope` / 记入 `decisions.md` 与忽略路径豁免）。
  - `dev` 模式（`on_design_blocked: return_to_design`）：若该改动已记入 `04-impl.md` 且确属必需，走回设计补入 `02-design.md`「改动清单」，过审后直接重跑 `check-scope` 进 I2（不重跑 I1）。
- **预期**：清单外改动在派发 `verifier` 之前即被确定性拦截，节省一次 `verifier` 派发；且因 `00-baseline.txt` 记录了文件级哈希，基线原本就脏但本次未触碰的文件不会被误报。

## 场景 5（S7）：运行中动态调低上限 `R`

- **条件**：`片1` 已发生 1 次自动修复（存在 `04-impl-片1-修复-1.md`，原 `R=2`）；在逐片验收停点用户指令将 `R` 调为 `1`（更新 `00-task.md`）。
- **推演**：后续若 `片1` 或其他片触发修复，运行 `status` 得 `k = 1 >= 新R(1)` → 立即判定耗尽，停下给出三项选择，不改写已有修复文件名。
- **预期**：调低上限立即在下一次判定生效，已有文件命名与历史审计保持不变。

## 场景 6（S10）：三个模型槽位全部缺失时的停问保护

- **条件**：宿主既未安装专用子智能体，也无异构模型，所有槽位均只能落到宿主单一默认通用模型。
- **推演**：触发 `SKILL.md`「子智能体绑定与安装」停问保护，在启动确认窗口向用户说明并询问确认（记入 `decisions.md`），经同意后才开始派发。
- **预期**：绝不静默降级开工。

## 场景 7（S11）：终验 `I2 PASS` 但规范审查 `I3 FAIL`（绕过既有封装）

- **条件**：`impl-verify` 开启规范审查；终验 `I2` 返回 `PASS`；紧接着 `I3 code-reviewer` 检出代码绕过 `02-design.md` 指定复用的既有组件自行实现，返回 `FAIL`（1 个 major）。
- **推演**：调度者合并 `I2` 与 `I3` 结果 → 判定需修复 → 派 `implementer / 修复`（读取 `06-codereview-1.md`，输出 `04-impl-整体-修复-1.md`）→ `check-scope` → 重派终验 `I2` 与 `I3`。
- **预期**：`check-scope` 负责文件集合边界，`verifier` 负责功能验收标准，`code-reviewer` 负责拦截文件集合内的设计偏离与坏味道，三者职责正交且闭环。

## 场景 8（S12）：部分实施后用户选择「终止」

- **条件**：逐片模式下 `片1` 已 `PASS`，`片2` 修复轮耗尽后用户在三项选择中选 `③ 终止`。
- **推演**：按 `references/comms.md`「结束汇报」输出：产物目录、相对基线已改动的源码文件摘要、还原提示一行（`git checkout -- <文件>` 由用户自行执行，调度者不代做）、验收入口取 `05-verify-片1-1.md` 并注明“终验未完成”。
- **预期**：调度者严守不执行 `checkout` 的红线，汇报信息完整。

## 场景 9（S13）：非 git 仓库显式降级（无假绿）

- **条件**：非 git 目录运行 `init`（`00-baseline.txt` 为 `NON_GIT`）；I1 返回 `DONE` 后运行 `check-scope`；派发只读角色前后运行 `verify-readonly` save / check。
- **推演**：
  1. `check-scope` 输出 `{"ok": false, "mode": "non_git", "skipped": true, "reason": ...}`，退出码 4，无 `in_scope_*` 三组键；
  2. S1 按非 git 分支：不触发清单外改动处理，派 I2 并将各 `04-impl*.md`「改动文件」并集传入追加约束；
  3. verifier 不做 `[范围遗漏]` 与清单外判定，按并集人工核对并在「范围核对」注明降级口径；
  4. `verify-readonly` 输出 `mode: "non_git"` 与 `note: non-git: verification only covers the task directory`；
  5. 结束汇报按非 git 分支列出改动文件清单，提示手动还原。
- **预期**：全程无 `ok: true` 假绿结论；范围核对降级口径在报告与汇报中均可见。

## 场景 10（S14）：init 后 stash 导致 check-scope 误报的两种路径

- **条件**：`src/b.ts` 在 `init` 时为脏且列入 `02-design.md`「改动清单」；`src/c.ts` 在 `init` 时为脏但不在清单内；init 后用户执行 `git stash`；随后 `check-scope`。
- **推演**：
  - 清单内 `b.ts`：当前哈希 ≠ 基线脏哈希 → 落入 `in_scope_changed`，被静默记为「已改」（不停点）；由 verifier 验收核对兜底；
  - 清单外 `c.ts`：落入 `out_of_scope_changed`（退出码 3）→ 停点，向用户给三项选择（补清单 / 手动还原后重跑 / 豁免）。
- **预期**：`start.md` 已收口「stash 必须在 init 前完成」；发生误报时清单外路径可见可恢复，清单内路径靠 verifier 兜底，无数据丢失。

## 场景 11（S15）：只读角色 `未定` 占位中断恢复

- **条件**：`design-reviewer` 开工写了 `03-review-2.md` 骨架（首行 `VERDICT: 未定`）后中断；会话恢复时运行 `status`。
- **推演**：`status` 的 `artifacts["03-review-2.md"]` 首行为 `未定` → 直接重派该角色覆盖重跑（不走接续）。
- **预期**：残缺报告不会被当作定稿采信；`verifier` / `code-reviewer` 同理；explorer 无状态首行，靠报告文件缺失判定（契约要求单次 Write 落盘）。

## 场景 12（S16）：`[范围遗漏]` 进入修复路由

- **条件**：整体实施 I2 返回 `FAIL`，失败项含 `[范围遗漏] src/auth/token.ts`（清单列出但未改动，属漏实现）；`repairs_by_key.整体 = 0 < R(2)`。
- **推演**：验证失败路由将其与代码 FAIL 同路 → 派 `implementer / 修复`（契约修复清单含 `[范围遗漏]`）→ `DONE` 后 `check-scope` → 重派 I2。若修复需触碰清单外文件 → implementer 返回 `BLOCKED(设计遗漏)` → 走设计受阻路由。
- **预期**：`[范围遗漏]` 不再悬空，修复与回设计两条出路均有路由。

## 场景 13（S17）：回设计 / 回方案后的中断恢复分流

- **条件 A**（bugfix 回方案）：`decisions.md` 含 `- [回方案 1]`，`04-impl.md` 首行 `STATUS: BLOCKED(设计事实有误)`（`blocked_design_count = 1`），中断后恢复。
- **条件 B**（独立 impl-verify，`ask_user`）：同上产物，`on_design_blocked: ask_user`。
- **条件 C**（check-scope 触发回设计后再 BLOCKED）：`decisions.md` 含 `- [回设计 1 | r_base=2 | 来源=check-scope]`，其后新产物 `04-impl.md` 首行 `BLOCKED(设计事实有误)`（`blocked_design_count = 1`，`return_to_design_blocked_j = 0`）。
- **推演**：
  - A：`blocked_design_count(1) > return_to_plan_j(1)` 为假 → 不补标记，按产物定稿状态恢复；
  - B：`ask_user` → 不核对计数，直接向用户汇报偏离；
  - C：`blocked_design_count(1) > return_to_design_blocked_j(0)` 为真 → 补写 `[回设计 2 | 来源=BLOCKED]` 后进回设计修订。
- **预期**：三种情形均不误补、不漏判；`来源=check-scope` 的回设计不消耗 BLOCKED 恢复判据。

## 场景 14（S18）：槽位映射（B1→primary、verifier→executor）

- **条件**：三槽位（`pipeline-primary` / `pipeline-peer` / `pipeline-executor`）均已安装。
- **推演**：`bugfix-verify` B1 缺陷定位 explorer 派给 `pipeline-primary`（首行注入 `agents/pipeline-explorer.md`）；P1 常规 explorer、I1 implementer、I2 verifier 均派给 `pipeline-executor`（implementer 与 verifier 各自全新实例）；designer / B2 派给 `pipeline-primary`；design-reviewer / code-reviewer 派给 `pipeline-peer`。
- **预期**：派发对象始终是槽位子智能体；角色由首行契约路径决定；运行时文件无旧槽位名（lint 拦截，仅脚本内旧注册检测列表除外）。

## 场景 15（S19）：primary 缺失停问

- **条件**：宿主未安装 `pipeline-primary`（或其模型不可用），已装 `pipeline-peer` / `pipeline-executor`；任务需派 `designer`（默认槽位 `primary`）。
- **推演**：启动窗口停下询问用户（记入 `decisions.md`）；用户同意后才落到 `peer`；不同意则终止。
- **预期**：不静默把 designer 落到弱模型；三槽位全缺时同样停问（S10 已覆盖），汇报标注 `评审模型：宿主默认`。

## 场景 16（S20）：design-review 检查点续接 impl-verify 跳过重复 init

- **条件**：`design-review` 独立运行至检查点（任务目录已有 `00-baseline.txt`），用户指令「实施」，续接 `impl-verify`。
- **推演**：`impl-verify` 前置检测任务目录与 `00-baseline.txt` 已存在 → 跳过 `init` 沿用原基线；若误重跑 `init`，脚本拒绝（退出码 2）并提示 `--force`。
- **预期**：基线不被覆盖，期间的设计产物与会话改动不会被吸收进新基线。
