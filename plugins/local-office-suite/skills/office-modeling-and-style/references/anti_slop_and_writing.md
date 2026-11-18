# Anti-Slop Writing, Slide Copy & Table Typography Reference

Distilled from Codex's `presentations`, `documents`, and `spreadsheets` editorial frameworks. Apply these rules across all `.docx`, `.pptx`, `.xlsx`, and `.pdf` deliverables unless explicitly overridden by user instructions.

---

## 1. Core Editorial Principles

1. **Lead with the conclusion, decision, or concrete finding**: State what changed, why it matters, and what evidence, denominator, or constraint supports it. Never bury the point behind throat-clearing introductions (`"In today's fast-paced landscape..."`).
2. **Preserve precision & uncertainty**: Keep numbers attached to their **units, baseline, denominator, and time period**. Distinguish observed facts, static inspections, interpretations, and recommendations. Never turn `"may"` into `"will"`, or `"79% of pre-pandemic level"` into `"+79% growth"`.
3. **Never leak agent meta-commentary into deliverables**: Never write `"This report uses only supplied findings"`, `"Executive-friendly summary"`, or internal file paths/tool tokens inside the document, slide, speaker notes, or spreadsheet cells.

---

## 2. Seven High-Frequency "AI Slop" Patterns to Eliminate

| Pattern | Bad Example (Avoid) | Clean Human Rewrite |
| :--- | :--- | :--- |
| **1. Negative Contrast ("It's not X, it's Y")** | `"Data access isn't a background detail — it's the heart of UX."` | `"Fast, reliable data access directly determines user retention."` |
| **2. Decorative Punctuation (Em-dashes, ASCII dots, bars, arrows in prose/slides)** | `"Strategy \| Execution \| Impact"` or `"Jobs fell 38%—ending below baseline."` | Use plain sentences or separate visual elements; avoid em-dashes (`—`), semicolons (`;`), and bullet-dot chains (`•`) in slide copy. |
| **3. Slogan & Buzzword Inflation** | `"Catalyzing Transformative Excellence"` / `"Unlocking synergistic value"` | `"2026 Cost Reduction Plan"` / `"Shared tooling cut build time by 18%"` |
| **4. Formulaic Three-Part Lists (Triads)** | `"Teams listen, map services, and document gaps."` | Explain how the actions actually connect, or state the specific outcome without padding to three items. |
| **5. Imperative Slide Titles** | `"Define the integration perimeter before designing the workplan"` | `"Integration Perimeter and Workplan Dependencies"` (plain subject noun phrase) or a factual finding supported by the slide. |
| **6. Vague / Compressed Compound Labels** | `"Approval-ready evidence pack"`, `"Value-led shopping"`, `"Scalable spans and layers"` | `"Evidence required for approval"`, `"Focus on price and value"`, `"Streamlined management structure"` |
| **7. Mechanical Bold-Lead Bullets Everywhere** | Every single paragraph formatted as `- **Label:** generic explanation...` | Use connected prose paragraphs for explanations in Word docs; reserve lists for genuinely parallel, scannable items. |

---

## 3. Cross-Format Table & Layout Discipline

- **Intentional Column Widths**: Never leave tables with default equal-width columns when content lengths vary. Keep ID, year, unit, status, and metric columns compact; allocate width to descriptive or formula-explanation columns.
- **No Text Clipping**: Never set fixed row heights that truncate wrapped text. Prefer (in order): wrap text -> widen column / adjust padding -> tighten wording -> split across slides/pages with repeated headers (`w:tblHeader`).
- **Alignment by Data Type**:
  - **Text / labels**: Left-aligned.
  - **Numbers / dates / currency / `"n.a."` among numbers**: Right-aligned with explicit number formats (never convert numbers to strings just to format them).
  - **Short status codes / checkmarks / column headers**: Centered horizontally; center vertically across cells for clean breathing room.
- **Slide Composition**: Favor flat, high-contrast canvas layouts over cluttered UI-card grids, fake dashboard pills/badges, or multi-corner footer fragments. Minimum readable slide sizes (when no template specifies otherwise): Deck title `>= 36-42 pt`, Slide title `>= 28-32 pt`, Body `>= 17-22 pt`.
