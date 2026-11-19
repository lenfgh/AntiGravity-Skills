# Document Viewer (`doc-viewer`)

Google Antigravity 右侧辅助面板（`SIDECAR_UI_ENTRYPOINT_AUX_PANE`）文档与数据预览插件，包含 Web UI Sidecar、MCP Server（`open_document`、`list_documents`、`get_viewer_state`）与 `doc-viewer` Skill。

## 支持格式与功能

- **文档 (`.docx`, `.doc`, `.odt`, `.rtf`)**：支持 `Layout`（`docx-preview` 分页版式）与 `Reader`（`mammoth` 重排阅读）两种视图切换。
- **PDF (`.pdf`)**：内置自托管 `pdfjs-dist`，包含 CJK 中日韩字库 CMaps、HiDPI 渲染、文本选择、目录大纲、缩放与全文搜索。
- **表格 (`.xlsx`, `.xls`, `.xlsm`, `.xlsb`, `.ods`, `.csv`, `.tsv`)**：多工作表切换、关键词过滤与分页浏览。
- **演示文稿 (`.pptx`, `.odp`)**：逐页展示定位文本框、表格、内嵌图片与演讲者备注。
- **工程与数据文件**：
  - Jupyter Notebooks (`.ipynb`)
  - SQLite 数据库 (`.sqlite`, `.sqlite3`, `.db`) 表浏览与分页查看
  - 压缩包 (`.zip`, `.jar`, `.whl`, `.apk`) 目录浏览
  - 电子书 (`.epub`)、结构化数据 (`.json`, `.jsonl`, `.yaml`, `.toml`, `.xml`)
  - 网页与媒体 (`.md`, `.html`, `.svg`, 常见图片/音视频、`.ttf/.otf/.woff2` 字体) 以及支持 `UTF-8 / GB18030 / UTF-16` 编码识别的语法高亮代码预览。
- **统一缩放与图片平移**：支持 `Ctrl+滚轮` 以及 `Ctrl +` / `Ctrl -` / `Ctrl 0` 快捷键缩放（PDF、DOCX 版式视图、图片/SVG 及通用视图均显示实时缩放百分比）；图片与 SVG 支持以鼠标光标为中心缩放、双击在适应窗口与 `1:1` 间切换以及放大后鼠标拖动平移。
- **系统默认应用打开与定位**：顶栏支持一键调用系统默认程序打开当前文件（快捷键 `Alt+O`，跨 Windows / macOS / Linux，内置可执行程序/脚本后缀安全拦截）以及在文件管理器中定位；无法在线预览的大文件或二进制文件页面同样提供“用系统默认应用打开”入口。
- **会话隔离与防抢占**：MCP `open_document` 目标严格按 `conversationId` 隔离，多会话并行互不串文件；支持锁定当前文件标签页并防止慢加载的异步预览覆盖用户新打开的文件。
- **框选区域批注**：在预览界面按住鼠标框选区域并输入修改说明后，会将文字说明与该区域的 `PNG` 截图一并发给 Agent 处理（框选模式下同样支持 `Ctrl+滚轮` 缩放）。

## 安装依赖

需要 Node.js 18+。

- 若使用仓库根目录的 `install.ps1` 或 `install.sh` 安装，脚本会自动在 `sidecars/doc_viewer` 下执行 `npm install`。
- 若手动复制目录或通过 `plugins.json` 挂载，请手动安装依赖：
  ```bash
  cd ~/.gemini/config/plugins/doc-viewer/sidecars/doc_viewer
  npm install
  ```

## 使用方法

1. **在对话中直接调用**：
   - `“在侧边栏打开当前工作区里的 report.docx”`
   - `“用 Document Viewer 预览 results/metrics.xlsx”`
   - `“把刚生成的 slides.pptx 在侧边栏打开”`
2. **展开预览面板**：
   Agent 调用 `open_document` 后会在回复中附带侧边栏链接（如 `[预览 report.docx](sidecar://doc-viewer/doc_viewer/)`），点击即可打开或聚焦右侧面板。
3. **手动打开文件**：
   也可直接在右侧面板顶部的路径栏输入本地路径，或将文件拖入面板中打开。
