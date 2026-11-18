#!/usr/bin/env python3
"""Render DOCX-like file to PNG images (DOCX -> PDF -> PNG).

Adapted for Windows + Antigravity:
- Uses LibreOffice (`soffice`) when available, otherwise automatically falls back
  to Microsoft Word COM (`Word.Application` -> ExportAsFixedFormat PDF) on Windows.
- Auto-discovers Poppler (`pdftoppm` / `pdfinfo`) on D: drive if not on PATH.
- Strictly keeps all temporary files off C: drive (uses a `_tmp_render` folder inside
  or beside `--output_dir` on D:/E:).
"""
from __future__ import annotations

import argparse
import glob
import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from os import makedirs, replace
from os.path import abspath, basename, dirname, exists, expanduser, join, splitext
from pathlib import Path
from typing import Sequence, cast
from zipfile import ZipFile, ZipInfo

FALLBACK_POPPLER_DIRS = [
    os.environ.get("POPPLER_PATH", ""),
    r"D:\texlive\2026\bin\windows",
    r"C:\Program Files\poppler\Library\bin",
    str(Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "native" / "poppler" / "Library" / "bin"),
    str(Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "native" / "poppler" / "bin"),
]


def _ensure_poppler_on_path() -> str | None:
    exe = "pdftoppm.exe" if sys.platform == "win32" else "pdftoppm"
    found = shutil.which(exe)
    if found:
        return dirname(abspath(found))
    for d in [p for p in FALLBACK_POPPLER_DIRS if p]:
        if os.path.isfile(join(d, exe)):
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")
            return d
    return None


_POPPLER_DIR = _ensure_poppler_on_path()

from pdf2image import convert_from_path, pdfinfo_from_path  # noqa: E402

TWIPS_PER_INCH: int = 1440


def _configure_safe_tempdir(out_dir: str) -> str:
    out_abs = abspath(out_dir)
    if sys.platform == "win32" and out_abs.upper().startswith("C:"):
        raise ValueError(
            f"Storage guardrail violation: refusing to write rendered output onto C: drive ({out_abs}). "
            "Pass --output_dir on D: or E: (e.g., E:\\Project\\_tmp\\docx_qa)."
        )
    makedirs(out_abs, exist_ok=True)
    safe_tmp = join(out_abs, "_tmp_render")
    makedirs(safe_tmp, exist_ok=True)
    os.environ["TMPDIR"] = safe_tmp
    os.environ["TEMP"] = safe_tmp
    os.environ["TMP"] = safe_tmp
    tempfile.tempdir = safe_tmp
    return safe_tmp


def _resolve_soffice() -> str | None:
    executable_name = "soffice.exe" if sys.platform == "win32" else "soffice"
    soffice = shutil.which(executable_name)
    return abspath(soffice) if soffice else None


def _read_ooxml_member(zf: ZipFile, member_name: str) -> bytes:
    try:
        return zf.read(member_name)
    except KeyError:
        backslash_name = member_name.replace("/", "\\")
        if backslash_name != member_name:
            return zf.read(backslash_name)
        raise


def _zipinfo_with_filename(info: ZipInfo, filename: str) -> ZipInfo:
    out = ZipInfo(filename=filename, date_time=info.date_time)
    out.comment = info.comment
    out.extra = info.extra
    out.internal_attr = info.internal_attr
    out.external_attr = info.external_attr
    out.create_system = info.create_system
    out.compress_type = info.compress_type
    return out


def make_renderable_docx_copy(
    input_path: str, *, temp_root: str, verbose: bool = False
) -> tuple[str, tempfile.TemporaryDirectory[str] | None]:
    if not input_path.lower().endswith((".docx", ".docm", ".dotx", ".dotm")):
        return input_path, None
    try:
        with ZipFile(input_path, "r") as zf:
            infos = zf.infolist()
            normalized_names = [info.filename.replace("\\", "/") for info in infos]
            should_repair = any(
                info.filename != normalized_name
                for info, normalized_name in zip(infos, normalized_names)
            )
            if not should_repair or "word/document.xml" not in normalized_names:
                return input_path, None

            temp_dir: tempfile.TemporaryDirectory[str] = tempfile.TemporaryDirectory(
                prefix="render_docx_ooxml_", dir=temp_root
            )
            repaired_path = join(temp_dir.name, basename(input_path))
            seen: set[str] = set()
            with ZipFile(repaired_path, "w") as zout:
                for info, normalized_name in zip(infos, normalized_names):
                    if normalized_name in seen:
                        continue
                    seen.add(normalized_name)
                    zout.writestr(
                        _zipinfo_with_filename(info, normalized_name),
                        zf.read(info.filename),
                    )
    except Exception:
        return input_path, None

    if verbose:
        print(f"[render_docx] Repaired OOXML zip member paths: {input_path} -> {repaired_path}")
    return repaired_path, temp_dir


