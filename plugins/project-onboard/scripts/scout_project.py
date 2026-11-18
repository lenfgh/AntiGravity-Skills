#!/usr/bin/env python3
r"""
scout_project.py — Fast, strictly read-only onboarding scout for any project workspace.

Designed for the `project-onboard` skill across Antigravity and Codex:
  - Zero file mutations, zero SHA256 computations, zero binary/checkpoint reads.
  - Resolves `E:\Project\REGISTRY.md` bindings automatically if applicable.
  - Classifies workspace state:
      * STATE_A_REGISTERED          : In REGISTRY.md + has AGENTS.md
      * STATE_B_UNREGISTERED_ACTIVE : Active repo/work/runs without full Research_Hub registration
      * STATE_C_NEW_OR_BARE         : Fresh/bare codebase needing initial mapping & optional bootstrap
  - Detects root + 1-level nested Git repos (e.g. `Workspace\ActionGraft`) and dirty working trees.
  - Flags live concurrent writes (< 30 min), stale READMEs, and AGENTS.md size-cap warnings.
  - Ranks active workstreams and canonical status/diagnosis/plan anchor files without log spam.

Usage:
  python ~/.gemini/config/plugins/project-onboard/scripts/scout_project.py
  python ~/.gemini/config/plugins/project-onboard/scripts/scout_project.py --path E:\Project\DemoProject
  python ~/.gemini/config/plugins/project-onboard/scripts/scout_project.py --path E:\Project\QuantEngine --days 14
  python ~/.gemini/config/plugins/project-onboard/scripts/scout_project.py --path E:\Project\DemoProject --json
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

try:
    import tomllib  # Python 3.11+
except ImportError:  # pragma: no cover
    tomllib = None  # type: ignore[assignment]

DEFAULT_REGISTRY = Path(r"E:\Project\REGISTRY.md")
AGENTS_WARN_KB = 20.0
AGENTS_HARD_CAP_KB = 22.0
LIVE_WRITE_MINUTES = 30

SKIP_DIRS = {
    ".git",
    ".hg",
    ".svn",
    "__pycache__",
    "node_modules",
    ".venv",
    "venv",
    "env",
    ".conda",
    ".quantmodel-env",
    "third_party",
    ".cache",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".tox",
    ".idea",
    ".vscode",
    "dist",
    "build",
    "wandb",
    "lightning_logs",
    "_backup",
    "checkpoints",
    "weights",
    "datasets",
    "browser_sandbox",
}

SKIP_SUFFIXES = {
    ".pt",
    ".pth",
    ".ckpt",
    ".safetensors",
    ".bin",
    ".onnx",
    ".h5",
    ".hdf5",
    ".parquet",
    ".feather",
    ".npy",
    ".npz",
    ".mp4",
    ".avi",
    ".mov",
    ".mkv",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".ico",
    ".pdf",
    ".docx",
    ".pptx",
    ".xlsx",
    ".zip",
    ".tar",
    ".gz",
    ".tgz",
    ".bz2",
    ".xz",
    ".7z",
    ".pyc",
    ".pyo",
    ".pyd",
    ".dll",
    ".so",
    ".dylib",
    ".exe",
    ".db",
    ".sqlite",
    ".sqlite3",
    ".whl",
}

TEXT_SIGNAL_SUFFIXES = {".md", ".json", ".toml", ".yaml", ".yml", ".txt"}

WORKSTREAM_CONTAINER_NAMES = {
    "work",
    "research",
    "model_runs",
    "runs",
    "reports",
    "experiments",
    "outputs",
    "development",
}

NOISY_LEAF_FILENAMES = {
    "stdout.json",
    "stderr.json",
    "stdout.txt",
    "stderr.txt",
    "transport.json",
}

ANCHOR_NAME_PATTERNS = re.compile(
    r"(^status\.json$|^current[-_a-z0-9]*\.json$|terminal[-_a-z0-9]*\.json$|"
    r"summary|diagnos|audit|comparison|plan|scheme|handoff|overview|report|logbook|studio|"
    r"implementation_log)",
    re.IGNORECASE,
)

GOVERNANCE_FILENAMES = (
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    "TEST_SERVER.md",
    "CONTRIBUTING.md",
)

ENV_CONFIG_FILENAMES = (
    "pyproject.toml",
    "setup.py",
    "requirements.txt",
    "environment.yml",
    "mamba_env.yml",
    "package.json",
    "Cargo.toml",
    "Makefile",
)


def fmt_ts(ts: float | None) -> str:
    if ts is None:
        return "N/A"
    return dt.datetime.fromtimestamp(ts).astimezone().strftime("%Y-%m-%d %H:%M:%S")


def norm_path_str(p: Path) -> str:
    try:
        return str(p.resolve()).lower().rstrip("\\/")
    except OSError:
        return str(p).lower().rstrip("\\/")


def parse_registry(registry_path: Path, target_dir: Path) -> list[dict[str, str]]:
    """Parse Section 2 table of E:\\Project\\REGISTRY.md and match target_dir."""
    if not registry_path.is_file():
        return []
    try:
        text = registry_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []

    target_norm = norm_path_str(target_dir)
    matches: list[dict[str, str]] = []
    in_section_2 = False

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if line.startswith("## 2."):
            in_section_2 = True
            continue
        if in_section_2 and line.startswith("## ") and not line.startswith("## 2."):
            break
        if not in_section_2 or not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 7 or cells[0].lower() in {"key", ":---", "---"} or set(cells[0]) <= {":", "-"}:
            continue

        clean = lambda s: re.sub(r"[`*]", "", s).strip()
        key = clean(cells[0])
        project_title = clean(cells[1])
        team = clean(cells[2])
        ws_cell = cells[3]
        # Extract primary path like `E:\Project\DemoProject`
        path_match = re.search(r"([A-Za-z]:\\[^`)|]+)", ws_cell)
        ws_raw = path_match.group(1).strip() if path_match else clean(ws_cell)
        ws_norm = norm_path_str(Path(ws_raw))

        # Match if target is inside registered workspace OR registered workspace is inside target
        if (
            target_norm == ws_norm
            or target_norm.startswith(ws_norm + "\\")
            or ws_norm.startswith(target_norm + "\\")
        ):
            matches.append(
                {
                    "key": key,
                    "project": project_title,
                    "team": team,
                    "local_workspace": ws_raw,
                    "drive_folder_id": clean(cells[4]),
                    "logbook_doc_id": clean(cells[5]),
                    "studio_doc_id": clean(cells[6]),
                    "codesnapshot_file_id": clean(cells[7]) if len(cells) > 7 else "",
                }
            )
    return matches


def inspect_git_repo(repo_dir: Path) -> dict[str, Any] | None:
    git_marker = repo_dir / ".git"
    if not git_marker.exists():
        return None
    info: dict[str, Any] = {
        "repo_path": str(repo_dir),
        "branch": "unknown",
        "staged_count": 0,
        "modified_count": 0,
        "untracked_count": 0,
        "dirty_tracked_samples": [],
    }
    try:
        proc = subprocess.run(
            ["git", "-C", str(repo_dir), "status", "--porcelain=v1", "-b", "-uno"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=3.0,
            check=False,
        )
        if proc.returncode == 0:
            lines = proc.stdout.splitlines()
            if lines and lines[0].startswith("## "):
                info["branch"] = lines[0][3:].strip()
            dirty_samples: list[dict[str, str]] = []
            for line in lines[1:]:
                if len(line) < 4:
                    continue
                xy = line[:2]
                rel = line[3:].strip()
                if xy[0] not in {" ", "?"}:
                    info["staged_count"] += 1
                if xy[1] not in {" ", "?"}:
                    info["modified_count"] += 1
                if len(dirty_samples) < 10:
                    fpath = repo_dir / rel
                    mtime = fmt_ts(fpath.stat().st_mtime) if fpath.exists() else "deleted/moved"
                    dirty_samples.append({"status": xy.strip(), "file": rel, "mtime": mtime})
            info["dirty_tracked_samples"] = dirty_samples

        # Quick untracked top-level count without flooding huge folders
        proc_u = subprocess.run(
            ["git", "-C", str(repo_dir), "ls-files", "--others", "--exclude-standard", "--directory"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=2.0,
            check=False,
        )
        if proc_u.returncode == 0:
            u_lines = [ln.strip() for ln in proc_u.stdout.splitlines() if ln.strip()]
            info["untracked_count"] = len(u_lines)
            info["untracked_samples"] = u_lines[:8]
    except (OSError, subprocess.TimeoutExpired):
        info["note"] = "git probe timed out or unavailable"
    return info


def parse_pyproject_hint(pyproject_path: Path) -> dict[str, Any]:
    hint: dict[str, Any] = {"path": str(pyproject_path)}
    if tomllib is None:
        return hint
    try:
        data = tomllib.loads(pyproject_path.read_text(encoding="utf-8", errors="replace"))
        proj = data.get("project", {})
        if proj.get("name"):
            hint["package_name"] = proj["name"]
        if proj.get("requires-python"):
            hint["requires_python"] = proj["requires-python"]
        scripts = proj.get("scripts", {})
        if scripts:
            hint["cli_entrypoints"] = dict(list(scripts.items())[:8])
    except Exception:
        pass
    return hint


def scout_workspace(target_dir: Path, registry_path: Path, recent_days: int = 10) -> dict[str, Any]:
    t0 = time.perf_counter()
    now = time.time()
    recent_cutoff = now - recent_days * 86400
    live_cutoff = now - LIVE_WRITE_MINUTES * 60

    target_dir = target_dir.resolve()
    if not target_dir.is_dir():
        raise FileNotFoundError(f"Workspace path does not exist or is not a directory: {target_dir}")

    registry_matches = parse_registry(registry_path, target_dir)

    # 1. Top-level layout & local virtualenvs / sub-repos
    top_dirs: list[dict[str, Any]] = []
    top_files: list[dict[str, Any]] = []
    local_envs: list[str] = []
    candidate_subrepos: list[Path] = [target_dir]

    try:
        with os.scandir(target_dir) as it:
            for entry in it:
                try:
                    st = entry.stat(follow_symlinks=False)
                except OSError:
                    continue
                if entry.is_dir(follow_symlinks=False):
                    if entry.name in {".venv", "venv", "env", ".conda", ".quantmodel-env"} or entry.name.endswith("-env"):
                        local_envs.append(entry.name)
                    if entry.name != ".git":
                        top_dirs.append({"name": entry.name, "mtime": st.st_mtime, "mtime_str": fmt_ts(st.st_mtime)})
                        if entry.name not in SKIP_DIRS:
                            candidate_subrepos.append(Path(entry.path))
                elif entry.is_file(follow_symlinks=False):
                    top_files.append(
                        {
                            "name": entry.name,
                            "size_kb": round(st.st_size / 1024.0, 2),
                            "mtime": st.st_mtime,
                            "mtime_str": fmt_ts(st.st_mtime),
                        }
                    )
    except OSError:
        pass

    top_dirs.sort(key=lambda x: x["mtime"], reverse=True)
    top_files.sort(key=lambda x: x["mtime"], reverse=True)

    # 2. Governance, READMEs, Environment configs & Git repos (root + 1-level subdirs + parent E:\Project\AGENTS.md)
    governance_files: list[dict[str, Any]] = []
    readmes: list[dict[str, Any]] = []
    env_configs: list[dict[str, Any]] = []
    pyproject_hints: list[dict[str, Any]] = []
    warnings: list[str] = []

    parent_agents = target_dir.parent / "AGENTS.md"
    if parent_agents.is_file() and norm_path_str(target_dir.parent) == norm_path_str(Path(r"E:\Project")):
        st = parent_agents.stat()
        governance_files.append(
            {
                "scope": "global_root",
                "path": str(parent_agents),
                "size_kb": round(st.st_size / 1024.0, 2),
                "mtime": st.st_mtime,
                "mtime_str": fmt_ts(st.st_mtime),
            }
        )

    for scope_idx, base in enumerate(candidate_subrepos):
        scope_label = "workspace_root" if scope_idx == 0 else f"subproject:{base.name}"
        for gname in GOVERNANCE_FILENAMES:
            gp = base / gname
            if gp.is_file():
                st = gp.stat()
                size_kb = round(st.st_size / 1024.0, 2)
                governance_files.append(
                    {
                        "scope": scope_label,
                        "path": str(gp),
                        "size_kb": size_kb,
                        "mtime": st.st_mtime,
                        "mtime_str": fmt_ts(st.st_mtime),
                    }
                )
                if gname == "AGENTS.md" and size_kb >= AGENTS_WARN_KB:
                    warnings.append(
                        f"[AGENTS_SIZE_WARNING] {gp} is {size_kb:.2f} KB (hard cap: {AGENTS_HARD_CAP_KB:.0f} KB). Never append routine logs."
                    )

        rp = base / "README.md"
        if rp.is_file():
            st = rp.stat()
            readmes.append(
                {
                    "scope": scope_label,
                    "path": str(rp),
                    "size_kb": round(st.st_size / 1024.0, 2),
                    "mtime": st.st_mtime,
                    "mtime_str": fmt_ts(st.st_mtime),
                }
            )

        for ename in ENV_CONFIG_FILENAMES:
            ep = base / ename
            if ep.is_file():
                st = ep.stat()
                env_configs.append(
                    {
                        "scope": scope_label,
                        "path": str(ep),
                        "mtime_str": fmt_ts(st.st_mtime),
                    }
                )
                if ename == "pyproject.toml":
                    pyproject_hints.append(parse_pyproject_hint(ep))

        assets_toml = base / ".actiongraft" / "assets.toml"
        if assets_toml.is_file():
            env_configs.append(
                {
                    "scope": scope_label,
                    "path": str(assets_toml),
                    "mtime_str": fmt_ts(assets_toml.stat().st_mtime),
                }
            )

    git_repos: list[dict[str, Any]] = []
    for base in candidate_subrepos:
        ginfo = inspect_git_repo(base)
        if ginfo is not None:
            git_repos.append(ginfo)

    # 3. Bounded fast traversal for Active Workstreams & Canonical Anchor Files
    anchor_files: list[dict[str, Any]] = []
    live_hot_files: list[dict[str, Any]] = []
    workstream_map: dict[str, dict[str, Any]] = {}
    newest_signal_mtime: float = 0.0

    def record_workstream(ws_key: str, file_rel: str, mtime: float) -> None:
        cur = workstream_map.get(ws_key)
        if cur is None or mtime > cur["latest_mtime"]:
            workstream_map[ws_key] = {
                "workstream": ws_key,
                "latest_mtime": mtime,
                "latest_mtime_str": fmt_ts(mtime),
                "latest_file": file_rel,
                "recent_file_count": (cur["recent_file_count"] + 1) if cur else 1,
            }
        else:
            cur["recent_file_count"] += 1

    def walk_bounded(curr_dir: Path, rel_parts: tuple[str, ...], depth: int, max_depth: int) -> None:
        nonlocal newest_signal_mtime
        if depth > max_depth:
            return
        try:
            entries = list(os.scandir(curr_dir))
        except OSError:
            return

        # Guard against directories with thousands of timestamped dump subfolders
        subdirs: list[os.DirEntry[str]] = []
        files: list[os.DirEntry[str]] = []
        for e in entries:
            name = e.name
            if name.startswith(".") and name not in {".agents", ".agent"}:
                continue
            try:
                if e.is_dir(follow_symlinks=False):
                    if name not in SKIP_DIRS and not name.endswith("-env"):
                        subdirs.append(e)
                elif e.is_file(follow_symlinks=False):
                    files.append(e)
            except OSError:
                continue

        # Process files at this level (DirEntry.stat() is cached in Win32 FindData)
        for fentry in files:
            fname = fentry.name
            suffix = Path(fname).suffix.lower()
            if suffix in SKIP_SUFFIXES:
                continue
            try:
                st = fentry.stat(follow_symlinks=False)
            except OSError:
                continue
            mtime = st.st_mtime
            rel_str = "/".join((*rel_parts, fname))

            if mtime >= live_cutoff and fname not in NOISY_LEAF_FILENAMES:
                live_hot_files.append(
                    {
                        "rel_path": rel_str,
                        "mtime": mtime,
                        "mtime_str": fmt_ts(mtime),
                        "age_min": round((now - mtime) / 60.0, 1),
                    }
                )

            if suffix in TEXT_SIGNAL_SUFFIXES:
                newest_signal_mtime = max(newest_signal_mtime, mtime)
                # Group workstream under e.g. `work/<campaign>` or `<subrepo>/docs/plans/<date>`
                if len(rel_parts) >= 2 and rel_parts[0].lower() in WORKSTREAM_CONTAINER_NAMES and mtime >= recent_cutoff:
                    ws_key = f"{rel_parts[0]}/{rel_parts[1]}"
                    record_workstream(ws_key, rel_str, mtime)
                elif (
                    len(rel_parts) >= 3
                    and rel_parts[1].lower() in WORKSTREAM_CONTAINER_NAMES
                    and mtime >= recent_cutoff
                ):
                    ws_key = f"{rel_parts[0]}/{rel_parts[1]}/{rel_parts[2]}"
                    record_workstream(ws_key, rel_str, mtime)

                # Check if high-signal canonical anchor file (excluding noisy stdout/stderr dumps and backup/snapshot copies)
                lower_rel = "/" + rel_str.lower()
                is_backup_noise = any(
                    tok in lower_rel
                    for tok in (
                        "/before/",
                        "/before-",
                        "-before-",
                        "/backups/",
                        "/backup/",
                        "revision-before",
                        "/archive/",
                        "/archived/",
                    )
                )
                if (
                    mtime >= recent_cutoff
                    and fname.lower() not in NOISY_LEAF_FILENAMES
                    and not is_backup_noise
                    and ANCHOR_NAME_PATTERNS.search(fname)
                ):
                    ws_bucket = "/".join(rel_parts[:2]) if len(rel_parts) >= 2 else (rel_parts[0] if rel_parts else ".")
                    anchor_files.append(
                        {
                            "rel_path": rel_str,
                            "ws_bucket": ws_bucket,
                            "size_kb": round(st.st_size / 1024.0, 2),
                            "mtime": mtime,
                            "mtime_str": fmt_ts(mtime),
                        }
                    )

        # If a leaf folder has > 40 subdirectories (like timestamped `observe-*` runs), only inspect top 12 newest
        if len(subdirs) > 35:
            subdirs_with_mtime: list[tuple[float, os.DirEntry[str]]] = []
            for sd in subdirs:
                try:
                    subdirs_with_mtime.append((sd.stat(follow_symlinks=False).st_mtime, sd))
                except OSError:
                    continue
            subdirs_with_mtime.sort(key=lambda pair: pair[0], reverse=True)
            selected_subdirs = [pair[1] for pair in subdirs_with_mtime[:12]]
        else:
            selected_subdirs = subdirs

        for sd in selected_subdirs:
            walk_bounded(Path(sd.path), (*rel_parts, sd.name), depth + 1, max_depth)

    walk_bounded(target_dir, (), depth=0, max_depth=5)

    anchor_files.sort(key=lambda x: x["mtime"], reverse=True)
    live_hot_files.sort(key=lambda x: x["mtime"], reverse=True)
    active_workstreams = sorted(workstream_map.values(), key=lambda x: x["latest_mtime"], reverse=True)

    # Deduplicate anchors per workstream bucket & parent folder so every active workstream surfaces cleanly
    dedup_anchors: list[dict[str, Any]] = []
    per_folder_counts: dict[str, int] = {}
    per_ws_counts: dict[str, int] = {}
    for item in anchor_files:
        parent_key = str(Path(item["rel_path"]).parent)
        ws_key = item.get("ws_bucket", parent_key)
        f_cnt = per_folder_counts.get(parent_key, 0)
        w_cnt = per_ws_counts.get(ws_key, 0)
        if f_cnt < 2 and w_cnt < 3:
            clean_item = {k: v for k, v in item.items() if k != "ws_bucket"}
            dedup_anchors.append(clean_item)
            per_folder_counts[parent_key] = f_cnt + 1
            per_ws_counts[ws_key] = w_cnt + 1
        if len(dedup_anchors) >= 15:
            break

    # 4. Stale README & Live Activity Alerts
    for rm in readmes:
        if newest_signal_mtime > 0 and (newest_signal_mtime - rm["mtime"]) > 14 * 86400:
            days_lag = int((newest_signal_mtime - rm["mtime"]) // 86400)
            warnings.append(
                f"[STALE_README_WARNING] {rm['path']} ({rm['mtime_str']}) lags behind latest project receipts by ~{days_lag} days. Use README for architecture/CLI only, NOT current status."
            )

    if live_hot_files:
        warnings.append(
            f"[LIVE_ACTIVITY_ALERT] {len(live_hot_files)} file(s) modified within the last {LIVE_WRITE_MINUTES} min (newest: {live_hot_files[0]['rel_path']}, {live_hot_files[0]['age_min']}m ago). Check for concurrent Workers/daemons before mutating state!"
        )

    # 5. Classify Project Onboarding State
    has_project_agents = any(g["scope"] != "global_root" and g["path"].endswith("AGENTS.md") for g in governance_files)
    if registry_matches and has_project_agents:
        project_state = "STATE_A_REGISTERED"
        state_desc = "Registered Research_Hub project with local AGENTS.md governance."
    elif active_workstreams or dedup_anchors or any(g["modified_count"] > 0 for g in git_repos) or has_project_agents:
        project_state = "STATE_B_UNREGISTERED_ACTIVE"
        state_desc = "Active or mid-flight workspace without complete REGISTRY.md + AGENTS.md binding."
    else:
        project_state = "STATE_C_NEW_OR_BARE"
        state_desc = "Fresh or bare repository needing architecture mapping and optional AGENTS.md bootstrap."

    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)

    return {
        "scouted_at": fmt_ts(now),
        "elapsed_ms": elapsed_ms,
        "workspace": str(target_dir),
        "project_state": project_state,
        "project_state_description": state_desc,
        "registry_matches": registry_matches,
        "warnings": warnings,
        "governance_files": governance_files,
        "readmes": readmes,
        "environment": {
            "local_virtualenvs": local_envs,
            "config_files": env_configs,
            "pyproject_hints": pyproject_hints,
        },
        "git_repos": git_repos,
        "active_workstreams": active_workstreams[:12],
        "canonical_anchor_files": dedup_anchors,
        "live_hot_files": live_hot_files[:8],
        "top_level_dirs": top_dirs[:18],
    }


def render_markdown(report: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append(f"# Project Onboarding Scout Digest (`{report['workspace']}`)")
    lines.append(
        f"- **Scouted At**: `{report['scouted_at']}` (`{report['elapsed_ms']} ms`, read-only, zero-SHA256)"
    )
    lines.append(
        f"- **Onboarding State**: **`{report['project_state']}`** — {report['project_state_description']}"
    )

    if report["warnings"]:
        lines.append("\n## 0. Alerts & Hazard Checks")
        for w in report["warnings"]:
            lines.append(f"- {w}")

    lines.append("\n## 1. Research_Hub Registry Binding")
    if report["registry_matches"]:
        for m in report["registry_matches"]:
            lines.append(
                f"- **`{m['key']}`** ({m['project']} · {m['team']}) | Drive Folder: `{m['drive_folder_id']}` | "
                f"`01_Logbook`: `{m['logbook_doc_id']}` | `02_Studio`: `{m['studio_doc_id']}` | "
                f"`03_CodeSnapshot`: `{m['codesnapshot_file_id']}`"
            )
    else:
        lines.append("- *Not registered in `E:\\Project\\REGISTRY.md`.*")

    lines.append("\n## 2. Governance, Architecture & Environment")
    if report["governance_files"]:
        for g in report["governance_files"]:
            lines.append(f"- **Governance** [{g['scope']}]: `{g['path']}` (`{g['size_kb']} KB`, mtime `{g['mtime_str']}`)")
    else:
        lines.append("- **Governance**: *No project `AGENTS.md` / `CLAUDE.md` found.*")

    for r in report["readmes"]:
        lines.append(f"- **README** [{r['scope']}]: `{r['path']}` (`{r['size_kb']} KB`, mtime `{r['mtime_str']}`)")

    env = report["environment"]
    if env["local_virtualenvs"]:
        lines.append(f"- **Local Virtualenvs**: `{', '.join(env['local_virtualenvs'])}`")
    for ph in env["pyproject_hints"]:
        cli_str = ", ".join(f"{k}={v}" for k, v in ph.get("cli_entrypoints", {}).items()) or "none"
        lines.append(
            f"- **Python Package**: `{ph.get('package_name', 'unknown')}` (`{ph['path']}`, Python `{ph.get('requires_python', 'unspecified')}`, CLI: `{cli_str}`)"
        )
    for ec in env["config_files"]:
        if not ec["path"].endswith("pyproject.toml"):
            lines.append(f"- **Env/Build Config** [{ec['scope']}]: `{ec['path']}` (mtime `{ec['mtime_str']}`)")

    lines.append("\n## 3. Git Repositories & Working Tree Health")
    if report["git_repos"]:
        for gr in report["git_repos"]:
            lines.append(
                f"- **Repo**: `{gr['repo_path']}` | Branch: `{gr['branch']}` | "
                f"Staged: `{gr['staged_count']}`, Modified: `{gr['modified_count']}`, Untracked (top): `{gr['untracked_count']}`"
            )
            for ds in gr.get("dirty_tracked_samples", [])[:6]:
                lines.append(f"  - `[{ds['status']}]` `{ds['file']}` (mtime `{ds['mtime']}`)")
    else:
        lines.append("- *No `.git` repository detected at root or 1-level subdirectories.*")

    lines.append("\n## 4. Recently Active Workstreams (L2 Recency)")
    if report["active_workstreams"]:
        for ws in report["active_workstreams"]:
            lines.append(
                f"- **`{ws['workstream']}`** — latest `{ws['latest_mtime_str']}` (`{ws['recent_file_count']}` recent signal files; newest: `{ws['latest_file']}`)"
            )
    else:
        lines.append("- *No recent workstream folders detected within the lookback window.*")

    lines.append("\n## 5. High-Signal Canonical Anchor Files (Read Top 3-6 First)")
    if report["canonical_anchor_files"]:
        for af in report["canonical_anchor_files"]:
            lines.append(f"- `{af['rel_path']}` (`{af['size_kb']} KB`, mtime `{af['mtime_str']}`)")
    else:
        lines.append("- *No recent status/diagnosis/plan anchor files matched.*")

    lines.append("\n## 6. Top-Level Directories (by mtime)")
    if report["top_level_dirs"]:
        dir_summ = ", ".join(f"`{d['name']}/` ({d['mtime_str'][:10]})" for d in report["top_level_dirs"][:12])
        lines.append(f"- {dir_summ}")

    return "\n".join(lines)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Fast read-only onboarding scout for project workspaces.")
    parser.add_argument("--path", default=".", help="Target workspace directory (defaults to CWD).")
    parser.add_argument("--registry", default=str(DEFAULT_REGISTRY), help="Path to Research_Hub REGISTRY.md.")
    parser.add_argument("--days", type=int, default=10, help="Lookback days for active workstreams/anchors (default: 10).")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of Markdown.")
    args = parser.parse_args()

    report = scout_workspace(Path(args.path), Path(args.registry), recent_days=args.days)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(render_markdown(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
