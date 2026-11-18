---
name: doc-viewer
description: >-
  Preview DOCX, PDF, XLSX/XLS/ODS/CSV, PPTX/ODP, EPUB, ODT, RTF, Markdown,
  Jupyter Notebooks (.ipynb), SQLite databases (.db/.sqlite), ZIP archives,
  images, audio, video, fonts, and code in the Antigravity side pane (Document
  Viewer sidecar). Use when the user asks to open, view, or preview a document
  or binary file in the sidebar/side pane, especially .docx or .pdf files.
---

# Document Viewer

The Document Viewer sidecar renders documents and common workspace files directly inside Antigravity's auxiliary side pane (`sidecar://doc-viewer/doc_viewer/`).

## When to use

- The user asks to open, preview, or view a `.docx`, `.pdf`, `.xlsx`, `.xls`, `.csv`, `.pptx`, `.epub`, `.odt`, `.rtf`, `.ipynb`, `.sqlite`, `.zip`, image, media, or other file in the sidebar / side pane.
- You just created or located a document and want to let the user inspect it directly in the side pane.

## Workflow

1. **Set the target file via MCP tool**:
   Call `open_document` from `doc-viewer_doc_viewer_mcp` (or `doc_viewer_mcp`) with the file's absolute path or workspace-relative path.
2. **Surface the sidecar pill link**:
   Always include the clickable sidecar link in your chat reply so the user can open or focus the side pane in one click:

   ```markdown
   [Document Viewer](sidecar://doc-viewer/doc_viewer/)
   ```

   If you opened a specific file, label the pill clearly with its filename, e.g.:

   ```markdown
   [预览 report.docx](sidecar://doc-viewer/doc_viewer/)
   ```

## Handling batched side-pane requests

When the user sends one or more region-selected requests from Document Viewer (e.g. `Request #1`, `Request #2`, ...) that include `选区截图` paths under `scratch/doc_viewer_clips/*.png`, inspect each referenced PNG image with `read_file` alongside the quoted text before applying edits.

## Supported formats

- **Documents**: `.docx` (Layout + Clean Reader dual mode), `.pdf` (PDF.js with CJK CMaps, text selection, search, outline), `.odt`, `.rtf`, `.doc` (legacy text extraction)
- **Spreadsheets & Tables**: `.xlsx`, `.xls`, `.xlsm`, `.xlsb`, `.ods`, `.csv`, `.tsv`
- **Presentations**: `.pptx`, `.odp`
- **E-Books**: `.epub`
- **Notebooks & Structured Data**: `.ipynb`, `.json`, `.jsonc`, `.jsonl`, `.yaml`, `.yml`, `.toml`, `.xml`
- **Markup & Web**: `.md`, `.markdown`, `.mdx`, `.html`, `.htm`, `.svg`
- **Databases & Archives**: `.sqlite`, `.sqlite3`, `.db`, `.zip`, `.jar`, `.whl`, `.apk`
- **Media & Fonts**: images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.bmp`, `.ico`, `.avif`), audio, video, fonts (`.ttf`, `.otf`, `.woff`, `.woff2`)
- **Code & Plain Text**: source code with syntax highlighting, logs, configs (auto-detecting UTF-8 / GB18030 / UTF-16)
