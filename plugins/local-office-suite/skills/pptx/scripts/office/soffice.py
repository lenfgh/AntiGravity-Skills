"""
Cross-platform Office conversion wrapper (`run_soffice`).

- Uses LibreOffice (`soffice`) when available on PATH.
- On Windows without `soffice`, automatically falls back to native Microsoft
  PowerPoint COM (`PowerPoint.Application`) for `.pptx/.ppt/.potx/.ppsx` -> `pdf` / `pptx`
  and Microsoft Word COM (`Word.Application`) for `.docx/.doc/.dotx` -> `pdf`.
- Strictly routes temporary directories to E:/D: (never C:).
"""
from __future__ import annotations

import contextlib
import os
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Iterable
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "vendor"))
for _td in (Path(r"E:\Project\_tmp"), Path(r"D:\_tmp"), Path.home() / ".gemini" / "_tmp"):
    if _td.drive and Path(_td.drive + "\\").exists():
        _td.mkdir(parents=True, exist_ok=True)
        tempfile.tempdir = str(_td)
        break


def _parse_convert_args(args: list[str]) -> tuple[str | None, Path | None, Path | None]:
    fmt = None
    outdir = None
    input_file = None
    i = 0
    while i < len(args):
        a = str(args[i])
        if a in ("--convert-to", "-convert-to") and i + 1 < len(args):
            fmt = str(args[i + 1]).split(":")[0].lower()
            i += 2
            continue
        if a in ("--outdir", "-outdir") and i + 1 < len(args):
            outdir = Path(args[i + 1])
            i += 2
            continue
        if not a.startswith("-") and Path(a).exists():
            input_file = Path(a)
        i += 1
    return fmt, outdir, input_file


def _convert_via_windows_com(fmt: str, outdir: Path, src: Path) -> subprocess.CompletedProcess:
    outdir.mkdir(parents=True, exist_ok=True)
    dst = (outdir / f"{src.stem}.{fmt}").resolve()
    src_abs = src.resolve()
    ext = src_abs.suffix.lower()

    if ext in (".pptx", ".ppt", ".potx", ".ppsx", ".pptm") and fmt in ("pdf", "pptx"):
        # 32 = ppSaveAsPDF, 24 = ppSaveAsOpenXMLPresentation
        save_fmt = 32 if fmt == "pdf" else 24
        ps = rf"""
$ErrorActionPreference = 'Stop'
$src = $env:COM_CONV_SRC
$dst = $env:COM_CONV_DST
$app = $null
$pres = $null
$shouldQuit = $false
try {{
    $app = New-Object -ComObject PowerPoint.Application
    $existingCount = $app.Presentations.Count
    $wasVisible = $app.Visible -ne 0
    $shouldQuit = ($existingCount -eq 0) -and (-not $wasVisible)
    $pres = $app.Presentations.Open($src, $true, $false, $false)
    $pres.SaveAs($dst, {save_fmt})
}} finally {{
    if ($null -ne $pres) {{
        $pres.Close()
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($pres)
    }}
    if ($null -ne $app) {{
        if ($shouldQuit) {{ $app.Quit() }}
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)
    }}
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}}
"""
    elif ext in (".docx", ".doc", ".dotx", ".docm", ".rtf") and fmt == "pdf":
        ps = r"""
$ErrorActionPreference = 'Stop'
$src = $env:COM_CONV_SRC
$dst = $env:COM_CONV_DST
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
    $doc = $word.Documents.Open($src, $false, $true, $false, '', '', $false, '', '', 0, 0, $false, $true)
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
    else:
        return subprocess.CompletedProcess(
            args=["windows-com"],
            returncode=1,
            stdout="",
            stderr=f"Unsupported Windows COM conversion: {ext} -> {fmt} (and LibreOffice soffice not found).",
        )

    env = os.environ.copy()
    env["COM_CONV_SRC"] = str(src_abs)
    env["COM_CONV_DST"] = str(dst)
    if tempfile.tempdir:
        env["TEMP"] = tempfile.tempdir
        env["TMP"] = tempfile.tempdir
    return subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
        capture_output=True,
        text=True,
        env=env,
    )


def run_soffice(args: Iterable[str], **kwargs) -> subprocess.CompletedProcess:
    arg_list = [str(a) for a in args]
    exe = "soffice.exe" if sys.platform == "win32" else "soffice"
    soffice_bin = shutil.which(exe)

    if soffice_bin is not None:
        with contextlib.ExitStack() as stack:
            if not any(a.startswith("-env:UserInstallation") for a in arg_list):
                profile = stack.enter_context(
                    tempfile.TemporaryDirectory(prefix="lo_profile_", ignore_cleanup_errors=True)
                )
                arg_list = [f"-env:UserInstallation={Path(profile).as_uri()}"] + arg_list
            return subprocess.run([soffice_bin] + arg_list, **kwargs)

    if sys.platform == "win32":
        fmt, outdir, src = _parse_convert_args(arg_list)
        if fmt and src:
            target_dir = outdir if outdir is not None else Path.cwd()
            if str(target_dir.resolve()).upper().startswith("C:"):
                return subprocess.CompletedProcess(
                    args=arg_list,
                    returncode=1,
                    stdout="",
                    stderr=f"Refusing to write converted output onto C: drive: {target_dir}",
                )
            return _convert_via_windows_com(fmt, target_dir, src)

    return subprocess.CompletedProcess(
        args=arg_list,
        returncode=1,
        stdout="",
        stderr="LibreOffice (soffice) not found on PATH.",
    )


if __name__ == "__main__":
    res = run_soffice(sys.argv[1:])
    if res.stdout:
        sys.stdout.write(res.stdout)
    if res.stderr:
        sys.stderr.write(res.stderr)
    sys.exit(res.returncode)
