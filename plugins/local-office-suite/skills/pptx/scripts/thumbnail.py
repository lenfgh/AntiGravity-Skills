"""Create thumbnail grids from PowerPoint presentation slides.

Labels each thumbnail with its XML filename (e.g., slide1.xml).
Uses soffice or Windows MS PowerPoint COM + Poppler pdftoppm without writing to C: drive.
"""
from __future__ import annotations

import argparse
import os
import posixpath
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "vendor"))
for _td in (Path(r"E:\Project\_tmp"), Path(r"D:\_tmp"), Path.home() / ".gemini" / "_tmp"):
    if _td.drive and Path(_td.drive + "\\").exists():
        _td.mkdir(parents=True, exist_ok=True)
        tempfile.tempdir = str(_td)
        break

import defusedxml.minidom
from defusedxml import ElementTree
from office.helpers import SLIDE_REL_TYPE, opc_target
from office.soffice import run_soffice
from PIL import Image, ImageDraw, ImageFont

FALLBACK_POPPLER_DIRS = [
    os.environ.get("POPPLER_PATH", ""),
    r"D:\texlive\2026\bin\windows",
    r"C:\Program Files\poppler\Library\bin",
    str(Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "native" / "poppler" / "Library" / "bin"),
    str(Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "native" / "poppler" / "bin"),
]

THUMBNAIL_WIDTH = 300
CONVERSION_DPI = 100
MAX_COLS = 6
DEFAULT_COLS = 3
JPEG_QUALITY = 95
GRID_PADDING = 20
BORDER_WIDTH = 2
FONT_SIZE_RATIO = 0.10
LABEL_PADDING_RATIO = 0.4


def _resolve_pdftoppm() -> str:
    exe = "pdftoppm.exe" if sys.platform == "win32" else "pdftoppm"
    found = shutil.which(exe)
    if found:
        return found
    for d in [p for p in FALLBACK_POPPLER_DIRS if p]:
        cand = os.path.join(d, exe)
        if os.path.isfile(cand):
            return cand
    raise FileNotFoundError(f"{exe} not found on PATH or standard D: Poppler locations.")


def main():
    parser = argparse.ArgumentParser(description="Create thumbnail grids from PowerPoint slides.")
    parser.add_argument("input", help="Input PowerPoint file (.pptx)")
    parser.add_argument(
        "output_prefix",
        nargs="?",
        default="thumbnails",
        help="Output prefix path on D: or E: for image files (default: thumbnails)",
    )
    parser.add_argument(
        "--cols",
        type=int,
        default=DEFAULT_COLS,
        help=f"Number of columns (default: {DEFAULT_COLS}, max: {MAX_COLS})",
    )

    args = parser.parse_args()
    cols = min(args.cols, MAX_COLS)
    input_path = Path(args.input).resolve()
    if not input_path.exists() or input_path.suffix.lower() != ".pptx":
        print(f"Error: Invalid PowerPoint file: {args.input}", file=sys.stderr)
        sys.exit(1)

    output_path = Path(f"{args.output_prefix}.jpg").resolve()
    if sys.platform == "win32" and str(output_path).upper().startswith("C:"):
        print(f"Error: Refusing to write thumbnails onto C: drive ({output_path}). Pass an output_prefix on D: or E:.", file=sys.stderr)
        sys.exit(1)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        slide_info = get_slide_info(input_path)
        with tempfile.TemporaryDirectory(prefix="pptx_thumb_", dir=str(output_path.parent)) as temp_dir:
            temp_path = Path(temp_dir)
            visible_images = convert_to_images(input_path, temp_path)
            if not visible_images and not any(s["hidden"] for s in slide_info):
                print("Error: No slides found", file=sys.stderr)
                sys.exit(1)
            slides = build_slide_list(slide_info, visible_images, temp_path)
            grid_files = create_grids(slides, cols, THUMBNAIL_WIDTH, output_path)
            print(f"Created {len(grid_files)} grid(s):")
            for grid_file in grid_files:
                print(f"  {grid_file}")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def _is_hidden(zf: zipfile.ZipFile, part: str) -> bool:
    try:
        with zf.open(part) as f:
            for _, root in ElementTree.iterparse(f, events=("start",)):
                return root.get("show") in ("0", "false")
    except (KeyError, ElementTree.ParseError):
        return False
    return False


def get_slide_info(pptx_path: Path) -> list[dict]:
    with zipfile.ZipFile(pptx_path, "r") as zf:
        rels_content = zf.read("ppt/_rels/presentation.xml.rels").decode("utf-8")
        rels_dom = defusedxml.minidom.parseString(rels_content)
        rid_to_part = {}
        for rel in rels_dom.getElementsByTagName("Relationship"):
            if rel.getAttribute("Type") != SLIDE_REL_TYPE:
                continue
            part = opc_target(
                rel.getAttribute("Target"),
                "ppt/presentation.xml",
                rel.getAttribute("TargetMode"),
            )
            if part is not None:
                rid_to_part[rel.getAttribute("Id")] = part

        pres_content = zf.read("ppt/presentation.xml").decode("utf-8")
        pres_dom = defusedxml.minidom.parseString(pres_content)
        present = set(zf.namelist())
        slides = []
        for sld_id in pres_dom.getElementsByTagName("p:sldId"):
            part = rid_to_part.get(sld_id.getAttribute("r:id"))
            if part is not None and part in present:
                slides.append({"name": posixpath.basename(part), "hidden": _is_hidden(zf, part)})
        return slides


