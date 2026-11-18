"""Cross-platform OOXML unpack & pack CLI for template/existing PPTX editing on Windows."""
from __future__ import annotations

import argparse
import shutil
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "vendor"))
from office.helpers import rezip, safe_extract


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_un = sub.add_parser("unpack", help="Safely unpack a .pptx/.potx into a directory on D: or E:")
    p_un.add_argument("src", type=Path)
    p_un.add_argument("dest_dir", type=Path)

    p_pk = sub.add_parser("pack", help="Cleanly pack an unpacked directory into a .pptx/.potx (no folder entries)")
    p_pk.add_argument("src_dir", type=Path)
    p_pk.add_argument("out_file", type=Path)

    args = parser.parse_args()
    if args.cmd == "unpack":
        dest = args.dest_dir.resolve()
        if sys.platform == "win32" and str(dest).upper().startswith("C:"):
            raise ValueError(f"Refusing to unpack onto C: drive: {dest}")
        if dest.exists():
            shutil.rmtree(dest)
        dest.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(args.src, "r") as zf:
            safe_extract(zf, dest)
        print(f"Unpacked {args.src} -> {dest}")
    elif args.cmd == "pack":
        out = args.out_file.resolve()
        if sys.platform == "win32" and str(out).upper().startswith("C:"):
            raise ValueError(f"Refusing to write PPTX onto C: drive: {out}")
        out.parent.mkdir(parents=True, exist_ok=True)
        rezip(args.src_dir.resolve(), out)
        print(f"Packed {args.src_dir} -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
