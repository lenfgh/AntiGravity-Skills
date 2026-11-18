# AntiGravity-Skills 🚀

[**中文完整教程 (`README.md`)**](./README.md) | **English Guide**

A production-tested monorepo of custom **Skill Plugins** built for **Google Antigravity** (with standalone `SKILL.md` bundles also directly reusable in **Codex CLI / Desktop** and **Claude Code**).

Instead of loose prompt snippets, **AntiGravity-Skills** packages **interactive side-pane UI sidecars + MCP servers, render-verified local Office engineering workflows, sub-10ms `PreToolUse` security hooks, sub-second zero-mutation repository onboarding, and cross-agent cloud synchronization** into modular, toggleable Antigravity plugins (`plugins/<name>/plugin.json`).

---

## 📦 Plugin Catalog (6 Plugins)

| Plugin (`plugins/`) | Components | What It Does | Docs |
| :--- | :--- | :--- | :--- |
| [**`doc-viewer`**](./plugins/doc-viewer/README.md) | `Sidecar UI` + `MCP` + `Skill` | Previews **35+ formats** directly inside Antigravity's auxiliary side pane: **DOCX** (layout + clean reader), **PDF** (self-hosted PDF.js + CJK CMaps + search), **XLSX/CSV**, **PPTX**, **EPUB**, **Jupyter `.ipynb`**, **SQLite**, **ZIP**, media, fonts, and code—plus **region-selection screenshot requests** back to the agent. | [README](./plugins/doc-viewer/README.md) |
| [**`local-office-suite`**](./plugins/local-office-suite/README.md) | `4× Skills` + `35+ Scripts` | End-to-end local Office authoring & visual/formula QA: **`pptx`** (PptxGenJS + theme/Lucide helpers + ISO OOXML XSD validation + PowerPoint COM overflow QA), **`docx-documents`** (25+ OOXML scripts for tracked changes `<w:ins>`/`<w:del>`, comments, TOC, redaction + `render_docx.py`), **`office-modeling-and-style`** (dynamic formula architecture + Excel COM `CalculateFullRebuild()` error audit + Anti-Slop writing guide), and **`pdf-workflows`** (interactive AcroForm repair/fill + Poppler page QA). | [README](./plugins/local-office-suite/README.md) |
| [**`auto-review-guardian`**](./plugins/auto-review-guardian/README.md) | `PreToolUse Hook` | Codex `auto_review`-inspired security gate (`<10ms`, zero external Python deps): silently allows read-only commands, `--help`, active workspace edits, and safe `_tmp` cleanups while requiring confirmation (`force_ask` / `deny`) on disk formatting, recursive non-temp deletes, force-pushes, outbound emails (`gmail send`), external file sharing, `.env`/`.ssh` reads, or self-tampering. | [README](./plugins/auto-review-guardian/README.md) |
| [**`project-onboard`**](./plugins/project-onboard/README.md) | `Skill` + `Scout Script` | Cold-start onboarding for complex or unfamiliar repositories: runs deterministic sub-second `scripts/scout_project.py` (zero mutation, zero SHA256, `<30 min` concurrent worker hazard alerts, stale README detection), reads via a 4-tier Truth-Recency Pyramid, and outputs a 1-screen Handover & Active Task Alignment Brief. | [README](./plugins/project-onboard/README.md) |
| [**`research-hub-sync`**](./plugins/research-hub-sync/README.md) | `Rule` + `Skill` + `Bundler` | Synchronizes local multi-project workspaces with Google Drive `Research_Hub` (`01_Logbook`, `02_Studio`, and AST-aware `<500 KB` `03_CodeSnapshot.md` via `scripts/pack_codesnapshot.py`) across Antigravity, Codex, ChatGPT, and Gemini. | [README](./plugins/research-hub-sync/README.md) |
| [**`local-storage-rules`**](./plugins/local-storage-rules/README.md) | `Global Rule` | Always-on storage guardrail for multi-drive workstations: keeps scratch scripts, intermediate renders, and heavy CLI temp artifacts off the Windows `C:` system SSD and routes them cleanly to data drives (`D:` / `E:`). | [README](./plugins/local-storage-rules/README.md) |

