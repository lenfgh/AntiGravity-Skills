# Document Viewer (`doc-viewer`)

一个专为 **Google Antigravity** 打造的侧边栏（`SIDECAR_UI_ENTRYPOINT_AUX_PANE`）全能文档与数据预览插件，集成了 **Web UI Sidecar + MCP Server + `doc-viewer` Skill**。无需离开 IDE，即可在右侧面板原位预览 35+ 种办公文档、科研数据与代码文件，并支持**框选区域截图向 Agent 批量提修改需求**。

## ✨ 核心特性

- **Word 文档 (`.docx`, `.doc`, `.odt`, `.rtf`)**：双模式切换 —— `docx-preview` 高保真分页版式视图 + `mammoth` 清爽阅读视图。
- **PDF 文档 (`.pdf`)**：内置自托管 `pdfjs-dist`（含完整 CJK 中日韩字库 CMaps、HiDPI 渲染、文本复制、目录大纲、缩放与全文检索）。
- **电子表格 (`.xlsx`, `.xls`, `.xlsm`, `.xlsb`, `.ods`, `.csv`, `.tsv`)**：多 Sheet 标签切换、实时关键词过滤与大表分页浏览。
- **演示文稿 (`.pptx`, `.odp`)**：逐页幻灯片结构化预览，还原定位文本框、表格、内嵌图片与演讲者备注。
- **科研与工程格式**：
  - Jupyter Notebooks (`.ipynb`) 代码块与输出渲染
  - SQLite 数据库 (`.sqlite`, `.sqlite3`, `.db`) 表结构与分页数据浏览器
  - 压缩归档包 (`.zip`, `.jar`, `.whl`, `.apk`) 内部目录树探索
  - 电子书 (`.epub`)、结构化配置 (`.json`, `.jsonl`, `.yaml`, `.toml`, `.xml`)
  - 网页/图像/音视频/字体 (`.md`, `.html`, `.svg`, `.png/.webp`, `.mp3/.mp4`, `.ttf/.otf/.woff2`) 及自动识别 `UTF-8 / GB18030 / UTF-16` 的语法高亮代码查看器。
- **框选批注闭环**：在预览界面框选任意段落/图表区域并输入修改意见，可自动附带选区高清截图发回给 Agent 精准修订。

## 📦 安装步骤

### 方式一：使用仓库根目录一键安装脚本（推荐）
```powershell
# Windows PowerShell（自动复制插件并执行 sidecar 依赖安装）
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Plugin doc-viewer
```
```bash
# macOS / Linux
bash ./install.sh --plugin doc-viewer
```

### 方式二：手动安装
1. 将 `plugins/doc-viewer` 复制到 `~/.gemini/config/plugins/doc-viewer`（全局）或项目 `.agents/plugins/doc-viewer`。
2. 安装 Sidecar 前端与解析依赖：
   ```bash
   cd ~/.gemini/config/plugins/doc-viewer/sidecars/doc_viewer
   npm install
   ```

## 🚀 使用方法

安装后直接用自然语言对 Agent 说：
- `“在侧边栏打开刚生成的 report.docx”`
- `“把 results/summary.xlsx 放到右侧 Document Viewer 里给我看一眼”`
- `“打开侧边栏预览 paper.pdf”`

Agent 会调用 `doc-viewer_doc_viewer_mcp` 的 `open_document` 工具，并在对话中返回一个一键打开胶囊链接：`[预览 report.docx](sidecar://doc-viewer/doc_viewer/)`。你也可以直接在面板顶部输入任意本地路径或拖拽文件进入窗口预览。