def calc_dpi_via_ooxml_docx(input_path: str, max_w_px: int, max_h_px: int) -> int:
    with ZipFile(input_path, "r") as zf:
        xml = _read_ooxml_member(zf, "word/document.xml")
    root = ET.fromstring(xml)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    sect_pr = root.find(".//w:sectPr", ns)
    if sect_pr is None:
        raise RuntimeError("Section properties not found in document.xml")
    pg_sz = sect_pr.find("w:pgSz", ns)
    if pg_sz is None:
        raise RuntimeError("Page size not found in section properties")
    w_twips_str = pg_sz.get(f"{{{ns['w']}}}w") or pg_sz.get("w")
    h_twips_str = pg_sz.get(f"{{{ns['w']}}}h") or pg_sz.get("h")
    if not w_twips_str or not h_twips_str:
        raise RuntimeError("Page size attributes missing in pgSz")
    width_in = int(w_twips_str) / TWIPS_PER_INCH
    height_in = int(h_twips_str) / TWIPS_PER_INCH
    if width_in <= 0 or height_in <= 0:
        raise RuntimeError("Invalid page size values in document.xml")
    return round(min(max_w_px / width_in, max_h_px / height_in))


def _convert_via_word_com(doc_path: str, pdf_path: str, verbose: bool) -> tuple[str, str]:
    ps_script = r"""
$ErrorActionPreference = 'Stop'
$src = $env:RENDER_DOCX_SRC
$dst = $env:RENDER_DOCX_DST
$word = $null
$doc = $null
$shouldQuit = $false
try {
    $word = New-Object -ComObject Word.Application
    $existingCount = $word.Documents.Count
    $wasVisible = $word.Visible
    $shouldQuit = ($existingCount -eq 0) -and (-not $wasVisible)
    if (-not $wasVisible) { $word.Visible = $false }
    $word.DisplayAlerts = 0
    # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, ..., Visible=false)
    $doc = $word.Documents.Open($src, $false, $true, $false, '', '', $false, '', '', 0, 0, $false, $true)
    # 17 = wdExportFormatPDF; 7 = wdExportCreateHeadingBookmarks / 0 = wdExportOptimizeForPrint
    $doc.ExportAsFixedFormat($dst, 17, $false, 0)
} finally {
    if ($null -ne $doc) {
        $doc.Close(0)
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($doc)
    }
    if ($null -ne $word) {
        if ($shouldQuit) { $word.Quit(0) }
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
"""
    env = os.environ.copy()
    env["RENDER_DOCX_SRC"] = abspath(doc_path)
    env["RENDER_DOCX_DST"] = abspath(pdf_path)
    proc = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
        capture_output=True,
        text=True,
        env=env,
    )
    debug = f"--- WORD_COM DOCX->PDF ---\nEXIT: {proc.returncode}\nSTDOUT: {proc.stdout}\nSTDERR: {proc.stderr}"
    if verbose:
        print(debug)
    if exists(pdf_path) and os.path.getsize(pdf_path) > 0:
        return pdf_path, debug
    return "", debug


def convert_to_pdf(
    doc_path: str,
    user_profile: str,
    convert_tmp_dir: str,
    stem: str,
    verbose: bool,
) -> tuple[str, str]:
    pdf_path = join(convert_tmp_dir, f"{stem}.pdf")
    soffice = _resolve_soffice()

    if soffice is None:
        if sys.platform == "win32":
            return _convert_via_word_com(doc_path, pdf_path, verbose=verbose)
        return "", "Neither soffice nor Windows Word COM is available."

    env = os.environ.copy()
    env["HOME"] = user_profile
    profile_argument = f"-env:UserInstallation={Path(user_profile).resolve().as_uri()}"
    cmd_pdf = [
        soffice,
        profile_argument,
        "--invisible",
        "--headless",
        "--norestore",
        "--convert-to",
        "pdf",
        "--outdir",
        convert_tmp_dir,
        doc_path,
    ]
    proc = subprocess.run(cmd_pdf, capture_output=True, text=True, env=env)
    debug = f"CMD: {' '.join(cmd_pdf)}\nEXIT: {proc.returncode}\nSTDOUT: {proc.stdout}\nSTDERR: {proc.stderr}"
    if verbose:
        print(debug)
    if exists(pdf_path) and os.path.getsize(pdf_path) > 0:
        return pdf_path, debug
    pdf_glob = glob.glob(join(convert_tmp_dir, "*.pdf"))
    if pdf_glob and os.path.getsize(min(pdf_glob)) > 0:
        return min(pdf_glob), debug
    if sys.platform == "win32":
        return _convert_via_word_com(doc_path, pdf_path, verbose=verbose)
    return "", debug


