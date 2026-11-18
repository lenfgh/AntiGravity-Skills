#!/usr/bin/env python3
"""
pack_codesnapshot.py — Generate a compact (<500 KB) single-file code snapshot
(`[Project]_03_CodeSnapshot.md`) for Cloud LLM (ChatGPT / Gemini) architecture & design review,
avoiding RAG chunk fragmentation while strictly respecting upload traffic guardrails.

Usage:
  # Direct mode on any repository (zero config file needed):
  python pack_codesnapshot.py --project MyProject --root /path/to/repo --out /path/to/_tmp/MyProject_03_CodeSnapshot.md

  # Focus on specific subdirectories:
  python pack_codesnapshot.py --project MyProject --root /path/to/repo --focus src/core src/cli tests

  # Preset config mode (+ optional Google Drive upload via Antigravity gdrive CLI):
  python pack_codesnapshot.py --project ProjectAlpha --config projects.json --upload
"""
from __future__ import annotations

import argparse
import ast
import datetime as dt
import json
import os
import shutil
import subprocess
from pathlib import Path

SKIP_DIRS = {
    ".git", "__pycache__", ".pytest_cache", "node_modules", ".venv", "venv",
    "_backup", "_worktrees", "outputs", "output", "runs", "checkpoints",
    "wandb", ".cache", "third_party", "vendor", "official-tools",
    ".deps", "artifacts", "model_runs", "data", "_tmp", ".tmp",
}
CODE_EXTS = {".py", ".sh", ".yaml", ".yml", ".toml", ".ts", ".js", ".mjs", ".rs", ".go"}


def build_tree(root: Path, max_depth: int = 3, max_entries: int = 220) -> str:
    lines = [f"{root.name}/"]
    count = 0

    def walk(cur: Path, prefix: str, depth: int) -> None:
        nonlocal count
        if depth > max_depth or count >= max_entries:
            return
        try:
            entries = sorted(cur.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
        except OSError:
            return
        filtered = [
            e for e in entries
            if e.name not in SKIP_DIRS and not e.name.startswith(".ipynb_checkpoints")
        ]
        for idx, entry in enumerate(filtered):
            if count >= max_entries:
                lines.append(f"{prefix}... (truncated)")
                return
            connector = "└── " if idx == len(filtered) - 1 else "├── "
            suffix = "/" if entry.is_dir() else ""
            lines.append(f"{prefix}{connector}{entry.name}{suffix}")
            count += 1
            if entry.is_dir():
                ext_prefix = "    " if idx == len(filtered) - 1 else "│   "
                walk(entry, prefix + ext_prefix, depth + 1)

    walk(root, "", 1)
    return "\n".join(lines)


def summarize_python_ast(src: str) -> str:
    """Fallback compact API signature summary when full file exceeds remaining byte budget."""
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return "\n".join(src.splitlines()[:80]) + "\n# ... [truncated]"
    out = []
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            out.append(ast.unparse(node))
        elif isinstance(node, ast.ClassDef):
            bases = ", ".join(ast.unparse(b) for b in node.bases)
            out.append(f"\nclass {node.name}({bases}):")
            doc = ast.get_docstring(node)
            if doc:
                out.append(f'    """{doc.splitlines()[0]}"""')
            for sub in node.body:
                if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    prefix = "async def" if isinstance(sub, ast.AsyncFunctionDef) else "def"
                    out.append(f"    {prefix} {sub.name}({ast.unparse(sub.args)}): ...")
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            prefix = "async def" if isinstance(node, ast.AsyncFunctionDef) else "def"
            out.append(f"\n{prefix} {node.name}({ast.unparse(node.args)}):")
            doc = ast.get_docstring(node)
            if doc:
                out.append(f'    """{doc.splitlines()[0]}"""')
    return "\n".join(out)


def collect_files(root: Path, globs: list[str], focus: list[str] | None) -> list[Path]:
    seen: dict[Path, None] = {}
    if focus:
        for rel in focus:
            target = (root / rel).resolve()
            if target.is_file():
                seen[target] = None
            elif target.is_dir():
                for p in sorted(target.rglob("*")):
                    if p.is_file() and p.suffix.lower() in CODE_EXTS and not any(part in SKIP_DIRS for part in p.parts):
                        seen[p.resolve()] = None
    for pattern in globs:
        for p in sorted(root.glob(pattern)):
            if p.is_file() and not any(part in SKIP_DIRS for part in p.parts):
                seen[p.resolve()] = None
    if not seen:
        for ext in ("pyproject.toml", "package.json", "Cargo.toml", "README.md"):
            cand = root / ext
            if cand.is_file():
                seen[cand.resolve()] = None
        for p in sorted(root.rglob("*")):
            if p.is_file() and p.suffix.lower() in CODE_EXTS and not any(part in SKIP_DIRS for part in p.parts):
                seen[p.resolve()] = None
                if len(seen) >= 50:
                    break
    return list(seen.keys())


def git_head_info(root: Path) -> str:
    try:
        proc = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=5
        )
        if proc.returncode == 0:
            return proc.stdout.strip()
    except Exception:
        pass
    return "unversioned-local-snapshot"


