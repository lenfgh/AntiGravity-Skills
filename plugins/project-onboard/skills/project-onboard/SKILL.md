---
name: project-onboard
description: >-
  Cold-start onboarding workflow for any session taking over an unfamiliar, complex ongoing,
  or brand-new project workspace. Runs a sub-second read-only scout (`$HOME\.gemini\config\plugins\project-onboard\scripts\scout_project.py`),
  reconciles governance rules, nested Git dirty state, live concurrent workers, valid evaluation baselines,
  and recent execution receipts (plus optional Research_Hub Studio drift), then locks onto the latest active
  tasks with a crisp 1-screen Handover Alignment Brief. Use when the user says "接手项目", "接手这个项目",
  "接手新项目", "熟悉这个项目", "摸底当前项目", "理解这个项目并聚焦最新任务", "盘点当前战线", or "/onboard".
---

# Project Cold-Start Onboarding & Task Focus (`project-onboard`)

Use this skill whenever a fresh session needs to rapidly understand a project (whether a massive multi-worker research workspace under `E:\Project\*` or a brand-new repository) and converge on the **latest high-priority tasks** without wasting tokens or disturbing live jobs.

> **Scope Boundary with `research-hub-sync`**:
> - `project-onboard` handles **local cold-start discovery, truth-hierarchy reconciliation, hazard detection, and locking onto active tasks** (including unregistered/new repos).
> - `research-hub-sync` handles **reading/writing Google Drive `01_Logbook`, `02_Studio`, and packing `03_CodeSnapshot.md`**. When onboarding a `STATE_A_REGISTERED` project and cloud alignment is needed, use both together.

---

## Step 1: Run the Deterministic Sub-Second Scout (Zero Mutation, Zero SHA256)

Before running manual `ls`/`Get-ChildItem` loops or broad searches, execute the read-only scout script against the target workspace:

```powershell
python $HOME\.gemini\config\plugins\project-onboard\scripts\scout_project.py --path "<WORKSPACE_PATH>"
```

