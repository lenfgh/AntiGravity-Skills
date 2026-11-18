# AntiGravity-Skills

**中文** | [**English**](./README_EN.md)

个人维护的 Google Antigravity 插件与技能（Skill Plugins）仓库。每个功能按独立插件目录存放在 `plugins/` 下，可整仓安装，也可按需挑选单个插件或将其中的 `SKILL.md` 复制到 Codex、Claude Code 中使用。

## 插件目录

各插件的具体依赖、配置项与使用示例请查看对应子目录下的 `README.md`：

| 插件 | 类型 | 说明 | 文档 |
| :--- | :--- | :--- | :--- |
| [`doc-viewer`](./plugins/doc-viewer/README.md) | `Sidecar` + `MCP` + `Skill` | 右侧面板文档与数据预览器，支持 DOCX、PDF、XLSX/CSV、PPTX、EPUB、Jupyter、SQLite、ZIP 等格式，支持框选区域截图向 Agent 提交修改意见 | [README](./plugins/doc-viewer/README.md) |
| [`local-office-suite`](./plugins/local-office-suite/README.md) | `Skills` + `Scripts` | 本地 Office 文档生成、编辑与质检套件，包含 `pptx`、`docx-documents`、`office-modeling-and-style`、`pdf-workflows` 四个技能及配套校验/渲染脚本 | [README](./plugins/local-office-suite/README.md) |
| [`auto-review-guardian`](./plugins/auto-review-guardian/README.md) | `PreToolUse Hook` | 工具调用前安全审查钩子：自动放行只读命令、`--help` 与工作区内常规读写，对删除非临时目录、强制推送、发送外部邮件、读取敏感凭据或修改自身配置要求确认 | [README](./plugins/auto-review-guardian/README.md) |
| [`project-onboard`](./plugins/project-onboard/README.md) | `Skill` + `Script` | 项目冷启动接手技能与只读扫描脚本 `scout_project.py`，梳理仓库状态、近期活跃改动、并发热文件提示与有效基线，首轮输出任务对账单 | [README](./plugins/project-onboard/README.md) |
| [`research-hub-sync`](./plugins/research-hub-sync/README.md) | `Rule` + `Skill` + `Script` | 本地工作区与 Google Drive（`01_Logbook`、`02_Studio`、`03_CodeSnapshot.md`）跨端同步规则与技能，附带 `<500 KB` 代码快照打包脚本 `pack_codesnapshot.py` | [README](./plugins/research-hub-sync/README.md) |
| [`local-storage-rules`](./plugins/local-storage-rules/README.md) | `Rule` | 全局存储路径规则：限制将工作文件、临时脚本与中间缓存写入 Windows `C:` 盘，统一引导至数据盘工作区目录 | [README](./plugins/local-storage-rules/README.md) |

## 安装方式

先克隆仓库到本地：

```bash
git clone git@github.com:lenfgh/AntiGravity-Skills.git
cd AntiGravity-Skills
```

### 1. 使用安装脚本

仓库根目录提供了跨平台安装脚本，支持复制安装或软链接安装（软链接模式下后续执行 `git pull` 即可同步更新），并会在安装 `doc-viewer` 时自动执行 `npm install`。

**Windows PowerShell：**

```powershell
# 查看当前可用插件
powershell -ExecutionPolicy Bypass -File .\install.ps1 -List

# 安装全部插件（复制模式）
powershell -ExecutionPolicy Bypass -File .\install.ps1 -All

# 安装全部插件（NTFS Junction 链接模式，无需管理员权限）
powershell -ExecutionPolicy Bypass -File .\install.ps1 -All -Link

# 仅安装指定插件（逗号分隔）
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Plugin doc-viewer,local-office-suite,project-onboard

# 同时将各插件内的 SKILL.md 导出到 ~/.codex/skills
powershell -ExecutionPolicy Bypass -File .\install.ps1 -All -CodexSkills
```

**macOS / Linux：**

```bash
# 安装全部插件（软链接模式）
bash ./install.sh --all --link

# 仅安装指定插件
bash ./install.sh --plugin doc-viewer,project-onboard
```

### 2. 通过 `plugins.json` 挂载

不复制文件，直接在全局 `~/.gemini/config/plugins.json` 或项目 `.agents/plugins.json` 中指向克隆目录（可通过 `include_only` 或 `exclude` 按需筛选）：

```json
{
  "entries": [
    {
      "path": "E:/Project/AntiGravity-Skills/plugins",
      "exclude": []
    }
  ]
}
```

如果通过该方式启用 `doc-viewer`，首次使用前需在 `plugins/doc-viewer/sidecars/doc_viewer` 下执行一次 `npm install`。

### 3. 手动复制

- **安装单个 Antigravity 插件**：将 `plugins/<插件名>` 复制到 `~/.gemini/config/plugins/<插件名>`，在 IDE 的 **Settings → Customizations → Plugins** 中可随时启用或停用。
- **单独复用某个 Skill**：将 `plugins/<插件名>/skills/<技能名>` 复制到 `~/.codex/skills/` 或 `~/.claude/skills/`。

## 新增插件目录结构

后续在 `plugins/` 下新增插件时，遵循以下结构即可被安装脚本与 `plugins.json` 自动识别：

```text
plugins/<plugin-name>/
├── plugin.json               # 必填：插件清单（name 使用小写 kebab-case）
├── README.md                 # 插件说明与使用示例
├── assets/logo.svg           # 可选：方形图标（相对路径引用）
├── rules/AGENTS.md           # 可选：启用插件期间常驻生效的规则
├── hooks.json                # 可选：生命周期钩子（置于插件根目录）
├── mcp_config.json           # 可选：MCP Server 配置
├── sidecars/<name>/          # 可选：侧边栏 Web UI Sidecar
└── skills/<skill-name>/      # 可选：按需加载的技能与脚本
    ├── SKILL.md
    └── scripts/
```

## License

[MIT License](./LICENSE)