def load_presets(config_path: str | None) -> dict:
    candidates = []
    if config_path:
        candidates.append(Path(config_path))
    env_cfg = os.environ.get("RESEARCH_HUB_PROJECTS_JSON")
    if env_cfg:
        candidates.append(Path(env_cfg))
    candidates.append(Path(__file__).resolve().parent.parent / "projects.json")
    for c in candidates:
        if c.is_file():
            return json.loads(c.read_text(encoding="utf-8"))
    return {}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True, help="Project key / label for snapshot header")
    ap.add_argument("--root", default=None, help="Local repository root path (overrides config preset)")
    ap.add_argument("--config", default=None, help="Optional JSON file mapping project keys to root/folder_id/priority_globs")
    ap.add_argument("--focus", nargs="*", default=None, help="Specific relative subpaths to prioritize")
    ap.add_argument("--out", default=None, help="Output markdown path")
    ap.add_argument("--max-kb", type=int, default=420, help="Max output size in KB (<500 KB guardrail)")
    ap.add_argument("--allow-c-drive", action="store_true", help="Allow writing output on Windows C: drive if explicitly needed")
    ap.add_argument("--upload", action="store_true", help="Upload or update in Google Drive via Antigravity gdrive CLI")
    ap.add_argument("--folder-id", default=None, help="Google Drive parent folder ID for initial upload")
    ap.add_argument("--file-id", default=None, help="Existing Google Drive File ID to update in-place")
    args = ap.parse_args()

    presets = load_presets(args.config)
    preset = presets.get(args.project, {})
    raw_root = args.root or preset.get("root")
    if not raw_root:
        raise SystemExit(
            f"Error: --root is required when '{args.project}' is not defined in --config projects.json."
        )
    root = Path(raw_root).resolve()
    default_out_dir = root / "_tmp" / "codesnapshots"
    out_path = Path(args.out).resolve() if args.out else (default_out_dir / f"{args.project}_03_CodeSnapshot.md")

    if os.name == "nt" and not args.allow_c_drive and out_path.drive.upper() == "C:":
        raise ValueError(
            f"Refusing to write working snapshot to C: drive ({out_path}). "
            "Pass --out on D:/E: or add --allow-c-drive if your machine only has C:."
        )
    out_path.parent.mkdir(parents=True, exist_ok=True)

    max_bytes = args.max_kb * 1024
    commit = git_head_info(root)
    now_str = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    sections = [
        f"# {args.project}_03_CodeSnapshot\n\n"
        f"- **Generated**: `{now_str}`\n"
        f"- **Local Root**: `{root}`\n"
        f"- **Git Revision**: `{commit}`\n"
        f"- **Purpose**: Raw interface, caller, entrypoint & test source bundle (`<{args.max_kb} KB`) "
        f"for independent architecture/design review without anchoring bias.\n\n"
        f"## 1. Compact Directory Tree\n\n```text\n{build_tree(root)}\n```\n\n"
        f"## 2. Core Entrypoints, Interfaces & Module Source\n"
    ]

    used_bytes = sum(len(s.encode("utf-8")) for s in sections)
    files = collect_files(root, preset.get("priority_globs", []), args.focus)

    included_full = 0
    included_ast = 0
    for fpath in files:
        try:
            if fpath.stat().st_size > 250_000:
                continue
            raw = fpath.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        try:
            rel = fpath.relative_to(root).as_posix()
        except ValueError:
            rel = fpath.name
        lang = fpath.suffix.lstrip(".") or "text"
        block = f"\n### `{rel}`\n```{lang}\n{raw}\n```\n"
        b_len = len(block.encode("utf-8"))
        if used_bytes + b_len <= max_bytes:
            sections.append(block)
            used_bytes += b_len
            included_full += 1
        elif fpath.suffix == ".py" and used_bytes + 8192 <= max_bytes:
            ast_sig = summarize_python_ast(raw)
            ast_block = f"\n### `{rel}` *(AST Interface Summary — budget cap)*\n```python\n{ast_sig}\n```\n"
            ab_len = len(ast_block.encode("utf-8"))
            if used_bytes + ab_len <= max_bytes:
                sections.append(ast_block)
                used_bytes += ab_len
                included_ast += 1

    final_text = "".join(sections)
    out_path.write_text(final_text, encoding="utf-8")
    size_kb = out_path.stat().st_size / 1024
    print(f"[OK] Wrote {out_path} ({size_kb:.1f} KB | full={included_full}, ast_summary={included_ast})")

    if args.upload:
        fallback_gdrive = Path.home() / ".gemini" / "antigravity" / "bin" / ("gdrive.cmd" if os.name == "nt" else "gdrive")
        gdrive_bin = shutil.which("gdrive") or str(fallback_gdrive)
        file_id = args.file_id or preset.get("file_id")
        folder_id = args.folder_id or preset.get("folder_id")
        if file_id:
            cmd = [gdrive_bin, "mutate", "update", file_id, str(out_path)]
        elif folder_id:
            cmd = [gdrive_bin, "mutate", "upload", str(out_path), "--parent", folder_id]
        else:
            raise ValueError("For --upload, pass --file-id or --folder-id (or configure folder_id in projects.json).")
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if proc.returncode != 0:
            raise RuntimeError(f"gdrive upload failed: {proc.stdout}\n{proc.stderr}")
        print(proc.stdout.strip())


if __name__ == "__main__":
    main()
