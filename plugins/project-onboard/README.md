# Project Cold-Start Onboarding (`project-onboard`)

当你在新会话中接手一个**庞大的多战线在研项目、他人移交的半途脏仓库（Dirty Working Tree），或全新的空白代码库**时，普通 Agent 往往会盲目全盘 `ls`、误把过时的 `README.md` 当成最新进度，甚至覆盖正在后台跑任务的并发文件。

`project-onboard` 通过**“亚秒级零改动探针（`scout_project.py`）+ 四层真相优先级金字塔 + 首轮只读对账门禁”**，让 Agent 在数秒内精准锁定最新有效基线、活跃任务与安全红线。

## ✨ 核心设计亮点

1. **亚秒级零副作用探针 (`scripts/scout_project.py`)**：
   - **零写入、零 SHA256 哈希、零大权重/缓存目录扫描**（自动跳过 `.venv`、`node_modules`、`checkpoints`、`wandb` 等）。
   - 自动检测根目录与一级子目录嵌套 Git 仓库的未提交改动（Dirty State）。
   - **并发热写入雷达 (`[LIVE_ACTIVITY_ALERT]`)**：自动标记过去 30 分钟内有其他 Worker 或后台任务正在写入的文件，防止踩踏。
   - **陈旧文档排雷 (`[STALE_README_WARNING]`)**：自动识别长期未更新的 `README.md`，提示仅参考其架构与 CLI 语法，不采信旧指标。
2. **四层真相优先级精读（最多精读 5–8 个高信号文件）**：
   - **L1 硬约束与边界**：`AGENTS.md` / `CLAUDE.md` / `GEMINI.md` / `TEST_SERVER.md`
   - **L2 机器实测回执**：近期更新的 `status.json`、诊断报告与实验记录
   - **L3 跨端云看板（可选）**：与 `research-hub-sync` 联动核验云端 `02_Studio` 时间差
   - **L4 架构与入口**：`pyproject.toml` / `package.json` / 核心 CLI
3. **首轮输出《项目接手与最新任务对账单》**：一屏看清项目主线、有效基线（含废止旧口径排雷）、活跃战线总表、环境红线与按紧迫度排序的 Top 行动建议。

## 🚀 使用方法

### 1. 在 Antigravity 中直接触发
打开任意项目工作区，在首轮对话输入以下任一指令即可自动激活：
- `“接手这个项目”` / `“摸底当前项目”`
- `“理解这个项目并聚焦最新任务”`
- `“盘点当前战线”`

### 2. 单独在命令行运行探针脚本
```bash
# 输出结构化 Markdown 侦察简报
python ~/.gemini/config/plugins/project-onboard/scripts/scout_project.py --path /path/to/workspace

# 输出机器可读 JSON（自定义近期活跃窗口天数）
python ~/.gemini/config/plugins/project-onboard/scripts/scout_project.py --path /path/to/workspace --days 14 --json
```

### 3. 在网页端 ChatGPT / Gemini 使用
插件内置了免工具复制粘贴提示词模板，详见 [`skills/project-onboard/references/portable_prompt.md`](./skills/project-onboard/references/portable_prompt.md)；对于全新空白项目，还附带 `< 22 KB` 精简规范治理模板 [`bootstrap_agents_template.md`](./skills/project-onboard/references/bootstrap_agents_template.md)。
