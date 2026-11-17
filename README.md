# cheap-pets/skills

Agent skills for coding。

`git@github.com:cheap-pets/skills.git`



## 安装

选择安装：

```bash
npx skills add git@github.com:cheap-pets/skills.git
```

指定安装（以 dev-pipeline 为例）：

```bash
npx skills add git@github.com:cheap-pets/skills.git --skill dev-pipeline
```



## Skills 速查

| 技能名称 | 时间 |
|----------|------|
| [dev-pipeline](./skills/dev-pipeline) | 2026-11-17 |


## Skills 简介

### dev-pipeline

子智能体协作开发技能——指挥多个子智能体完成一次对话装不下的开发任务。

适用：跨模块功能、重构、公共接口变更、复杂缺陷定位修复。
触发：仅当用户点名流水线 / 子智能体 / 多 agent 协作时启用。

**安装子智能体**——3 个槽位子智能体需复制到宿主的 subagents 定义目录：

- 来源：`skills/dev-pipeline/slots/`
- 槽位：`pipeline-primary` / `pipeline-peer` / `pipeline-executor`
- 无需手动操作：可直接让 agent 安装，或首次使用检测不到时，agent 会提示并安装
- 也可手动复制：将 `slots/*.md` 复制到宿主的 subagents 定义目录（如 Claude Code 为 `.claude/agents/`）

安装命令（agent 执行，供参考）：

```bash
node skills/dev-pipeline/scripts/pipeline-ctl.mjs install --target <宿主的 subagents 定义目录>
```

- **dev**：无设计要实施——探索 → 设计 + 评审 → 确认门 → 实施 + 验证。
- **design-review**：只要方案并过审——设计 → 独立评审 → 修订。
- **impl-verify**：已有确认的设计——实施 → 范围核对 → 独立验证 → 修复。
- **bugfix-verify**：缺陷根因未明——定位 → 修复方案 → 修复 + 验证。
- **单点 / 临时组合**：也可只点名单个角色，或点名多个角色按依赖顺序协作。