def calc_dpi_via_pdf(
    input_path: str, max_w_px: int, max_h_px: int, temp_root: str, verbose: bool
) -> int:
    with tempfile.TemporaryDirectory(prefix="profile_", dir=temp_root) as user_profile:
        with tempfile.TemporaryDirectory(prefix="convert_", dir=temp_root) as convert_tmp_dir:
            stem = splitext(basename(input_path))[0]
            pdf_path, debug = convert_to_pdf(
                input_path, user_profile, convert_tmp_dir, stem, verbose=verbose
            )
            if not (pdf_path and exists(pdf_path)):
                raise RuntimeError("Failed to convert input to PDF for DPI computation.\n" + debug)
            info = pdfinfo_from_path(pdf_path, poppler_path=_POPPLER_DIR)
            size_val = info.get("Page size")
            if not isinstance(size_val, str):
                raise RuntimeError("Failed to read PDF page size for DPI computation.")
            m = re.search(r"(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*pts", size_val)
            if not m:
                raise RuntimeError("Unrecognized PDF page size format.")
            width_in = float(m.group(1)) / 72.0
            height_in = float(m.group(2)) / 72.0
            return round(min(max_w_px / width_in, max_h_px / height_in))


def rasterize(
    doc_path: str, out_dir: str, temp_root: str, dpi: int, verbose: bool, emit_pdf: bool
) -> Sequence[str]:
    makedirs(out_dir, exist_ok=True)
    doc_path = abspath(doc_path)
    stem = splitext(basename(doc_path))[0]

    with tempfile.TemporaryDirectory(prefix="profile_", dir=temp_root) as user_profile:
        with tempfile.TemporaryDirectory(prefix="convert_", dir=temp_root) as convert_tmp_dir:
            pdf_path, debug = convert_to_pdf(
                doc_path, user_profile, convert_tmp_dir, stem, verbose=verbose
            )
            if not pdf_path or not exists(pdf_path):
                raise RuntimeError("Failed to produce PDF for rasterization.\n" + debug)

            if emit_pdf:
                dst_pdf = join(out_dir, f"{stem}.pdf")
                tmp_pdf = dst_pdf + ".tmp"
                shutil.copy2(pdf_path, tmp_pdf)
                replace(tmp_pdf, dst_pdf)

            paths_raw = cast(
                list[str],
                convert_from_path(
                    pdf_path,
                    dpi=dpi,
                    fmt="png",
                    thread_count=4,
                    output_folder=out_dir,
                    paths_only=True,
                    output_file="page",
                    poppler_path=_POPPLER_DIR,
                ),
            )

    pages: list[tuple[int, str]] = []
    for src_path in paths_raw:
        base = splitext(basename(src_path))[0]
        page_num = int(base.split("-")[-1])
        dst_path = join(out_dir, f"page-{page_num}.png")
        replace(src_path, dst_path)
        pages.append((page_num, dst_path))
    pages.sort(key=lambda t: t[0])
    return [path for _, path in pages]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Render DOCX-like file to PNG images (DOCX -> PDF -> PNG via soffice or MS Word COM)."
    )
    parser.add_argument("input_path", type=str, help="Path to the input DOCX file.")
    parser.add_argument(
        "--output_dir",
        type=str,
        default=None,
        help="Output directory on D: or E: for rendered PNGs (defaults to folder beside input_path).",
    )
    parser.add_argument("--width", type=int, default=1600)
    parser.add_argument("--height", type=int, default=2000)
    parser.add_argument("--dpi", type=int, default=None)
    parser.add_argument("--emit_pdf", action="store_true")
    parser.add_argument("--verbose", action="store_true")

    args = parser.parse_args()
    input_path = abspath(expanduser(args.input_path))
    out_dir = abspath(expanduser(args.output_dir)) if args.output_dir else splitext(input_path)[0]
    temp_root = _configure_safe_tempdir(out_dir)

    render_input_path, repair_temp_dir = make_renderable_docx_copy(
        input_path, temp_root=temp_root, verbose=args.verbose
    )
    try:
        if args.dpi is not None:
            dpi = int(args.dpi)
        else:
            try:
                if render_input_path.lower().endswith((".docx", ".docm", ".dotx", ".dotm")):
                    dpi = calc_dpi_via_ooxml_docx(render_input_path, args.width, args.height)
                else:
                    raise RuntimeError("Not DOCX")
            except Exception:
                dpi = calc_dpi_via_pdf(
                    render_input_path, args.width, args.height, temp_root=temp_root, verbose=args.verbose
                )

        rasterize(
            render_input_path,
            out_dir,
            temp_root=temp_root,
            dpi=dpi,
            verbose=args.verbose,
            emit_pdf=args.emit_pdf,
        )
        print("Pages rendered to " + out_dir)
    finally:
        if repair_temp_dir is not None:
            repair_temp_dir.cleanup()
        shutil.rmtree(temp_root, ignore_errors=True)


if __name__ == "__main__":
    main()
