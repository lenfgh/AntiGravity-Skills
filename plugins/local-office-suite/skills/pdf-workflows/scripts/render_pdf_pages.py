#!/usr/bin/env python3
"""Render PDF pages to page-<N>.png using Poppler pdftoppm without touching C: drive temp."""
from __future__ import annotations

import argparse
import glob
import os
import shutil
import subprocess
import sys
from pathlib import Path

FALLBACK_POPPLER_DIRS = [
    os.environ.get("POPPLER_PATH", ""),
    r"D:\texlive\2026\bin\windows",
    r"C:\Program Files\poppler\Library\bin",
    str(Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "native" / "poppler" / "Library" / "bin"),
    str(Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "native" / "poppler" / "bin"),
]


def resolve_pdftoppm() -> str:
    exe = "pdftoppm.exe" if sys.platform == "win32" else "pdftoppm"
    found = shutil.which(exe)
    if found:
        return found
    for d in [p for p in FALLBACK_POPPLER_DIRS if p]:
        cand = os.path.join(d, exe)
        if os.path.isfile(cand):
            return cand
    raise FileNotFoundError(f"{exe} not found on PATH or standard D: Poppler paths.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_pdf", type=Path, help="Input PDF path")
    parser.add_argument("--output_dir", type=Path, required=True, help="Output directory on D: or E:")
    parser.add_argument("--dpi", type=int, default=150, help="Render DPI (default: 150)")
    args = parser.parse_args()

    input_pdf = args.input_pdf.resolve()
    out_dir = args.output_dir.resolve()
    if str(out_dir).upper().startswith("C:"):
        raise ValueError(f"Refusing to write rendered intermediates onto C: drive: {out_dir}")
    out_dir.mkdir(parents=True, exist_ok=True)

    pdftoppm = resolve_pdftoppm()
    prefix = out_dir / "raw_page"
    cmd = [pdftoppm, "-png", "-r", str(args.dpi), str(input_pdf), str(prefix)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        return proc.returncode

    raw_files = sorted(glob.glob(str(out_dir / "raw_page-*.png")))
    pages = []
    for f in raw_files:
        stem = Path(f).stem
        num = int(stem.rsplit("-", 1)[-1])
        dst = out_dir / f"page-{num}.png"
        os.replace(f, dst)
        pages.append(str(dst))

    print(f"Rendered {len(pages)} page(s) to {out_dir}")
    for p in pages:
        print(p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
