# Project Cold-Start Onboarding (`project-onboard`)

用于在新会话开始时快速摸底陌生仓库或多任务并行项目的技能，配套只读扫描脚本 `scripts/scout_project.py`。

## 工作流程

1. **运行只读探针 (`scripts/scout_project.py`)**：
   - 不修改任何文件，不计算仓库或模型权重的 SHA256，自动跳过 `.venv`、`node_modules`、`checkpoints`、`wandb` 等大目录。
   - 检查根目录及一级子目录 Git 仓库的分支与未提交改动状态。
   - **并发写入提示 (`[LIVE_ACTIVITY_ALERT]`)**：标记过去 30 分钟内被修改过的文件，避免覆盖后台任务或其他会话正在写入的目录。
   - **陈旧文档提示 (`[STALE_README_WARNING]`)**：当 `README.md` 更新时间明显早于近期实验记录时发出提示，仅将其用于了解模块结构与 CLI 参数，不采信其中的旧进度指标。
2. **按优先级读取关键文件（控制在 5–8 个文件内）**：
   - **L1 治理与边界**：`AGENTS.md` / `CLAUDE.md` / `GEMINI.md` / `TEST_SERVER.md`
   - **L2 近期运行记录**：最近活跃目录下的 `status.json`、诊断摘要与实验报告
   - **L3 云端看板（可选）**：若项目绑定了 `Research_Hub`，可对照云端 `02_Studio` 版本检查是否有进度时间差
   - **L4 代码结构与入口**：`pyproject.toml` / `package.json` 及主入口文件
3. **首轮保持只读并输出对账单**：
   首轮汇总输出项目的核心目标与入口、当前有效基线（及已作废的旧评测口径）、活跃任务列表、环境与并发注意事项，以及下一步待执行事项。

## 使用方法

### 1. 在对话中触发
打开目标项目工作区后输入：
- `“接手这个项目”` / `“摸底当前项目”`
- `“理解这个项目并聚焦最新任务”`
- `“盘点当前战线”`

### 2. 单独运行扫描脚本
```bash
# 输出 Markdown 摘要（默认扫描最近 7 天活跃记录）
python ~/.gemini/config/plugins/project-onboard/scripts/scout_project.py --path /path/to/workspace

# 自定义回溯天数并输出 JSON
python ~/.gemini/config/plugins/project-onboard/scripts/scout_project.py --path /path/to/workspace --days 14 --json
```

### 3. 附带参考模板
- **新项目 `AGENTS.md` 初始化模板（控制在 `< 22 KB`）**：[`skills/project-onboard/references/bootstrap_agents_template.md`](./skills/project-onboard/references/bootstrap_agents_template.md)
- **无本地插件环境（网页端 ChatGPT / Gemini）可用的接手提示词**：[`skills/project-onboard/references/portable_prompt.md`](./skills/project-onboard/references/portable_prompt.md)