- **Hard Cold-Start Prohibitions**:
  - **NEVER** compute SHA256 hashes over repositories, checkpoints, datasets, or models.
  - **NEVER** recursively list `.venv`, `third_party`, `.cache`, `node_modules`, or timestamped `stdout.json` dump folders.
  - **NEVER** write scratch/temporary files onto the `C:` drive (if temporary staging is ever needed later, use `E:\Project\_tmp\` or `<workspace>\_tmp\` on `E:`/`D:`).

---

## Step 2: Targeted Reading via the Truth-Recency Pyramid (Max 5–8 Files)

Read files strictly in the following authority & recency order, using `size_kb` from the scout digest to avoid context bloat (**if a JSON/MD file is `> 50 KB`, read only the first 120–180 lines or query top-level keys via a tiny read-only Python snippet instead of dumping the whole file**):

1. **L1 — Hard Governance & Ownership Boundaries (Highest Authority)**:
   - Read workspace `AGENTS.md` (and root `E:\Project\AGENTS.md` if applicable).
   - If `TEST_SERVER.md` or subproject `AGENTS.md` exists, read only its connection/ownership header (first 80–120 lines) unless actively debugging servers.
2. **L2 — Live Machine Receipts & Active Battlefronts**:
   - Read the top **3–5** files listed under `## 5. High-Signal Canonical Anchor Files` in the scout output (covering the top active workstreams in `## 4`).
   - Check `## 0. Alerts & Hazard Checks`:
     - If `[LIVE_ACTIVITY_ALERT]` is present, another Worker, daemon, or parallel session modified files within the last 30 minutes—treat those paths as **hot/concurrent** and do NOT overwrite them!
3. **L3 — Cross-Tool Cloud Consensus (Only if `STATE_A_REGISTERED` and Cloud Check Applies)**:
   - If the user asked to align with Studio ("继续当前方案" / "对账云端") or local state is ambiguous, read the top Focus Board of `02_Studio` using the `Studio Doc ID` from `## 1. Research_Hub Registry Binding` (`gdocs readonly read <STUDIO_DOC_ID>` in Antigravity, or Google Docs tool in Codex).
   - **Explicitly check for L2-vs-L3 Timestamp Drift**: Flag if local L2 receipts have newer progress/failures not yet written back to `01_Logbook` / `02_Studio`, or if `02_Studio` has a newer plan not yet started locally.
4. **L4 — Conceptual Architecture & CLI Entrypoints**:
   - Read `README.md`, `pyproject.toml` / `package.json`, or the latest plan doc to understand the scientific/engineering problem, model/module interfaces, and CLI commands.
   - **Beware the Stale README Trap**: Whenever `[STALE_README_WARNING]` appears, use `README.md` **strictly** for conceptual architecture and CLI syntax—ignore any old progress/status claims inside it.

### Branching by Onboarding State
- **`STATE_A_REGISTERED`** (Mature `Research_Hub` project): Reconcile L1 + L2 (+ L3 if needed), identify valid baselines vs. invalidated old scores, and lock directly onto the active workstreams.
- **`STATE_B_UNREGISTERED_ACTIVE`** (Mid-flight / Collaborator handoff / Dirty workspace): Protect uncommitted Git diffs (`## 3`), reconstruct what is currently running or failing from recent scripts/logs, and map out Python/server environments before proposing actions.
- **`STATE_C_NEW_OR_BARE`** (Brand-new repository): Map directory topology (`src/`, `scripts/`, `configs/`, `tests/`), build/runtime dependencies, and core entrypoints. Offer to generate an initial `< 22 KB` project `AGENTS.md` (and optional `REGISTRY.md` entry) using [bootstrap_agents_template.md](./references/bootstrap_agents_template.md) upon user approval.

---

## Step 3: Extract the 4 Mandatory Safety & Context Pillars

Before formulating your summary, verify you have exact answers (not guesses) for:

1. **Concurrency & Ownership**: Which active jobs (`JobId`), servers, quotas, or Worker IDs belong to the user vs. teammates/other sessions? Which clusters/hosts are revoked or read-only? What uncommitted Git modifications exist (never `git reset` / `checkout` them)?
2. **Environment & Heavy-Asset Topology**: Code edit directory → Debug machine/interpreter → Formal compute pool → Heavy file transfer rules (no `C:` working files, keep `AGENTS.md < 22 KB`, no unapproved `> 1 MB` Drive uploads, no routing server weights through local PC).
3. **Valid Baselines & Superseded Metric Traps**: What is the current valid reference score, exact evaluation denominator / split / cutoff (e.g., `10,030` episodes vs. `2,000` subset; `09:25` cutoff with `09:20` bar lag), and which historical numbers were superseded due to earlier bugs/prompt fixes?
4. **Bottleneck & Next-Step Readiness**: Among active tasks, which is closest to completion/transition (e.g., training about to finish needing evaluation handoff), which is blocked/queuing, and which has an open bug/diagnosis needing a fix decision?

---

## Step 4: Turn-1 Read-Only Gate — Output《项目接手与最新任务对账单》

Unless the user's prompt explicitly orders an immediate mutation within pre-verified authorization, **Turn 1 is strictly read-only** (do NOT launch/stop cluster jobs, kill processes, or overwrite tracked files). Present a concise, structured 1-screen brief:

```markdown
## 项目接手与最新任务对账单（<Project Name> · <Onboarding State>）

### 1. 项目主线与代码入口
- **核心目标**：<1–2 句话概括科学问题或系统目标，如 VLM→VFM→Action 联合动作生成框架>
- **代码与接口拓扑**：<主包/子仓路径、核心 CLI 或训练/评测主入口>

### 2. 有效基线与评测口径（含排雷提醒）
- **当前有效参照系**：<最新有效基线数值 + 精确分母/数据集划分/时间截点>
- **历史废止口径提醒**：<明确指出哪些旧结果/旧 README 描述已过时或被修正取代，防止误比>

### 3. 当前活跃战线总表（截至 <YYYY-MM-DD HH:MM>）
| 战线 / 子任务 | 当前状态与最新进度 | 关键回执 / JobId | 运行环境 / 归属 Worker | 阻塞点或关注项 |
| :--- | :--- | :--- | :--- | :--- |
| ... | ... | ... | ... | ... |
*(若检查了云端 `02_Studio`，在此用 1 句话注明本地最新回执与云端看板版本是否一致)*

### 4. 环境边界与执行红线核验
- **运行与环境**：<编辑端 / Debug 端 / 正式算力端 / Python 虚拟环境>
- **现场保护预警**：<未提交 Git 改动概况、近 30 分钟热写入并发预警、禁区与算力红线>

### 5. 聚焦下一步行动建议（按紧迫度排序）
1. **[最高优 · 可立即执行 / 待你确认]**：<具体动作 + 涉及脚本/路径>
2. **[次高优]**：<具体动作>
3. *(仅在 `STATE_C_NEW_OR_BARE` 或缺少规范入口时)*：是否需要按模板初始化本项目的 `AGENTS.md` 与 `Research_Hub` 绑定？
```

---

## References

- **Bootstrapping a Brand-New Project (`AGENTS.md` `< 22 KB` template)**: [bootstrap_agents_template.md](./references/bootstrap_agents_template.md)
- **Portable Copy-Paste Onboarding Prompt (for Web ChatGPT / Gemini without local skills)**: [portable_prompt.md](./references/portable_prompt.md)
