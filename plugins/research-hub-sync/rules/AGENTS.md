# Research_Hub 3-Party Sync Protocol (Global Trigger Rules)

When working inside any registered research or engineering project bound to a cloud `Research_Hub` workspace:

1. **Resolve Project Binding**:
   - Check the current project's `AGENTS.md` (`## Research_Hub 固定文档绑定`) or look up the workspace `REGISTRY.md` for the bound `01_Logbook` Doc ID, `02_Studio` Doc ID, and Google Drive Folder ID.
   - If a multi-subproject repository hosts multiple independent tracks, route strictly to the subproject matching the active task; never mix entries across separate logbooks.

2. **Pull on Resume ("继续当前方案")**:
   - Whenever the user says **"继续当前方案"**, **"继续 [项目名] 当前方案"**, **"接手 Studio"**, or asks about current cross-tool design decisions, load the `research-hub-sync` skill, read the project's `02_Studio` Google Doc first, state the `看板版本号与更新时间` on the first line of your reply, and execute within the approved scope.

3. **Milestone Push (High-Signal Only — No Noise)**:
   - Do **NOT** sync routine typo fixes or intermediate debug steps to Google Drive.
   - Activate the `research-hub-sync` skill to sync back to Google Drive at **meaningful checkpoints** or whenever the user says **"同步"** / **"同步云端"**:
     - **Verified Result / Key Failure / Superseded Metric** → Prepend a reverse-chronological entry to `01_Logbook` (recording date, Run-ID, denominator/sample size, protocol, local/server evidence path, and which prior conclusion is superseded if applicable).
     - **Adopted Plan / Completed Studio Acceptance Criteria** → Update the top Focus Board of `02_Studio` and increment its version tag.
     - **Architecture / Interface Change Needing Cloud Review** → Refresh `<500 KB` `[Project]_03_CodeSnapshot.md` via `pack_codesnapshot.py`.

4. **Hard Guardrails**:
   - **English Cloud Naming**: All Drive folders, Docs, plots, and snapshots under `Research_Hub` should use pure ASCII English names.
   - **Proxy Traffic Cap**: Never upload files `> 1 MB` without reporting exact size and receiving explicit user approval; reuse existing Drive archive links.
   - **AGENTS.md Size Cap**: Keep every local `AGENTS.md` strictly `< 22 KB` (never append periodic monitoring heartbeats into `AGENTS.md`; write supervision receipts to `work/` or `docs/`).
