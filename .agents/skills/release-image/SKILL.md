---
name: release-image
description: 将发布说明、功能介绍等文案渲染为适合微信分享的长图 PNG。当用户要求"生成发布图 / 发布说明图片 / 微信长图 / 宣传长图 / 把文档渲染成图片"时使用。产出 900px 宽移动端排版，含渐变头图、代码块、表格、编号卡片版式。
---

# 发布长图生成

将文案渲染为微信长图：套模板生成 HTML → playwright 全页截图 → DOM 断言排版。

## 流程

1. **输入**：文案（Markdown 或纯文本）+ 产物名（如 `RELEASES`）。输出目录由用户指定，默认当前任务目录。
2. **生成 HTML**：复制 `assets/template.html` 为 `<产物名>.html`，按模板内注释区块替换内容。映射：
   - 主标题 + 副题 → hero；多个并列名目 → hero chips；
   - 命令 / 代码 → `pre`；金句 / 理念 → `blockquote`；
   - 并列亮点条目 → `.item` 编号卡片；新旧对比（每条含多条子项）→ `.improve` 卡片 + `ul`；结构化对比数据 → `table`。
   - 只改内容不改 CSS；模板未覆盖的版式需求先确认，不现场发明样式。
3. **渲染**：
   - 后台起服务：`node <skill 目录>/scripts/serve.mjs <HTML 所在目录>`（默认端口 8931）；
   - playwright navigate `http://127.0.0.1:8931/<产物名>.html`（`file:` 协议被 playwright mcp 禁止，必须走 http）；
   - resize 到 900 × 1000（与模板 body width 一致）。
4. **断言**（`browser_evaluate`，不目检）：
   - `documentElement.scrollWidth` ≤ 视口宽（无横向溢出）；
   - 所有 `pre` / `table` 的 `scrollWidth ≤ clientWidth`；
   - 需单排的元素（如 chips）各元素 `offsetTop` 唯一；
   - 关键区块计数与文案一致（卡片数、代码块数）。
   - 失败则调整后重验：换行 / 截断类改内容或样式微调；单排放不下按实测宽度加宽 body width 并同步 resize 视口。
5. **截图**：`browser_take_screenshot`，fullPage + scale=device，存 `<产物名>.png`。
6. **收尾**：读 PNG IHDR 校验宽高；停后台服务；HTML 与 PNG 同目录保留（改后可重截）。

## 约束

- playwright mcp 连接失败 → 停止并提示用户，不改用其他运行方式。
- 过程产生 `.playwright-mcp/` 目录时，在其中写入 `.gitignore`（内容：`*` 与 `!.gitignore` 两行）。
- 排版验证一律 DOM 断言；仅用户质疑视觉效果时才用图片目检。
