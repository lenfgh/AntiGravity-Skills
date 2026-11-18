---
name: docx-documents
description: Create, edit, redline (tracked changes), comment on, audit, and visually verify local .docx Word documents using python-docx, 25+ OOXML helper scripts, and render_docx.py (MS Word COM / LibreOffice + Poppler PNG QA).
---

# DOCX Skill (Read, Create, Edit, Redline, Comment & Visually Verify)

## Runtime & Storage Guardrails (Windows)

- **Authoritative Python Runtime (`python-docx`, `lxml`, `pdf2image`, `Pillow`, `openpyxl`)**:
  `python`
  Always invoke with `-B` (or `$env:PYTHONDONTWRITEBYTECODE = "1"`).
- **Node Runtime (`docx`, `sharp`, `mathjax-full` if needed)**:
  `node`
- **Strict Zero-`C:` Guardrail**: Never write scratch scripts, intermediate `.docx`, or rendered `page-<N>.png` files to `C:`. Always put QA renders in `<workspace>\_tmp\docx_qa\` or `E:\Project\_tmp\docx_qa\`, and clean up temporary PNGs once visual QA passes.
- **Skill Root**: `$HOME\.gemini\config\plugins\local-office-suite\skills\docx-documents`

## Mandatory Render-and-Verify Loop

**You do not know a `.docx` is satisfactory until you render it and visually inspect every page PNG.**
Text extraction or raw XML reading misses clipping, overlapping elements, missing CJK glyphs, broken tables, awkward page breaks, and header/footer drift.

1. **Author or edit** using `python-docx` and/or the bundled OOXML scripts in `scripts/`.
2. **Render to page PNGs** (uses MS Word COM -> PDF -> Poppler `pdftoppm` automatically on Windows when `soffice` is absent):
   ```powershell
   $env:PYTHONDONTWRITEBYTECODE = "1"
   python -B `
     "$HOME\.gemini\config\plugins\local-office-suite\skills\docx-documents\render_docx.py" `
     "E:\path\to\draft.docx" --output_dir "E:\Project\_tmp\docx_qa"
   ```
3. **Inspect every `page-<N>.png`** using `read_file`. Fix layout, spacing, table widths, or font issues and re-render until every page is clean.
4. **Deliver cleanly**: Delete temporary QA PNGs/folders, deliver the final `.docx` with a clickable `[filename.docx](file:///...)` link, and optionally open it in `doc-viewer` (`[预览 filename.docx](sidecar://doc-viewer/doc_viewer/)`). If the user wants a native Google Doc, either use `gdocs` directly or run `scripts/google_docs_title_sanitize.py` before uploading via `gdrive`.

## Document Design & Editorial Standards

1. **Titles & Opening**:
   - State the specific subject and purpose plainly (no slogans, no trailing punctuation in titles/headings).
   - Use Word's `Title` style in black (`#000000`) with **no** bottom border or decorative horizontal line beneath it.
   - Lead the opening paragraph with the main conclusion, decision, or task so the reader immediately knows what changed and why it matters.
   - For anti-slop writing rules, read [writing_quality.md](writing_quality.md) (or the `office-modeling-and-style` skill).
2. **Page & Typography Defaults** (unless overridden by user or template):
   - Default page size: Letter (`8.5 x 11` in, Portrait) or A4 if Chinese administrative/academic context specifies it.
   - Body prose: `11-12 pt` readable font; for bilingual Chinese/English documents, explicitly set both Latin (`Times New Roman` / `Calibri`) and East Asian (`w:eastAsia` = `SimSun` / `Microsoft YaHei`) fonts on styles/runs.
3. **Tables**:
   - Set intentional column widths proportional to content (compact for IDs/dates/status; wider for descriptions) — never leave default equal-width columns when content lengths differ.
   - Light gray borders (`#D9D9D9`), deliberate header shading (light gray/pale blue with black text, or dark blue/gray with white text), generous cell padding, vertical centering, and never fixed row heights that clip wrapped text.
   - Mark header rows with `w:tblHeader` when tables may span pages.
4. **Editing Existing Documents**:
   - Preserve original structure and make surgical local edits rather than rewriting the whole file.
   - When redlining or commenting is requested, use `scripts/add_tracked_replacements.py` (`<w:del>` + `<w:ins>`) and `scripts/comments_add.py` rather than destructive overwrites.
   - When following a reference template `.docx`, read [template-distill.md](template-distill.md) and [template-create.md](template-create.md).

## Equations

Never leave raw LaTeX strings in a delivered `.docx`. Prefer native Word OMML (`<m:oMath>` / `<m:oMathPara>`) when editable math is needed or already used in the source document; otherwise render high-DPI (300 DPI) PNG equations and verify sizing/clarity via `render_docx.py`.

## Bundled Scripts & Playbooks Index

All paths below are relative to `$HOME\.gemini\config\plugins\local-office-suite\skills\docx-documents\`:

### Core & Visual QA
- `render_docx.py` — DOCX -> PDF -> `page-<N>.png` renderer (`--output_dir`, `--emit_pdf`, `--dpi`, `--verbose`).
- `scripts/render_and_diff.py` — Render two DOCXs and produce per-page visual diffs (`tasks/compare_diff.md`).
- `scripts/docx_ooxml_patch.py` — Low-level OOXML helper for tracked changes, comments, hyperlinks, and relationships.

### Tracked Changes & Comments (`ooxml/tracked_changes.md`, `ooxml/comments.md`)
- `scripts/add_tracked_replacements.py` — Insert `<w:del>` + `<w:ins>` redlines in-place (`tasks/clean_tracked_changes.md`).
- `scripts/accept_tracked_changes.py` — Accept/clean tracked changes for final delivery.
- `scripts/comments_add.py`, `scripts/comments_extract.py`, `scripts/comments_apply_patch.py`, `scripts/comments_strip.py` (`tasks/comments_manage.md`).

### Structure, Styles, TOC & Cross-References
- `scripts/style_lint.py`, `scripts/style_normalize.py`, `scripts/apply_template_styles.py` (`tasks/style_lint_normalize.md`, `tasks/templates_style_packs.md`).
- `scripts/heading_audit.py`, `scripts/section_audit.py` (`tasks/headings_numbering.md`, `tasks/sections_layout.md`).
- `scripts/insert_toc.py`, `scripts/internal_nav.py` (`tasks/toc_workflow.md`, `tasks/navigation_internal_links.md`).
- `scripts/captions_and_crossrefs.py`, `scripts/insert_ref_fields.py`, `scripts/fields_materialize.py`, `scripts/flatten_ref_fields.py`, `scripts/fields_report.py` (`tasks/captions_crossrefs.md`, `tasks/fields_update.md`).
- `scripts/insert_note.py`, `scripts/footnotes_report.py` (`tasks/footnotes_endnotes.md`).

### Tables, Forms, Accessibility & Privacy
- `scripts/xlsx_to_docx_table.py`, `scripts/docx_table_to_csv.py` (`tasks/tables_spreadsheets.md`).
- `scripts/content_controls.py`, `scripts/set_protection.py` (`tasks/forms_content_controls.md`, `tasks/protection_restrict_editing.md`).
- `scripts/a11y_audit.py`, `scripts/images_audit.py` (`tasks/accessibility_a11y.md`, `tasks/images_figures.md`).
- `scripts/redact_docx.py`, `scripts/privacy_scrub.py`, `scripts/watermark_add.py`, `scripts/watermark_audit_remove.py` (`tasks/redaction_anonymization.md`, `tasks/privacy_scrub_metadata.md`, `tasks/watermarks_background.md`).
- `scripts/merge_docx_append.py` (`tasks/multi_doc_merge.md`), `scripts/google_docs_title_sanitize.py`.