---

## ⚡ Quick Installation (3 Ways)

Clone the repository first:

```bash
git clone git@github.com:lenfgh/AntiGravity-Skills.git
cd AntiGravity-Skills
```

### Option 1: One-Command Installer Script (Recommended)

Supports installing all plugins, cherry-picking specific plugins, **symlink / NTFS Junction live-update mode** (no Administrator privileges required on Windows, so `git pull` updates installed plugins immediately), and automatic `npm install` for `doc-viewer`:

**Windows PowerShell:**
```powershell
# Install all 6 plugins (copy mode)
powershell -ExecutionPolicy Bypass -File .\install.ps1 -All

# Recommended: Link mode via NTFS Junctions (live updates on git pull!)
powershell -ExecutionPolicy Bypass -File .\install.ps1 -All -Link

# Install selected plugins only
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Plugin doc-viewer,local-office-suite,project-onboard

# Also export bundled SKILL.md folders to ~/.codex/skills
powershell -ExecutionPolicy Bypass -File .\install.ps1 -All -CodexSkills
```

**macOS / Linux:**
```bash
# Install all plugins via symlinks
bash ./install.sh --all --link

# Install specific plugins
bash ./install.sh --plugin doc-viewer,project-onboard
```

### Option 2: Zero-Copy Declarative Registration (`plugins.json`)

Point Antigravity directly at the cloned `plugins/` folder via `~/.gemini/config/plugins.json` (global) or `.agents/plugins.json` (project-scoped):

```json
{
  "entries": [
    {
      "path": "/absolute/path/to/AntiGravity-Skills/plugins"
    }
  ]
}
```
*(If using `doc-viewer` via Option 2, run `npm install` once inside `plugins/doc-viewer/sidecars/doc_viewer`.)*

### Option 3: Manual Copy

Copy any `plugins/<plugin-name>` folder into `~/.gemini/config/plugins/<plugin-name>` (or copy individual `skills/<skill-name>` folders into `~/.codex/skills/` or `~/.claude/skills/`). Manage enabled/disabled states live in **Antigravity Settings → Customizations → Plugins**.

---

## 🚀 Starter Prompts & Usage Recipes

- **Preview documents in the side pane (`doc-viewer`)**:
  - *"Open `report.docx` (or `paper.pdf` / `metrics.xlsx` / `deck.pptx`) in the Document Viewer side pane."*
- **Create & visually audit Office deliverables (`local-office-suite`)**:
  - *"Use the `pptx` skill to build an 8-slide technical review deck with a custom dark theme and native bar charts, validate it with `validate.py`, and render slide PNGs to verify zero text overflow."*
  - *"Apply tracked changes (`<w:del>`/`<w:ins>`) and explanatory comments to `draft.docx` without overwriting clean structure, then render pages via `render_docx.py` to inspect layout."*
  - *"Build a dynamic formula workbook `forecast.xlsx` following `Outputs -> Assumptions -> Builds -> Inputs -> Checks` and audit formula recalculation with `audit_xlsx_excel_com.ps1`."*
- **Onboard onto an unfamiliar or complex active repo (`project-onboard`)**:
  - *"Onboard onto this project, check active workstreams and uncommitted changes with `scout_project.py`, and give me the Turn-1 Handover & Task Alignment Brief."*
- **Sync milestones & bundle code for cloud architecture review (`research-hub-sync`)**:
  - *"Resume current Studio plan (`继续当前方案`)"* / *"Sync verified metrics to `01_Logbook` (`同步云端`)"*
  - CLI snapshot bundler: `python plugins/research-hub-sync/scripts/pack_codesnapshot.py --project MyApp --root /path/to/repo --focus src tests`
- **Verify `auto-review-guardian` policy unit tests**:
  - `python -B -m unittest discover -s plugins/auto-review-guardian/scripts -p "test_*.py" -v`

---

## 📄 License

Released under the [MIT License](./LICENSE) (with upstream notices preserved in `LICENSE.txt` inside applicable `local-office-suite` subdirectories).
