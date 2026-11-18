---
name: office-modeling-and-style
description: Spreadsheet (.xlsx) workbook architecture (Outputs -> Assumptions -> Builds -> Inputs -> Checks), formula & $-anchoring conventions, Excel COM formula recalculation auditing, and Anti-Slop writing/typography rules across Excel, Word, and PowerPoint.
---

# Office Modeling, Formula Architecture & Anti-Slop Style Guide

Use this skill whenever authoring or reviewing `.xlsx` spreadsheets, financial/research models, data tables, or applying rigorous Anti-Slop editorial and layout standards across Office deliverables.

## Runtime & Storage Guardrails (Windows)

- **Python Runtime (`openpyxl`, `xlsxwriter`, `pandas`, `Pillow`)**:
  `python` (with `openpyxl`, `xlsxwriter`, `pandas`, `Pillow` installed) (`-B` / `$env:PYTHONDONTWRITEBYTECODE = "1"`)
- **Excel COM Formula Recalculation & Error Auditor**:
  `$HOME\.gemini\config\plugins\local-office-suite\skills\office-modeling-and-style\scripts\audit_xlsx_excel_com.ps1`
- **Strict Zero-`C:` Guardrail**: Write all scratch scripts, temporary PDFs, and QA images to `<workspace>\_tmp\` or `E:\Project\_tmp\` on `D:` / `E:`.

---

## 1. Spreadsheet (`.xlsx`) Workbook Architecture

### Keep Focused Workbooks Simple
- Start with **one clear primary tab** (or **two tabs**: `Output` on the left, `Source/Input` on the right when raw imported data must remain untouched) for focused analyses, trackers, budgets vs. actuals, or research measurement logs.
- Do **not** invent empty `Cover`, `ReadMe`, `Dashboard`, `Setup`, and `Checks` tabs around a small table. Add tabs only when distinct schedules, time grains, or reader workflows require them.

### Physical Tab Order vs. Logical Calculation Flow
- **Physical left-to-right tab order** (for multi-tab models):
  **`Outputs / Summary` → `Assumptions` (control panel) → `Builds` (schedules) → `Inputs / Sources` → `Checks / Audit`**
- **Logical calculation flow** (strictly one-way, no unintended cycles):
  **`Inputs/Sources` + `Assumptions` → `Builds` → `Outputs`**
- **Terminal `Checks / Audit` rule**: `Checks` may read `Inputs` and `Builds` to verify tie-outs (e.g. `='Build'!E14-'Source'!D20`), **never** the reverse — no business calculation, assumption, or summary may depend on a `Checks` cell.

---

## 2. Formula & Reference Discipline

1. **Dynamic Formulas, Never Hardcoded Calculated Outputs**:
   - Store raw inputs and editable assumptions in clearly labeled cells; compute totals, ratios, variances, and roll-forwards with live Excel formulas (`SUM`, `SUMPRODUCT`, `SUMIFS`, `COUNTIFS`, `AVERAGEIFS`, `INDEX/MATCH`, `XLOOKUP`, `CHOOSE`).
   - Do **not** pre-compute totals in Python and paste static numbers where formulas belong.
2. **Deliberate `$` Reference Anchoring**:
   - `C8`: relative row & column (moves across and down).
   - `C$4`: fixed period header row (copying across advances period; copying down stays locked to row 4).
   - `$A8`: fixed item/category column (copying down advances item; copying across stays locked to col A).
   - `$B$3`: fixed scalar assumption or active Case selector (`=CHOOSE($B$3, I22, I23)`).
3. **Avoid Modern Opaque Array Formulas by Default**:
   - Do **not** introduce `LET`, `LAMBDA`, `MAP`, `REDUCE`, or dynamic spill arrays in standard deliverables; use transparent intermediate rows and standard `SUMIFS` / `SUMPRODUCT` / `INDEX-MATCH` that human reviewers can audit and extend in any Excel/WPS/Google Sheets version.
4. **Never Mask Errors or Missing Data with Blanket `IFERROR(..., 0)`**:
   - Distinguish a true `0` from missing data or zero-denominator division (`=IF(C8=0, "n.a.", B8/C8)`).
   - Preserve explicit zero overrides (`=IF(C8="", B8, C8)`, **never** `=IF(C8=0, B8, C8)`).

---

## 3. Mandatory Excel COM Formula & Visual Audit

`openpyxl` and `xlsxwriter` write formula strings without evaluating them! Before delivering any `.xlsx` containing formulas, run `scripts/audit_xlsx_excel_com.ps1` to force real Microsoft Excel recalculation (`CalculateFullRebuild()`), detect any `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, `#NUM!`, or `#N/A` errors, and optionally export a PDF for visual layout review:

```powershell
$skill = "$HOME\.gemini\config\plugins\local-office-suite\skills\office-modeling-and-style"
powershell -NoProfile -ExecutionPolicy Bypass -File "$skill\scripts\audit_xlsx_excel_com.ps1" `
  -Path "E:\path\to\model.xlsx" `
  -ExportPdfPath "E:\Project\_tmp\xlsx_qa\model.pdf"
```

If `-ExportPdfPath` is used, rasterize `model.pdf` with `pdf-workflows/scripts/render_pdf_pages.py` and inspect `page-<N>.png` via `read_file` to verify column widths (`###` truncation!), alignment, borders, and page breaks; then clean up `E:\Project\_tmp\xlsx_qa`. Surface `[预览 model.xlsx](sidecar://doc-viewer/doc_viewer/)` when handing back.

---

## 4. Detailed References in This Skill

- **Spreadsheet visual styling, gridlines, freeze panes, typography & number formats**: [style_guidelines.md](style_guidelines.md)
- **Anti-Slop writing rules, slide copy, and table layout standards**: [references/anti_slop_and_writing.md](references/anti_slop_and_writing.md)
- **Slide visual composition rules**: [references/slide_visual_design.md](references/slide_visual_design.md)
- **Domain-specific modeling guides**:
  - [references/financial_models.md](references/financial_models.md)
  - [references/scientific_research.md](references/scientific_research.md)
  - [references/marketing_advertising.md](references/marketing_advertising.md)
  - [references/healthcare.md](references/healthcare.md)
  - [references/charts.md](references/charts.md)
