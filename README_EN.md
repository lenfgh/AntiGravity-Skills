# AntiGravity-Skills

[**中文**](./README.md) | **English**

A collection of custom plugins and skills for Google Antigravity. Each plugin lives in its own directory under `plugins/` so you can install the whole repository, pick individual plugins, or reuse standalone `SKILL.md` directories in Codex and Claude Code.

## Plugins

See each plugin's `README.md` for prerequisites, configuration details, and usage examples:

| Plugin | Type | Description | Docs |
| :--- | :--- | :--- | :--- |
| [`doc-viewer`](./plugins/doc-viewer/README.md) | `Sidecar` + `MCP` + `Skill` | Side-pane file viewer supporting DOCX, PDF, XLSX/CSV, PPTX, EPUB, Jupyter `.ipynb`, SQLite, ZIP, media, fonts, and source code, with region-selection screenshot feedback | [README](./plugins/doc-viewer/README.md) |
| [`local-office-suite`](./plugins/local-office-suite/README.md) | `Skills` + `Scripts` | Local Office creation, editing, and verification skills (`pptx`, `docx-documents`, `office-modeling-and-style`, `pdf-workflows`) with OOXML validation, Excel COM formula checks, and page-render QA | [README](./plugins/local-office-suite/README.md) |
| [`auto-review-guardian`](./plugins/auto-review-guardian/README.md) | `PreToolUse Hook` | Pre-execution tool gate that allows read-only commands, `--help`, and workspace edits while requiring confirmation for non-temp recursive deletes, force-pushes, outbound emails, credential reads, or config edits | [README](./plugins/auto-review-guardian/README.md) |
| [`project-onboard`](./plugins/project-onboard/README.md) | `Skill` + `Script` | Cold-start repository onboarding skill paired with `scout_project.py` to inspect git state, recent workstreams, concurrent writes, and active tasks without mutating files | [README](./plugins/project-onboard/README.md) |
| [`research-hub-sync`](./plugins/research-hub-sync/README.md) | `Rule` + `Skill` + `Script` | Synchronization rules and workflow linking local workspaces with Google Drive (`01_Logbook`, `02_Studio`, `03_CodeSnapshot.md`), including the `<500 KB` `pack_codesnapshot.py` bundler | [README](./plugins/research-hub-sync/README.md) |
| [`local-storage-rules`](./plugins/local-storage-rules/README.md) | `Rule` | Global rule keeping working files, temporary scripts, and build caches on data drives (`D:` / `E:`) rather than the Windows `C:` drive | [README](./plugins/local-storage-rules/README.md) |

## Installation

Clone the repository:

```bash
git clone git@github.com:lenfgh/AntiGravity-Skills.git
cd AntiGravity-Skills
```

### 1. Installer Script

The root installer supports copying or linking plugins (link mode lets `git pull` update installed plugins directly) and runs `npm install` automatically when installing `doc-viewer`.

**Windows PowerShell:**

```powershell
# List available plugins
powershell -ExecutionPolicy Bypass -File .\install.ps1 -List

# Install all plugins (copy mode)
powershell -ExecutionPolicy Bypass -File .\install.ps1 -All

# Install all plugins via NTFS Junctions (no Admin required)
powershell -ExecutionPolicy Bypass -File .\install.ps1 -All -Link

# Install selected plugins only
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Plugin doc-viewer,local-office-suite,project-onboard

# Also copy bundled SKILL.md folders to ~/.codex/skills
powershell -ExecutionPolicy Bypass -File .\install.ps1 -All -CodexSkills
```

**macOS / Linux:**

```bash
# Install all plugins via symlinks
bash ./install.sh --all --link

# Install selected plugins
bash ./install.sh --plugin doc-viewer,project-onboard
```

### 2. Reference via `plugins.json`

Add the cloned `plugins/` folder to `~/.gemini/config/plugins.json` (global) or `.agents/plugins.json` (workspace):

```json
{
  "entries": [
    {
      "path": "/absolute/path/to/AntiGravity-Skills/plugins",
      "exclude": []
    }
  ]
}
```

If enabling `doc-viewer` through `plugins.json`, run `npm install` once inside `plugins/doc-viewer/sidecars/doc_viewer`.

### 3. Manual Copy

- **Antigravity plugin**: Copy `plugins/<plugin-name>` to `~/.gemini/config/plugins/<plugin-name>`, and toggle plugins anytime under **Settings → Customizations → Plugins**.
- **Standalone skill**: Copy `plugins/<plugin-name>/skills/<skill-name>` to `~/.codex/skills/` or `~/.claude/skills/`.

## Adding New Plugins

New plugins placed under `plugins/<plugin-name>/` with a `plugin.json` manifest are picked up automatically by the installer scripts and `plugins.json`:

```text
plugins/<plugin-name>/
├── plugin.json               # Required manifest (lowercase kebab-case name)
├── README.md                 # Documentation and usage examples
├── assets/logo.svg           # Optional square icon (relative path)
├── rules/AGENTS.md           # Optional always-on rules while enabled
├── hooks.json                # Optional lifecycle hooks (at plugin root)
├── mcp_config.json           # Optional MCP server config
├── sidecars/<name>/          # Optional auxiliary pane Web UI sidecar
└── skills/<skill-name>/      # Optional on-demand skills and scripts
    ├── SKILL.md
    └── scripts/
```

## License

[MIT License](./LICENSE)
