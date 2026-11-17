# 启动、前置准备与会话恢复（激活后与 `roles.md` 同读）

本文件合并了任务目录初始化、`00-task.md` 规范、启动确认窗口以及中断恢复流程。同一阶段需向用户确认的问题合并为**一次**提问。

## 1. 任务目录与协议文件

首次派发前，调度者确定任务目录路径 `.pipeline/<yyyymmdd>-<slug>/`，并调用守门脚本初始化：

```bash
node <skill 目录>/scripts/pipeline-ctl.mjs init .pipeline/<yyyymmdd>-<slug>
```

提示用户将 `.pipeline/` 加入 `.gitignore`。目录内维护以下协议文件：

- `00-baseline.txt`（由 `init` 自动生成，此后只读不改；已存在时 `init` 拒绝重建，除非 `--force`）：
  - Git 仓库：记录当前分支、完整 40 位 HEAD 哈希、以及建目录时所有脏文件与未跟踪文件（`--untracked-files=all`）的 `git hash-object`（已删除文件记 `DELETED`）。
  - 非 Git 仓库：内容为 `NON_GIT`；此后 `check-scope` 输出 `mode: non_git`、`skipped: true`（退出码 4），`verify-readonly` 仅覆盖任务目录（详见 `SKILL.md`「派发后确定性校验」与 `pipelines/impl-verify.md` S1）。
- `00-repro.txt`（可选，仅 `bugfix-verify` 或含长日志的任务）：存放用户提供的原始报错堆栈、复现日志或长报文原文，避免撑爆 `00-task.md`。
- `00-task.md`（≤60 行，调度者编写）：
  - **目标**：任务需求或缺陷描述（长日志只写 `详见 00-repro.txt`）。
  - **基线**：Git 仓库写一行指针 `HEAD <短哈希> @ <分支>；基线脏文件 N 个；详见 00-baseline.txt`（若建目录时有脏文件，顺带向用户确认：基线脏文件按“与本任务无关”排除，还是由用户先 commit；如需 stash 必须在 `init` 前完成，`init` 后再 stash 会使基线脏哈希失配、`check-scope` 误报该文件为已改动）；非 Git 仓库写 `非 git`。
  - **验收标准**：可逐条打勾核对的具体判据（缺失或含糊时先提问澄清）。
  - **验证命令**：lint / typecheck / test / build 命令（优先从 `AGENTS.md` / `package.json` / `Makefile` 提取，提取不到则询问用户）。
  - **验证环境**（按需）：服务启动命令、base URL、浏览器或 HTTP 测试配置（凭据只写环境变量名）。
  - **忽略路径**：运行构建或测试会生成但未被 `.gitignore` 忽略的目录或文件前缀（如 `dist/`、`build/`、`coverage/`、`*.tsbuildinfo`），供 `check-scope` 自动排除。
  - **开关与策略**：记录当前流水线名、`N / R / 回头上限`、实施粒度（`整体` / `逐片`）、`on_design_blocked`（`return_to_design` | `return_to_plan` | `ask_user`）、规范审查、TDD、逐片验收、片验证范围、以及评审模型配置（`异构` / `同模型独立` / `宿主默认`）。
- `decisions.md`（`init` 创建空文件，仅调度者追加写入）：
  - 每行一条：`- [<阶段/时间>] <决定内容> — <原因>`（推翻旧决定时追加新行并注明 `取代 <原条目>`）。
  - **回设计 / 回方案专用标记行**（供 `pipeline-ctl.mjs status` 确定性推导计数，严禁改格式）：
    - 回设计：`- [回设计 <j> | r_base=<当前最大 03-review 序号> | 来源=BLOCKED 或 check-scope] <原因>`（I1 `BLOCKED` 触发记 `来源=BLOCKED`；`check-scope` 清单外改动触发记 `来源=check-scope`）
    - 回方案：`- [回方案 <j>] <原因>`
