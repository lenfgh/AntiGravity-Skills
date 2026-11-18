# Local Office Suite (`local-office-suite`)

面向本地高质量办公文档生产与**渲染级视觉闭环质检（Render-and-Verify QA）**的旗舰技能包，内含 **4 个深度协同的 Skills**，覆盖 `.pptx`、`.docx`、`.xlsx` 与 `.pdf` 的从零生成、存量模板编辑、修订批注、真 Excel 公式重算排错及逐页 PNG 视觉核验。

## 🧩 包含的四大子技能

| Skill 名称 | 适用场景与核心能力 | 关键随附工具脚本 |
| :--- | :--- | :--- |
| **`pptx`** | 用 `PptxGenJS` 构建带统一配色主题、母版版式与原生图表的演示文稿；或解包存量 `.pptx/.potx` 增删复用页面、通过 ISO OOXML XSD Schema 校验并做溢出检测 | `apply_theme.js`, `lucide_icon.js`, `pack_pptx.py`, `add_slide.py`, `clean.py`, `slide_text.py`, `thumbnail.py`, `office/validate.py`, `render_powerpoint.ps1` |
| **`docx-documents`** | 本地 Word 文档撰写、模板蒸馏、非破坏性修订留痕（`<w:ins>`/`<w:del>`）、批注管理、目录与交叉引用、脱敏涂黑、无障碍审计与逐页 PNG 视觉验收 | `render_docx.py` + `scripts/` 下 **25+ 个 OOXML 专用工具**（`add_tracked_replacements.py`, `comments_add.py`, `style_lint.py`, `insert_toc.py` 等） |
| **`office-modeling-and-style`** | 专业电子表格架构（`Outputs → Assumptions → Builds → Inputs → Checks`）、动态公式与 `$` 锚定纪律、Windows Excel COM 真实公式重算报错扫描，以及跨文档 Anti-Slop 写作排版准则 | `scripts/audit_xlsx_excel_com.ps1`, `style_guidelines.md`, `references/anti_slop_and_writing.md` 及金融/科研/医疗领域建模指南 |
| **`pdf-workflows`** | 基于 `reportlab` 生成高排版质量 PDF，基于 `pypdf` 修复并填写交互式 AcroForm 表单（含 `/Widget` 与 `/AcroForm` 双树核验），并用 Poppler 栅格化逐页验版 | `scripts/render_pdf_pages.py` |

## 🛠️ 环境依赖准备

1. **Python 3.10+ 依赖**：
   ```bash
   pip install python-docx python-pptx openpyxl xlsxwriter reportlab pypdf pdfplumber pdf2image Pillow lxml
   ```
2. **Node.js 18+ 依赖（供 `pptx` 生成器与矢量图标渲染使用）**：
   ```bash
   npm install -g pptxgenjs sharp lucide
   # 若安装在自定义目录，请设置环境变量 NODE_PATH 指向对应 node_modules
   ```
3. **PDF / Office 渲染后端**：
   - **Poppler (`pdftoppm`)**：用于将导出的 PDF 转为逐页高清 PNG 供 Agent 视觉自检（Windows 可通过 `winget install oschwartz10612.Poppler`、Conda 或 TeXLive 安装；macOS `brew install poppler`；Linux `apt install poppler-utils`）。
   - **Office 转 PDF 引擎**：安装 **LibreOffice (`soffice`)**（跨平台）或 **Microsoft Office 桌面版**（Windows 原生支持 `Word.Application` / `PowerPoint.Application` / `Excel.Application` COM 自动化，100% 还原中英文字体与真实文本溢出检测）。

## 🚀 典型提问示例

- **生成汇报 PPTX**：`“阅读本项目的实验总结，用 pptx skill 做一份 10 页深色学术风汇报 PPTX，包含原生对比柱状图和架构流程页，做完后跑 XSD 校验和页面渲染自检。”`
- **Word 修订留痕（Redline）**：`“在 contract_v1.docx 上用修订模式（Tracked Changes）把违约金条款改为 5%，并在旁边插入一条批注说明原因，渲染成图片确认版式没乱。”`
- **Excel 动态公式建模**：`“按 Outputs-Assumptions-Builds 架构创建一个算力成本测算表 budget.xlsx，所有汇总必须用动态公式，并用 Excel COM 脚本做重算零报错审计。”`
- **交互式 PDF 表单填写**：`“检查 application_form.pdf 的所有交互表单字段并填入申请信息，保持表单可编辑状态并渲染核验没有文字截断。”`
