---
name: pptx
description: "Use this skill any time a .pptx or .potx file is involved in any way — as input, output, or both. This includes: creating slide decks, pitch decks, academic/technical presentations; reading, parsing, or extracting text from any .pptx or .potx file; editing, modifying, or updating existing presentations; combining or splitting slide files; working with templates (.potx), layouts, speaker notes, or comments. Trigger whenever the user mentions \"deck,\" \"slides,\" \"PPT,\" \"presentation,\" or references a .pptx or .potx filename."
license: Complete terms in LICENSE.txt
---

# PPTX Creation, Editing, and Analysis (`anthropics/skills` Official + Windows COM QA)

A `.pptx` is a ZIP archive of XML files. Choose your approach by task:

| Task | Approach |
|---|---|
| **Create** a new deck | Write a `pptxgenjs` script — see gotchas below — and build it as a [structured deck](#structured-decks) unless the user asks for a quick throwaway |
| **Edit** an existing deck, or build from a template | `pack_pptx.py unpack` → `add_slide.py` / edit `ppt/slides/slideN.xml` → `clean.py` → `pack_pptx.py pack` |
| **Read** content | `& $py -B "$skill\scripts\slide_text.py" deck.pptx` (one block per slide under `<!-- Slide number: N -->` markers); visual grid: `& $py -B "$skill\scripts\thumbnail.py" deck.pptx E:\Project\_tmp\thumbs` |

## Windows Runtime & Storage Guardrails (Preinstalled on `D:`)

- **Skill Directory (`$skill`)**: `$HOME\.gemini\config\plugins\local-office-suite\skills\pptx`
- **Node Runtime & `NODE_PATH` (`pptxgenjs`, `sharp`, `lucide` preinstalled — do NOT run `npm install`)**:
  ```powershell
  $node = "node"  # Ensure pptxgenjs, sharp, and lucide are installed globally or in NODE_PATH
  ```
- **Python Runtime (`python-pptx`, `lxml`, `Pillow` + vendored `defusedxml`)**:
  ```powershell
  $env:PYTHONDONTWRITEBYTECODE = "1"
  $py = "python"
  ```
- **Strict Zero-`C:` Guardrail**: NEVER write generator `.js` scripts, unpacked folders, thumbnails, or rendered QA images onto `C:`. Place all temporary build/QA files in `<workspace>\_tmp\pptx_work\` or `E:\Project\_tmp\pptx_work\`, and clean them up when done.

## Scripts

Paths below are relative to `$skill` (`$HOME\.gemini\config\plugins\local-office-suite\skills\pptx`):

| Script | What it does |
|---|---|
| `scripts/slide_text.py deck.pptx` | Every slide's title, text, tables, chart data, picture alt text and speaker notes, as markdown. Reads `.potx` too |
| `scripts/thumbnail.py deck.pptx E:\Project\_tmp\deck-thumbs` | Labeled grid of every slide (`slide1.xml`, etc.), for picking template layouts (uses MS PowerPoint COM / `soffice` + Poppler `pdftoppm`). Always pass an output prefix on `D:`/`E:` |
| `scripts/pack_pptx.py unpack in.pptx E:\Project\_tmp\unpacked` / `pack ... out.pptx` | Cross-platform Windows-safe unpack & rezip (`[Content_Types].xml` first, zero folder entries) |
| `scripts/add_slide.py unpacked/ slide2.xml [--after slideN.xml]` | Duplicate a slide (or `slideLayoutN.xml`) with all package bookkeeping. Also takes a `.pptx` directly with `-o out.pptx` |
| `scripts/clean.py unpacked/` | Delete slides, media, and rels no longer referenced. Run **after** `<p:sldIdLst>` is final |
| `scripts/apply_theme.js` | Node module: `const { applyTheme } = require("<$skill>/scripts/apply_theme.js")`. `await applyTheme("deck.pptx", THEME)` after `pres.writeFile()` writes `THEME`'s colors and name into `ppt/theme/theme1.xml` |
| `scripts/lucide_icon.js` | Node module: `const { iconDataUri } = require("<$skill>/scripts/lucide_icon.js")`. Renders any PascalCase `lucide` icon (`"Rocket"`, `"Cpu"`, `"BarChart3"`, `"CheckCircle2"`, etc.) via `sharp` at ≥256px to `"image/png;base64,..."` for `slide.addImage({ data })` |
| `scripts/office/validate.py deck.pptx [--original src.pptx]` | Full OOXML XSD Schema (`ISO-IEC29500-4_2016`), relationship, content-type, chart and slide checks; each failure names its fix |
| `scripts/render_powerpoint.ps1 -Path deck.pptx -OutputDirectory E:\Project\_tmp\qa_slides` | Native Windows **Microsoft PowerPoint COM** QA: checks exact `TextFrame2.TextRange.BoundWidth`/`BoundHeight` text overflow across shapes/groups/tables AND exports every slide to `1280x720` PNG with 100% real Office font fidelity |
| `scripts/office/soffice.py --headless --convert-to pdf --outdir E:\Project\_tmp deck.pptx` | Conversion wrapper (uses `soffice` if present, otherwise native Windows PowerPoint/Word COM) |

## Creating with pptxgenjs — gotchas

`pptxgenjs` is preinstalled in `$env:NODE_PATH` — do not run `npm install` first; set `$env:NODE_PATH` and `require('pptxgenjs')` directly. These are the critical footguns:

- **Set `pres.layout` before adding slides.** The default canvas is `LAYOUT_16x9` = **10" × 5.625"**, not 13.3" wide. Coordinates past the edge are written, not clamped — the shape just isn't on the slide. (`LAYOUT_WIDE` is 13.3" × 7.5".)
- **Hex colors: never `#`, never 8 digits.** `color: "FF0000"`. Both `"#FF0000"` and alpha baked into the hex (`"00000020"`) **corrupt the file**. For translucency: `transparency: 0-100` on fills and images, `opacity: 0.0-1.0` on shadows — each is silently ignored on the other.
- **pptxgenjs mutates option objects in place** (converts values to EMU on first use). Never share one `shadow`/options object across two `add*` calls — build a fresh object each time (e.g. `const makeShadow = () => ({ type: "outer", ... })`).
- **Shadow `offset` must be ≥ 0** — a negative offset corrupts the file. To cast a shadow upward, use `angle: 270` with a positive offset.
- **`letterSpacing` is silently ignored** — the real option is `charSpacing`.
- **Lists:** `bullet: true` on each item, never a literal `•` (renders double bullets). Set `breakLine: true` on every array item except the last. Space bulleted paragraphs with `paraSpaceAfter`, not `lineSpacing` (huge gaps).
- **One `new pptxgen()` per output file** — never reuse an instance.
- **`rectRadius` only works on `ROUNDED_RECTANGLE`**, not `RECTANGLE`.
- **Gradient fills aren't supported** — use a gradient image as the background instead.
- **Every `addText` call without a `placeholder` needs `isTextBox: true`** — without it the shape lacks `txBox="1"`, so screen readers announce the text as a "graphic" instead of a text box.
- **Text boxes have built-in internal padding** — set `margin: 0` whenever text must align with a shape, line, or icon at the same x.
- **Speaker notes go in `slide.addNotes("...")`** (plain text, once per slide), never in a text box on the slide.
- **Keep charts native.** Use `addChart()` for everything PowerPoint can chart (pass an array of `{type, data, options}` for combos). Only chart types PowerPoint has no native form for (Sankey, network, chord) go in as images.
- **Default charts render bare** — no title, no data labels, dated palette. Set `showTitle` + `title`, `showValue: true` + `dataLabelPosition`, `chartColors: [...]` from your palette, and quiet the frame (`catAxisLabelColor`/`valAxisLabelColor`, `valGridLine: { color, size }`, `catGridLine: { style: "none" }`, `showLegend: false` for a single series).
- **On a stacked bar or column chart, `dataLabelPosition` must be `ctr`, `inEnd`, or `inBase`.** `outEnd` **corrupts the file**.
- **A combo series using `secondaryValAxis`/`secondaryCatAxis` needs both `valAxes` and `catAxes` on the chart options, two entries each.** Without them pptxgenjs writes axis *ids* it never declares, and PowerPoint **discards that chart** and reports the file as corrupt.
- **After `writeFile()`, always run `validate.py` (`& $py -B "$skill\scripts\office\validate.py" deck.pptx`).** Fix any reported chart/XML faults in your generator and rebuild.
- **Never reorder the children of `<p:presentation>`.**
- **Icons:** use the bundled `lucide_icon.js` helper (`const { iconDataUri } = require(".../scripts/lucide_icon.js"); const img = await iconDataUri("Layers", { color: "#FFFFFF", size: 256 }); slide.addImage({ data: img, x, y, w, h });`).
- **`defineSlideMaster()` creates a slide *layout*, not a master** — call them layouts when talking to the user.
- **`pres.company` and a `defineSlideMaster()` `title` are written into the XML unescaped** — write `&amp;` instead of raw `&` there and in the matching `masterName`.

### Structured decks

Build every new deck on a theme, layouts, placeholders and sections unless the user asks for a quick throwaway:

1. **Theme first:** `const THEME = { name, headFontFace, bodyFontFace, colors: { dk1, lt1, dk2, lt2, accent1 … accent6, hlink, folHlink } }`, colors in 6-digit hex without `#`. `pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace }`. On chart text (which defaults to Arial), pass `"+mn-lt"` (theme body font) or `"+mj-lt"` (heading font).
2. **`const C = pres.SchemeColor` for every color** — `C.text1`/`C.text2` are `dk1`/`dk2`, `C.background1`/`C.background2` are `lt1`/`lt2`. Options that take hex only (`valGridLine.color`, `catGridLine.color`, `shadow.color`, and on a one-series bar chart `invertedColors` or `chartColors`) must receive 6-digit hex from `THEME.colors`.
3. **Sections:** `pres.addSection({ title })` just before that section's first slide, then `sectionTitle` on every `addSlide`.
4. **One layout per slide frame** (`defineSlideMaster()`): title, section divider, title only, chart + commentary, table; dark and light variants if the design alternates. Footer text, logo and `slideNumber` go on the layout, never repeated per slide.
5. **Fill by name:** `addSlide({ masterName, sectionTitle })`, then `addText("…", { placeholder: "title" })`. Remember `addImage({ placeholder })` needs explicit `w`/`h`, and `addTable({ placeholder })` needs explicit `w` (and `x`, `y`, `autoPageSlideStartY` when auto-paging).
6. **Write, then apply the theme:** `await pres.writeFile({ fileName: outPath })`, then `await applyTheme(outPath, THEME)`.

## Editing existing decks and templates

Pick layouts first with `thumbnail.py` and `slide_text.py`, then unpack on `D:`/`E:`, do all structural additions/deletions before content edits, clean orphans, pack, and validate against `--original`:

```powershell
& $py -B "$skill\scripts\thumbnail.py" template.pptx "E:\Project\_tmp\tpl-thumbs"
& $py -B "$skill\scripts\pack_pptx.py" unpack template.pptx "E:\Project\_tmp\unpacked"
& $py -B "$skill\scripts\add_slide.py" "E:\Project\_tmp\unpacked" slide2.xml --after slide2.xml
# reorder / delete slides in ppt/presentation.xml (<p:sldIdLst>), then:
& $py -B "$skill\scripts\clean.py" "E:\Project\_tmp\unpacked"
# edit slide content in ppt/slides/slideN.xml (use defusedxml.minidom, NEVER ElementTree!)
& $py -B "$skill\scripts\pack_pptx.py" pack "E:\Project\_tmp\unpacked" "E:\path\to\out.pptx"
& $py -B "$skill\scripts\office\validate.py" "E:\path\to\out.pptx" --original template.pptx
```

- **Do all structural work — add, delete, reorder — before editing any slide's content.**
- **Parse slide XML with `defusedxml.minidom`** — round-tripping OOXML through `xml.etree.ElementTree` rewrites namespace prefixes and corrupts the deck.
- **Template slots ≠ source items.** Delete unused template card groups whole (image + shapes + text), not just their text, and delete `<p:timing>` if you removed an animated shape.
- One `<a:p>` per list item; text with leading/trailing spaces needs `xml:space="preserve"` on `<a:t>`.

## Deck Design & Anti-Slop Rules

**Don't create boring or AI-slop slides.**

### Color Palettes & Contrast
- **Pick a bold, content-informed color palette** (60-70% dominant color, 1-2 supporting tones, 1 sharp accent; dark/light "sandwich" contrast for title + conclusion vs. content slides, or cohesive dark/clean white throughout):

| Theme | Primary | Secondary | Accent |
|---|---|---|---|
| **Midnight Executive** | `1E2761` (navy) | `CADCFC` (ice blue) | `FFFFFF` (white) |
| **Forest & Moss** | `2C5F2D` (forest) | `97BC62` (moss) | `F5F5F5` (cream) |
| **Coral Energy** | `F96167` (coral) | `F9E795` (gold) | `2F3C7E` (navy) |
| **Warm Terracotta** | `B85042` (terracotta) | `E7E8D1` (sand) | `A7BEAE` (sage) |
| **Ocean Gradient** | `065A82` (deep blue) | `1C7293` (teal) | `21295C` (midnight) |
| **Charcoal Minimal** | `36454F` (charcoal) | `F2F2F2` (off-white) | `212121` (black) |
| **Teal Trust** | `028090` (teal) | `00A896` (seafoam) | `02C39A` (mint) |
| **Berry & Cream** | `6D2E46` (berry) | `A26769` (dusty rose) | `ECE2D0` (cream) |
| **Sage Calm** | `84B59F` (sage) | `69A297` (eucalyptus) | `50808E` (slate) |
| **Cherry Bold** | `990011` (cherry) | `FCF6F5` (off-white) | `2F3C7E` (navy) |

### Typography & Spacing
- **Fonts**: Because visual QA on this Windows machine renders via native **Microsoft PowerPoint COM**, any installed Windows/Office font renders at exact true-to-life width! Prefer crisp pairings such as **Cambria / Georgia / Times New Roman** headers with **Calibri / Arial / Microsoft YaHei (微软雅黑)** body text; avoid defaulting to `Aptos` for cross-machine compatibility.
- **Sizes**: Slide title `36-44pt` bold; Section header `20-24pt` bold; Body text `14-16pt` (never shrink below `14pt` — cut words or split slides instead); Captions `10-12pt` muted.
- **Spacing**: Minimum `0.5"` slide margins, consistent `0.3"-0.5"` gaps between blocks.

### Avoid (Hallmarks of AI-Generated Slides)
- **NEVER use accent lines under titles** — use whitespace or background contrast instead.
- **NEVER add decorative color bars or edge stripes** (header/footer full-width bars, vertical sidebar stripes, or single-side colored borders on cards). Set cards apart with subtle background tints, clean borders, shadows, or icons in colored circles.
- **Don't repeat the same layout on every slide** — vary two-column, icon + text rows, 2x2 grids, large stat callouts (`60-72pt`), comparison columns, and native charts.
- **Don't center body text** (left-align paragraphs/lists), **don't end slide titles with a period**, and eliminate AI-slop copy (`"It's not X, it's Y"`, em-dashes, vague buzzwords — see `office-modeling-and-style` skill).

## Mandatory 3-Step QA Before Delivery

1. **Content QA**:
   ```powershell
   & $py -B "$skill\scripts\slide_text.py" "E:\path\to\output.pptx"
   ```
   Verify zero leftover template placeholders (`lorem`, `TODO`, `XXX`, `[insert...]`), typos, or wrong slide order.
2. **OOXML Schema & Package QA**:
   ```powershell
   & $py -B "$skill\scripts\office\validate.py" "E:\path\to\output.pptx"
   # (add --original template.pptx when derived from a template)
   ```
3. **Real PowerPoint COM Overflow + Visual PNG QA**:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "$skill\scripts\render_powerpoint.ps1" `
     -Path "E:\path\to\output.pptx" `
     -OutputDirectory "E:\Project\_tmp\pptx_qa_run1"
   ```
   Inspect the JSON output (`text_overflow_count` should be `0`) AND inspect every exported slide PNG (`幻灯片1.PNG` / `Slide1.PNG`, etc.) with `read_file` for overlaps, text cutoff, contrast, alignment, and chart legibility. Fix and re-render into a fresh directory until clean, delete temporary `_tmp` preview folders, and hand back `[output.pptx](file:///...)` + `[预览 output.pptx](sidecar://doc-viewer/doc_viewer/)`.
