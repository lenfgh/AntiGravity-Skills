# Research_Hub 3-Party Sync (`research-hub-sync`)

用于在本地开发工具（Antigravity、Codex）与云端对话环境（ChatGPT、Gemini Web + Google Drive）之间同步项目状态与代码上下文的规则、技能与打包脚本。

## 文档分工约定

每个项目在 Google Drive 对应目录下维护三个固定文档，并在本地项目 `AGENTS.md` 或总表 `REGISTRY.md` 中记录其 ID：

1. **`01_Logbook`（Google Doc）**：按日期倒序记录已核实的实验结果、样本量/评测分母、关键失败原因及旧结论更替说明，不记录日常零碎调试过程。
2. **`02_Studio`（Google Doc）**：顶部保留 5 行概要表（看板版本号 `vYYYYMMDD-N`、当前待解问题、已选定方案、验收条件、下一步交接），用于跨端对齐当前执行方案。
3. **`[Project]_03_CodeSnapshot.md`（`< 500 KB` 单文件代码快照）**：由 `scripts/pack_codesnapshot.py` 生成，包含精简目录树与核心源码；超出体积预算的 Python 文件自动退化为 AST 类与函数签名摘要，便于直接上传到网页端做代码结构评审。

## 配置与准备

1. **启用 Google Workspace 插件**：在 Antigravity 中安装并登录官方 `Google Docs` (`gdocs`) 与 `Google Drive` (`gdrive`) 插件。
2. **绑定文档 ID**：参考 [`examples/REGISTRY.example.md`](./examples/REGISTRY.example.md) 在本地工作区建立路由表，或在项目 `AGENTS.md` 顶部记录对应的 `Drive Folder ID`、`01_Logbook` 与 `02_Studio` Doc ID；如需为 `pack_codesnapshot.py` 配置固定预设，可参考 [`examples/projects.example.json`](./examples/projects.example.json)。

## 使用方法

### 1. 对话触发指令
- **拉取当前方案**：输入 `“继续当前方案”` 或 `“接手 Studio”`，Agent 会先读取 `02_Studio` 顶部看板并在回复首行注明当前看板版本号，再按约定范围执行。
- **里程碑同步**：实验结果核实后输入 `“同步”` 或 `“同步云端”`，Agent 会将新增实验记录按模板写入 `01_Logbook`，或在方案变更时更新 `02_Studio` 版本号。

### 2. 生成代码快照 (`pack_codesnapshot.py`)
无需配置文件，可直接指定仓库根目录与优先打包的子目录：

```bash
python ~/.gemini/config/plugins/research-hub-sync/scripts/pack_codesnapshot.py \
  --project MyProject \
  --root /path/to/repo \
  --focus src/core src/cli tests \
  --out /path/to/repo/_tmp/MyProject_03_CodeSnapshot.md
```

若已配置 Google Drive 目标目录或文件 ID，可附加 `--upload`（配合 `--folder-id <ID>` 或 `--file-id <ID>`，或通过 `--config projects.json` 读取预设）直接上传更新至云端。
