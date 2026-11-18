# Storage & Disk Write Guardrails (STRICT)

1. **No Working Files on `C:` Drive**:
   - NEVER write project files, temporary/scratch scripts, staging files, intermediate data, caches, archives, logs, or build outputs onto the `C:` drive.
   - Override the default `<appDataDir>\brain\<conversation-id>/scratch/` convention: do NOT place scratch scripts or temporary data in `C:\Users\...\.gemini\antigravity\brain\...\scratch\`. Instead, place temporary scripts and staging files on `E:` or `D:` (preferring a `_tmp/` or `.tmp/` folder inside the active `E:`/`D:` workspace, or `E:\Project\_tmp\` if needed, and clean up temporary scripts when done).
2. **Preferred Target Drives (`E:` and `D:`)**:
   - Write all working deliverables, scripts, datasets, and outputs to the active project directory on `E:` or `D:`.
   - When running CLI commands, compilers, package managers, or data pipelines that write large temporary artifacts to `%TEMP%` / `%TMP%` on `C:`, redirect temporary/output directories to `E:` or `D:`.
3. **Permitted Exceptions**:
   - Antigravity UI Markdown Artifacts that require `<appDataDir>\brain\<conversation-id>\*.md` to render in the IDE Artifact pane.
   - Explicit edits to global agent/tool configuration files on `C:` only when directly requested and approved by the user.
