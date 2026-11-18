# Portable Cold-Start Onboarding Prompt (for Web ChatGPT / Gemini / External Sessions)

Use this standalone prompt when starting a session in an environment that does not automatically mount the `project-onboard` skill:

```markdown
你现在接手当前工作区项目。请严格遵循“零改动、零全量哈希、按真相优先级精读”原则完成冷启动摸底，并聚焦到我们最新的任务：

1. **先跑秒级只读探针（若本地可用）**：
   运行 `python $HOME\.gemini\config\plugins\project-onboard\scripts\scout_project.py --path "<项目根目录>"`（严禁递归扫 `.venv` / `third_party` / `.cache` / 权重目录，严禁计算全仓库或模型 SHA256，严禁向 `C:` 盘写临时文件）。

2. **按真相优先级精读（控制在 5–8 个核心文件内，大于 50KB 的文件只读前 150 行或提取顶层字段）**：
   - **L1 硬约束**：`AGENTS.md`、`TEST_SERVER.md`（明确算力边界、单写者归属与禁区红线）；
   - **L2 最新实测回执**：近 72 小时修改的 `work/`、`runs/`、`model_runs/`、`research/` 下的 `status.json`、`current*.json`、最新诊断/审计报告与 `git status`（保护未提交改动，留意近 30 分钟仍在更新的热文件）；
   - **L3 云端共识（若已绑定 Research_Hub 且需对账）**：对比 `02_Studio` 看板版本与本地 L2 回执是否存在时间差；
   - **L4 概念与接口**：`README.md`、`pyproject.toml`、近期实验计划（注意：若 `README.md` 修改时间滞后，仅用于理解科学问题与 CLI 接口，忽略其中过时的进度描述）。

3. **首轮保持只读（不提停作业、不改跟踪代码），直接向我输出《项目接手与最新任务对账单》**：
   - **项目主线与入口**（2 句话讲清科学/工程目标与核心代码入口）；
   - **有效基线与排雷**（当前唯一有效基准、精确评测分母/截点、已作废的历史旧口径提醒）；
   - **当前活跃战线总表**（各并行任务进度、JobId/回执路径、运行端/Worker 归属、当前阻塞点）；
   - **环境与红线核验**（Python/服务器环境、并发热文件预警、磁盘与资产禁区）；
   - **下一步最高优先级行动建议（Top 1–3）**（区分已获授权可立即执行项 vs. 需我拍板决策项）。
```
