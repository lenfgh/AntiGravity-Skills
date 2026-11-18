# Local Office Suite (`local-office-suite`)

本地 `.pptx`、`.docx`、`.xlsx` 与 `.pdf` 文档生成、编辑与校验技能集合。除文档生成外，配套了 OOXML Schema 校验、Excel COM 公式重算检查以及导出逐页图片（PNG）检查排版的脚本流程。

## 包含的子技能

| 技能目录 | 适用任务 | 主要脚本 |
| :--- | :--- | :--- |
| `skills/pptx` | 使用 `PptxGenJS` 新建带主题与原生图表的演示文稿；解包修改存量 `.pptx/.potx`；执行 OOXML XSD 校验与页面文本溢出检查 | `apply_theme.js`, `lucide_icon.js`, `pack_pptx.py`, `add_slide.py`, `clean.py`, `slide_text.py`, `thumbnail.py`, `office/validate.py`, `render_powerpoint.ps1` |
| `skills/docx-documents` | 本地 Word 文档生成、模板样式应用、修订留痕（`<w:ins>`/`<w:del>`）、批注读写、目录与交叉引用、脱敏处理及逐页渲染检查 | `render_docx.py` 及 `scripts/` 下 25+ 个 OOXML 处理脚本（`add_tracked_replacements.py`, `comments_add.py`, `style_lint.py`, `insert_toc.py` 等） |
| `skills/office-modeling-and-style` | 电子表格工作簿结构（`Outputs -> Assumptions -> Builds -> Inputs -> Checks`）、动态公式与 `$` 锚定规范、Excel COM 公式重算报错检查及跨文档排版写作准则 | `scripts/audit_xlsx_excel_com.ps1`, `style_guidelines.md`, `references/anti_slop_and_writing.md` |
| `skills/pdf-workflows` | 使用 `reportlab` 生成 PDF、使用 `pypdf` 检查/修复/填写交互式 AcroForm 表单，并通过 Poppler 渲染逐页图片检查版面 | `scripts/render_pdf_pages.py` |

## 环境依赖

1. **Python 3.10+**：
   ```bash
   pip install python-docx python-pptx openpyxl xlsxwriter reportlab pypdf pdfplumber pdf2image Pillow lxml
   ```
2. **Node.js 18+（用于 `pptx` 生成与 `lucide` 图标渲染）**：
   ```bash
   npm install -g pptxgenjs sharp lucide
   # 若安装在非全局目录，可将 NODE_PATH 指向对应的 node_modules
   ```
3. **渲染与转换工具**：
   - **Poppler (`pdftoppm`)**：用于将 PDF 转为逐页 PNG 供视觉检查（Windows 可通过 `winget install oschwartz10612.Poppler`、Conda 或 TeXLive 安装；macOS `brew install poppler`；Linux `apt install poppler-utils`；也可通过环境变量 `POPPLER_PATH` 指定路径）。
   - **LibreOffice (`soffice`) 或 Microsoft Office（Windows）**：跨平台可使用 LibreOffice 转 PDF；Windows 环境下若安装了桌面版 Office，脚本支持自动调用 Word / PowerPoint / Excel COM 接口完成高保真导出、溢出检测与公式重算。

## 使用示例

### 1. 生成与校验 PPTX（`pptx`）
可在对话中要求：
> `“阅读 docs/summary.md，用 pptx skill 生成一份 8 页项目汇报 deck.pptx，定义配色主题和母版，包含原生柱状对比图，生成后运行 validate.py 校验并导出图片检查是否有文字溢出。”`

常用命令行脚本：
```powershell
$skill = "$HOME\.gemini\config\plugins\local-office-suite\skills\pptx"
# 提取现有 PPTX 文本与备注结构
python -B "$skill\scripts\slide_text.py" deck.pptx
# 运行 ISO OOXML XSD Schema 与关系校验
python -B "$skill\scripts\office\validate.py" deck.pptx
# Windows PowerPoint COM 溢出检查与幻灯片 PNG 导出
powershell -NoProfile -ExecutionPolicy Bypass -File "$skill\scripts\render_powerpoint.ps1" -Path deck.pptx -OutputDirectory E:\Project\_tmp\pptx_qa
```

### 2. 编辑、修订批注与渲染检查 DOCX（`docx-documents`）
可在对话中要求：
> `“用 docx-documents 的修订模式（Tracked Changes）修改 draft.docx 的第三节措辞，在改动处添加批注说明原因，并用 render_docx.py 渲染页面图片确认版式正常。”`

常用渲染检查命令：
```powershell
python -B "$HOME\.gemini\config\plugins\local-office-suite\skills\docx-documents\render_docx.py" `
  "E:\path\to\draft.docx" --output_dir "E:\Project\_tmp\docx_qa"
```

### 3. 构建动态公式表格与 Excel COM 报错审计（`office-modeling-and-style`）
可在对话中要求：
> `“按 Outputs -> Assumptions -> Builds -> Inputs -> Checks 结构创建模型表 model.xlsx，汇总项全部使用动态公式并设置 $ 引用锚定，完成后运行 audit_xlsx_excel_com.ps1 检查重算结果。”`

常用审计命令（Windows 需安装 Excel）：
```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File "$HOME\.gemini\config\plugins\local-office-suite\skills\office-modeling-and-style\scripts\audit_xlsx_excel_com.ps1" `
  -Path "E:\path\to\model.xlsx" -ExportPdfPath "E:\Project\_tmp\xlsx_qa\model.pdf"
```

### 4. 填写交互式 PDF 表单与页面检查（`pdf-workflows`）
可在对话中要求：
> `“检查 form.pdf 的交互表单域并填入信息，保持可编辑状态不要压平，完成后重开校验字段值并用 render_pdf_pages.py 渲染检查是否有文字截断。”`