def build_slide_list(
    slide_info: list[dict],
    visible_images: list[Path],
    temp_dir: Path,
) -> list[tuple[Path, str]]:
    visible_count = sum(1 for info in slide_info if not info["hidden"])
    rendered_hidden = len(visible_images) == len(slide_info) != visible_count

    if not rendered_hidden and visible_count != len(visible_images):
        raise ValueError(
            f"Renderer emitted {len(visible_images)} page(s) for {visible_count} "
            f"visible slide(s) of {len(slide_info)}; thumbnails would be mislabeled"
        )

    if visible_images:
        with Image.open(visible_images[0]) as img:
            placeholder_size = img.size
    else:
        placeholder_size = (1920, 1080)

    slides = []
    visible_idx = 0
    for info in slide_info:
        if info["hidden"] and not rendered_hidden:
            placeholder_path = temp_dir / f"hidden-{info['name']}.jpg"
            placeholder_img = create_hidden_placeholder(placeholder_size)
            placeholder_img.save(placeholder_path, "JPEG")
            slides.append((placeholder_path, f"{info['name']} (hidden)"))
        else:
            label = f"{info['name']} (hidden)" if info["hidden"] else info["name"]
            slides.append((visible_images[visible_idx], label))
            visible_idx += 1
    return slides


def create_hidden_placeholder(size: tuple[int, int]) -> Image.Image:
    img = Image.new("RGB", size, color="#F0F0F0")
    draw = ImageDraw.Draw(img)
    line_width = max(5, min(size) // 100)
    draw.line([(0, 0), size], fill="#CCCCCC", width=line_width)
    draw.line([(size[0], 0), (0, size[1])], fill="#CCCCCC", width=line_width)
    return img


def convert_to_images(pptx_path: Path, temp_dir: Path) -> list[Path]:
    pdf_path = temp_dir / f"{pptx_path.stem}.pdf"
    result = run_soffice(
        ["--headless", "--convert-to", "pdf", "--outdir", str(temp_dir), str(pptx_path)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not pdf_path.exists():
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"PDF conversion failed: {detail}" if detail else "PDF conversion failed")

    pdftoppm = _resolve_pdftoppm()
    result = subprocess.run(
        [pdftoppm, "-png", "-r", str(CONVERSION_DPI), str(pdf_path), str(temp_dir / "slide")],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Image conversion failed: {result.stderr}")
    return sorted(temp_dir.glob("slide-*.png"))


def create_grids(slides: list[tuple[Path, str]], cols: int, width: int, output_path: Path) -> list[str]:
    max_per_grid = cols * (cols + 1)
    grid_files = []
    for chunk_idx, start_idx in enumerate(range(0, len(slides), max_per_grid)):
        end_idx = min(start_idx + max_per_grid, len(slides))
        chunk_slides = slides[start_idx:end_idx]
        grid = create_grid(chunk_slides, cols, width)
        if len(slides) <= max_per_grid:
            grid_filename = output_path
        else:
            grid_filename = output_path.parent / f"{output_path.stem}-{chunk_idx + 1}{output_path.suffix}"
        grid_filename.parent.mkdir(parents=True, exist_ok=True)
        grid.save(str(grid_filename), quality=JPEG_QUALITY)
        grid_files.append(str(grid_filename))
    return grid_files


def create_grid(slides: list[tuple[Path, str]], cols: int, width: int) -> Image.Image:
    font_size = int(width * FONT_SIZE_RATIO)
    label_padding = int(font_size * LABEL_PADDING_RATIO)
    with Image.open(slides[0][0]) as img:
        aspect = img.height / img.width
    height = int(width * aspect)

    rows = (len(slides) + cols - 1) // cols
    grid_w = cols * width + (cols + 1) * GRID_PADDING
    grid_h = rows * (height + font_size + label_padding * 2) + (rows + 1) * GRID_PADDING

    grid = Image.new("RGB", (grid_w, grid_h), "white")
    draw = ImageDraw.Draw(grid)
    try:
        font = ImageFont.load_default(size=font_size)
    except Exception:
        font = ImageFont.load_default()

    for i, (img_path, slide_name) in enumerate(slides):
        row, col = i // cols, i % cols
        x = col * width + (col + 1) * GRID_PADDING
        y_base = row * (height + font_size + label_padding * 2) + (row + 1) * GRID_PADDING
        bbox = draw.textbbox((0, 0), slide_name, font=font)
        text_w = bbox[2] - bbox[0]
        draw.text((x + (width - text_w) // 2, y_base + label_padding), slide_name, fill="black", font=font)

        y_thumbnail = y_base + label_padding + font_size + label_padding
        with Image.open(img_path) as img:
            img.thumbnail((width, height), Image.Resampling.LANCZOS)
            w, h = img.size
            tx = x + (width - w) // 2
            ty = y_thumbnail + (height - h) // 2
            grid.paste(img, (tx, ty))
            if BORDER_WIDTH > 0:
                draw.rectangle(
                    [(tx - BORDER_WIDTH, ty - BORDER_WIDTH), (tx + w + BORDER_WIDTH - 1, ty + h + BORDER_WIDTH - 1)],
                    outline="gray",
                    width=BORDER_WIDTH,
                )
    return grid


if __name__ == "__main__":
    main()