- `run.log`（`init` 创建空文件，仅调度者追加写入，供审计）：
  - 派发前记一行：`<序号> <流水线:阶段 | 单点 | 临时> <角色>[/<模式>] → <输出文件> | dispatched`；返回后补 `| <返回值首行>`。

## 2. 子智能体安装检查

首次运行前，检查当前实际运行的宿主（harness）是否已安装 `pipeline-{primary,peer,executor}` 槽位子智能体：
- 若未安装，**由当前实际运行的 harness 将 `<skill 目录>/slots/*.md`（3 个槽位）复制到其自身的 subagents 定义目录下**（例如运行 `node <skill 目录>/scripts/pipeline-ctl.mjs install --target <宿主的 subagents 定义目录>`）。
- 若宿主不支持独立 subagents 目录，则在派发块首行通过路径注入 `<skill 目录>/agents/<角色文件>.md`，走通用子智能体降级路径。

## 3. 启动确认窗口（四条预设流水线首派发前必开；单点与临时组合不开窗）

建好任务目录并写完 `00-task.md` 初稿后，向用户发出**一次**合并确认消息，包含以下三项（按当前流水线取适用子集）：

1. **流水线构成**：阶段链、各阶段角色与模型槽位（注明 `评审模型：异构 | 同模型独立 | 宿主默认`）、循环上限（修订 `N=2` / 修复 `R=2` / 回头 `2`）。若为 `design-review`，注明“本次执行至设计检查点，实施由后续 `impl-verify` 承接”。
2. **开关配置与轻量化建议**：展示当前开关值（默认 `整体` 实施、规范审查 `关`、TDD `关`、逐片验收 `关`）。结合任务特征给出针对性建议：
   - 改动集中、方案已明确 → 建议跳过探索或调低 `N=1`；
   - 跨多模块、包含 ≥3 个可独立演示行为 → 建议切换为 `逐片`；
   - 涉及单向门（数据迁移、公共接口、权限安全） → 建议开启 `严格`（`逐片` + `规范审查` + `TDD` + `逐片验收`）；
   - 验收标准含 `浏览器` / `HTTP` / `人工` → 建议将 `verifier` 从 `executor` 升级为 `peer` 或 `primary`。
3. **待澄清项**（如有）：缺失的验收标准、验证命令、验证环境、基线脏文件处理方式。

用户确认或调整后，更新 `00-task.md` 并立即启动首次派发。

## 4. 会话中断恢复

当会话中断后继续执行时：

1. 运行 `node <skill 目录>/scripts/pipeline-ctl.mjs status <task_dir>`，并读取 `00-task.md` 与 `decisions.md`。
2. 根据 `status` 输出的 `artifacts`（各产物文件及首行 `VERDICT` / `STATUS`）与 `counts`（`design_revisions_k`、`return_to_design_j`、`return_to_design_blocked_j`、`return_to_plan_j`、`repairs_by_key`、`blocked_design_count`）判定当前所处阶段：
   - 若存在 `04-impl*.md` 首行为 `STATUS: 进行中` → 该次 `implementer` 未完成，按 `roles.md` 约定以“接续”注记重派该 `implementer`；
   - 若存在只读角色产物首行为 `未定` 或缺失 → 直接重派该角色覆盖重跑；
   - 按 `00-task.md` 的 `on_design_blocked` 分流核对未消费的设计类 `BLOCKED`：`return_to_design` → 若 `blocked_design_count > return_to_design_blocked_j`（存在 `BLOCKED` 触发但尚未写入 `[回设计]` 标记；`check-scope` 触发的回设计不计入 `return_to_design_blocked_j`）→ 补写 `decisions.md` 的 `[回设计]` 标记后再进入回设计修订；`return_to_plan` → 若 `blocked_design_count > return_to_plan_j` → 补写 `[回方案]` 标记后再进入回方案流程；`ask_user` → 不核对计数，直接按产物定稿状态恢复；
   - 若最新产物已定稿且流程处于确认门、检查点或耗尽三项选择等待用户回复 → 重新向用户展示该检查点或选项。
3. 向用户用一句话确认恢复定位的阶段与计数后，继续推进。
