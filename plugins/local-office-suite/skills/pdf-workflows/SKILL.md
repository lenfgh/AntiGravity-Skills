---
name: pdf-workflows
description: Read, create, inspect, fill AcroForms, render, and visually verify PDF files where layout and formatting integrity matter. Uses Poppler (pdftoppm) plus Python reportlab, pdfplumber, and pypdf on D:/E: drives.
---

# PDF Workflows (Create, Inspect, Fill AcroForms & Visually Verify)

## Runtime & Storage Guardrails (Windows)

- **Pre-installed Python with PDF packages (`reportlab`, `pypdf`, `pdfplumber`, `pdf2image`, `Pillow`)**:
  `python`
  Always pass `-B` (or set `$env:PYTHONDONTWRITEBYTECODE = "1"`).
- **Poppler (`pdftoppm`)**: `D:\texlive\2026\bin\windows\pdftoppm.exe`
- **Strict Zero-`C:` Guardrail**: Never write temporary PDFs or rendered PNGs to `C:`. Always place intermediate renders under `<workspace>\_tmp\pdfs\` or `E:\Project\_tmp\pdfs\`, and clean up temporary PNGs when QA is complete.

## Core Workflow

1. **Generate new PDFs** programmatically using `reportlab` (or typst/LaTeX when academic typesetting is requested).
2. **Extract text / inspect structure** using `pdfplumber` or `pypdf` for quick data checks — never rely on text extraction alone to judge visual layout.
3. **Visual QA Gate (Mandatory before delivery)**:
   Render all pages to PNGs via `scripts/render_pdf_pages.py`:
   ```powershell
   $env:PYTHONDONTWRITEBYTECODE = "1"
   python -B `
     "$HOME\.gemini\config\plugins\local-office-suite\skills\pdf-workflows\scripts\render_pdf_pages.py" `
     "E:\path\to\output.pdf" --output_dir "E:\Project\_tmp\pdf_qa"
   ```
   Inspect every generated `page-<N>.png` with `read_file` for clipped text, overlapping elements, broken tables, black squares, or missing CJK glyphs. Iterate until zero visual defects remain, then clean up temporary PNGs.
4. **Side-Pane Interactive Preview**:
   When handing the final PDF to the user, open it in `doc-viewer` (`open_document`) if helpful and surface `[预览 <filename>.pdf](sidecar://doc-viewer/doc_viewer/)` alongside `[<filename>.pdf](file:///...)`.

## Filling & Validating Interactive AcroForms

Visual review alone is **not** sufficient for fillable PDFs: a page `/Widget` annotation can render an appearance stream while the canonical `/AcroForm/Fields` tree is missing or stale.

1. Keep the output interactive by default (`flatten=False` unless the user explicitly asks for a flattened static PDF). Never flatten a digitally signed PDF without explicit user confirmation.
2. Inspect both trees before filling: enumerate `reader.get_fields()` and `/Widget` annotations across every page's `/Annots` (following `/Parent` and `/Kids`). If a widget and a canonical field share a name without a `/Parent` link, do not call `reattach_fields()` blindly — report the ambiguity or produce a static copy.
3. Recover orphaned widgets, fill all pages, and write with `pypdf`:

```python
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject

reader = PdfReader(input_pdf)
writer = PdfWriter()
writer.clone_document_from_reader(reader)

writer.reattach_fields()
fields = writer.get_fields() or {}
missing = set(expected_values) - set(fields)
if missing:
    raise ValueError(f"Form fields not found after repair: {sorted(missing)}")

values_to_write = dict(expected_values)
if flatten:
    values_to_write = {
        name: field.get("/V", "/Off" if field.get("/FT") == "/Btn" else "")
        for name, field in fields.items()
    }
    values_to_write.update(expected_values)

writer.update_page_form_field_values(
    None, values_to_write, auto_regenerate=False, flatten=flatten
)

if flatten:
    writer.remove_annotations(subtypes="/Widget")
    writer.root_object.pop(NameObject("/AcroForm"), None)

with open(output_pdf, "wb") as stream:
    writer.write(stream)
```

4. **Reopen & Verify**:
   - For interactive forms: reopen with `PdfReader`, verify every expected field exists in `get_fields()` with the expected `/V`, verify page widgets agree on effective `/V` and have non-empty `/AP` `/N` appearances, and render pages via `render_pdf_pages.py` to confirm zero clipping.
   - For flattened forms: reopen and verify zero `/Widget` annotations and no `/AcroForm` key remain, then render pages visually.

## Quality Expectations

- Consistent typography, margins, alignment, and section hierarchy.
- Sharp, aligned, clearly labeled charts, tables, and embedded figures.
- Prefer standard ASCII hyphens (`-`) over exotic non-breaking Unicode hyphens (`U+2011`) that cause missing-glyph boxes in standard PDF fonts.
