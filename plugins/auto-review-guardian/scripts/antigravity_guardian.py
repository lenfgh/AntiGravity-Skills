"""Antigravity PreToolUse Guardian implementing a Plan C rule-based reviewer
with pre-wired Tier-2 AI reviewer hooks (HTTP API / codex exec).

Reads the Antigravity PreToolUse JSON payload as UTF-8 from stdin and writes a
UTF-8 JSON decision (`allow`, `deny`, or `force_ask`) to stdout.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time
from typing import Any
from urllib.parse import unquote, urlparse

DEFAULT_POLICY_PATH = Path(__file__).with_name("guardian_policy.json")

WRITE_TOOL_NAMES = {
    "write_file",
    "write_to_file",
    "edit_file",
    "replace_file_content",
    "multi_replace_file_content",
}

DELETE_COMMAND_TOKENS = {
    "rm",
    "rmdir",
    "del",
    "erase",
    "rd",
    "remove-item",
    "ri",
}

FILE_WRITE_CMDLETS = {
    "set-content",
    "add-content",
    "out-file",
    "tee-object",
    "tee",
    "clear-content",
    "clc",
    "new-item",
    "ni",
    "mkdir",
    "md",
    "touch",
    "copy-item",
    "cp",
    "copy",
    "cpi",
    "move-item",
    "mv",
    "move",
    "mi",
    "rename-item",
    "ren",
    "rni",
}

SAFE_HELP_CLIS = {
    "gdocs",
    "gdrive",
    "gcalendar",
    "gmail",
    "git",
    "codex",
    "uv",
    "pytest",
    "rg",
    "grep",
    "curl",
    "python",
    "python3",
    "py",
    "node",
    "npm",
    "npx",
    "pnpm",
    "pip",
    "conda",
    "ffmpeg",
}

SAFE_READONLY_COMMANDS = {
    "rg",
    "grep",
    "findstr",
    "where",
    "where.exe",
    "which",
    "ls",
    "dir",
    "pwd",
    "echo",
    "cat",
    "head",
    "tail",
    "wc",
    "sort",
    "uniq",
    "get-childitem",
    "gci",
    "get-content",
    "gc",
    "select-string",
    "select-object",
    "format-table",
    "format-list",
    "test-path",
    "resolve-path",
    "get-location",
    "measure-object",
    "out-null",
}

SAFE_GIT_SUBCOMMANDS = {
    "status",
    "diff",
    "log",
    "show",
    "branch",
    "rev-parse",
    "ls-files",
    "remote",
    "tag",
    "describe",
}

ENV_ASSIGN_RE = re.compile(r"^\$env:[A-Za-z_][A-Za-z0-9_]*\s*=", re.IGNORECASE)
LOCAL_VAR_ASSIGN_RE = re.compile(
    r'^\$(?!env:)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"((?:(?!\$\()[^"`])*)"|\'([^\']*)\')\s*$',
    re.IGNORECASE,
)
DERIVED_VAR_ASSIGN_RE = re.compile(
    r'^\$(?!env:)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\(?\s*(split-path|join-path)\b([^)]*?)\)?\s*$',
    re.IGNORECASE,
)


def expand_known_vars(text: str, var_map: dict[str, str]) -> str:
    """Substitute known `$var` / `${var}` values recorded earlier in the same command."""
    if not var_map or "$" not in text:
        return text

    def _repl(match: re.Match[str]) -> str:
        name = (match.group(1) or match.group(2) or "").lower()
        return var_map.get(name, match.group(0))

    return re.sub(r"(?<!`)(?:\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$(?!env:)([A-Za-z_][A-Za-z0-9_]*))", _repl, text)
SET_LOCATION_RE = re.compile(r"^(cd|sl|set-location|pushd|popd)\b", re.IGNORECASE)
SUBSHELL_RE = re.compile(r"(\$\(|`[^`]+`|\biex\b|\binvoke-expression\b)", re.IGNORECASE)
LONG_HELP_RE = re.compile(r"(?:^|\s)(--help|--version)\s*$", re.IGNORECASE)

# PowerShell flags that consume a following non-path argument token
PS_VALUE_FLAGS = {
    "-value",
    "-itemtype",
    "-type",
    "-encoding",
    "-erroraction",
    "-ea",
    "-warningaction",
    "-wa",
    "-filter",
    "-include",
    "-exclude",
    "-delimiter",
}
PS_PATH_FLAGS = {
    "-path",
    "-literalpath",
    "-filepath",
    "-destination",
    "-childpath",
    "-lp",
}


def load_policy(policy_path: Path = DEFAULT_POLICY_PATH) -> dict[str, Any]:
    """Load the Guardian policy JSON from disk."""
    with policy_path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def strip_file_uri(raw_path: str) -> str:
    """Convert a `file:///...` URI into a plain filesystem path if needed."""
    cleaned = raw_path.strip().strip("\"'")
    if cleaned.lower().startswith("file://"):
        parsed = urlparse(cleaned)
        path_part = unquote(parsed.path or "")
        if re.match(r"^/[A-Za-z]:", path_part):
            path_part = path_part[1:]
        return path_part
    return cleaned


def resolve_physical_path(path_str: str) -> str:
    """Resolve NTFS Junctions/symlinks via `os.path.realpath`, preserving wildcard tails."""
    normed = os.path.normpath(path_str)
    try:
        if "*" in normed or "?" in normed:
            parent = os.path.dirname(normed)
            leaf = os.path.basename(normed)
            resolved_parent = os.path.realpath(parent) if parent else ""
            resolved = os.path.join(resolved_parent, leaf) if resolved_parent else normed
        else:
            resolved = os.path.realpath(normed)
        if resolved.startswith("\\\\?\\"):
            resolved = resolved[4:]
        return resolved
    except OSError:
        return normed


def normalize_path_str(raw_path: str, base_cwd: str | None = None) -> str:
    """Normalize a path (resolving relative paths and NTFS Junctions) to lowercase `/`."""
    cleaned = strip_file_uri(raw_path)
    if not cleaned:
        return ""
    expanded = os.path.expandvars(os.path.expanduser(cleaned))
    is_drive_abs = bool(re.match(r"^[A-Za-z]:([/\\]|$)", expanded)) or os.path.isabs(expanded)
    is_unc = expanded.startswith(("\\\\", "//"))
    if not is_drive_abs and not is_unc and base_cwd:
        base_clean = strip_file_uri(base_cwd)
        if base_clean:
            expanded = os.path.join(os.path.expandvars(os.path.expanduser(base_clean)), expanded)
    resolved = resolve_physical_path(expanded).replace("\\", "/")
    return resolved.lower()


def is_under_root(path_norm: str, root_raw: str) -> bool:
    """Return True if `path_norm` is equal to or nested under `root_raw`."""
    root_norm = normalize_path_str(root_raw).rstrip("/")
    if not root_norm or not path_norm:
        return False
    if len(root_norm) == 2 and root_norm.endswith(":"):
        return path_norm.startswith(root_norm + "/") or path_norm == root_norm
    return path_norm == root_norm or path_norm.startswith(root_norm + "/")


def check_target_path_allowed(
    raw_target: str,
    base_cwd: str | None,
    policy: dict[str, Any],
    workspaces: list[str],
    artifact_dir: str = "",
    allow_artifact: bool = False,
) -> dict[str, str]:
    """Validate a single target write/modify path against protected and allowed roots."""
    path_norm = normalize_path_str(raw_target, base_cwd=base_cwd)
    if not path_norm:
        return {
            "decision": "force_ask",
            "tier": "rule_redline",
            "reason": "Target write path could not be determined.",
        }

    basename = Path(path_norm).name.lower()
    exact_protected = {str(n).lower() for n in policy.get("protected_exact_filenames", [])}
    if basename in exact_protected:
        return {
            "decision": "force_ask",
            "tier": "rule_redline",
            "reason": f"Target `{raw_target}` is a protected Guardian file (`{basename}`).",
        }

    for sub in policy.get("protected_path_substrings", []):
        if sub.lower() in path_norm:
            return {
                "decision": "force_ask",
                "tier": "rule_redline",
                "reason": f"Target `{raw_target}` matches protected path `{sub}`.",
            }

    if "/.gemini/antigravity/brain/" in path_norm and "/scratch/" in path_norm:
        return {
            "decision": "force_ask",
            "tier": "rule_redline",
            "reason": "Scratch writes should go to E:/ or D:/ instead of .gemini brain scratch.",
        }

    if allow_artifact and artifact_dir and is_under_root(path_norm, artifact_dir):
        return {"decision": "allow", "tier": "rule_safe", "reason": "Artifact markdown write allowed."}

    for ws in workspaces:
        if is_under_root(path_norm, ws):
            return {"decision": "allow", "tier": "rule_safe", "reason": "Write inside active workspace."}

    for root in policy.get("allowed_write_roots", []):
        if is_under_root(path_norm, root):
            return {"decision": "allow", "tier": "rule_safe", "reason": f"Write inside allowed root `{root}`."}

    return {
        "decision": "force_ask",
        "tier": "rule_redline",
        "reason": f"Write target `{raw_target}` (resolved `{path_norm}`) is outside allowed roots.",
    }


def extract_ci_args(tool_call: dict[str, Any]) -> dict[str, Any]:
    """Return a lowercase-keyed view of `toolCall.args`."""
    raw_args = tool_call.get("args")
    if not isinstance(raw_args, dict):
        return {}
    return {str(k).lower(): v for k, v in raw_args.items()}


def first_arg(args_ci: dict[str, Any], *keys: str) -> Any:
    """Return the first present non-empty value among candidate lowercase keys."""
    for key in keys:
        val = args_ci.get(key.lower())
        if val not in (None, ""):
            return val
    return None


def skip_ps_herestring(text: str, idx: int) -> int | None:
    """If `text[idx:]` starts a PowerShell here-string (`@'\n...'@` or `@"\n..."@`), return index past its end."""
    if idx + 2 < len(text) and text[idx] == "@" and text[idx + 1] in ("'", '"') and text[idx + 2] in ("\r", "\n"):
        closer = "\n" + text[idx + 1] + "@"
        end_idx = text.find(closer, idx + 2)
        return (end_idx + len(closer)) if end_idx != -1 else len(text)
    return None


def split_shell_segments(command: str) -> list[str]:
    """Split a shell command on unquoted `;`, `&&`, `||`, `|`, and newlines."""
    segments: list[str] = []
    buf: list[str] = []
    quote: str | None = None
    i = 0
    n = len(command)

    while i < n:
        ch = command[i]
        if quote is not None:
            buf.append(ch)
            if ch == "\\" and quote == '"' and i + 1 < n:
                i += 1
                buf.append(command[i])
            elif ch == quote:
                quote = None
            i += 1
            continue

        hs_end = skip_ps_herestring(command, i)
        if hs_end is not None:
            buf.append(command[i:hs_end])
            i = hs_end
            continue

        if ch in ("'", '"'):
            quote = ch
            buf.append(ch)
            i += 1
            continue

        if ch in ("\n", "\r", ";"):
            seg = "".join(buf).strip()
            if seg:
                segments.append(seg)
            buf = []
            i += 1
            continue

        if ch in ("&", "|"):
            if i + 1 < n and command[i + 1] == ch:
                seg = "".join(buf).strip()
                if seg:
                    segments.append(seg)
                buf = []
                i += 2
                continue
            if ch == "|":
                seg = "".join(buf).strip()
                if seg:
                    segments.append(seg)
                buf = []
                i += 1
                continue

        buf.append(ch)
        i += 1

    tail = "".join(buf).strip()
    if tail:
        segments.append(tail)
    return segments


def split_comma_tokens(raw_tokens: list[str]) -> list[str]:
    """Split PowerShell comma-joined argument arrays (e.g. `"a","b"` or `a,b`) into separate items."""
    result: list[str] = []
    for raw in raw_tokens:
        if raw == ",":
            continue
        parts: list[str] = []
        buf: list[str] = []
        quote: str | None = None
        for ch in raw:
            if quote is not None:
                if ch == quote:
                    quote = None
                else:
                    buf.append(ch)
            elif ch in ("'", '"'):
                quote = ch
            elif ch == ",":
                item = "".join(buf).strip()
                if item:
                    parts.append(item)
                buf = []
            else:
                buf.append(ch)
        tail = "".join(buf).strip()
        if tail:
            parts.append(tail)
        result.extend(parts)
    return result


def tokenize_segment(segment: str) -> list[str]:
    """Best-effort tokenize one shell segment, tolerating Windows paths and PS comma lists."""
    cleaned = re.sub(r"\s+\d*>&\d+|\s+\d*>>?\s*(?:\"[^\"]*\"|'[^']*'|\S+)", "", segment).strip()
    if not cleaned:
        return []
    try:
        tokens = shlex.split(cleaned, posix=False)
    except ValueError:
        tokens = cleaned.split()
    return split_comma_tokens(tokens)


def find_unquoted_redirection_targets(segment: str) -> list[str]:
    """Extract target filenames of unquoted shell `>` / `>>` redirections."""
    targets: list[str] = []
    quote: str | None = None
    i = 0
    n = len(segment)
    while i < n:
        ch = segment[i]
        if quote is not None:
            if ch == "\\" and quote == '"' and i + 1 < n:
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        hs_end = skip_ps_herestring(segment, i)
        if hs_end is not None:
            i = hs_end
            continue
        if ch in ("'", '"'):
            quote = ch
            i += 1
            continue
        if ch == ">":
            prev = segment[i - 1] if i > 0 else " "
            if prev in ("=", "-", "<"):
                i += 1
                continue
            if i + 1 < n and segment[i + 1] == "&":
                i += 2
                continue
            j = i + 2 if (i + 1 < n and segment[i + 1] == ">") else i + 1
            while j < n and segment[j].isspace():
                j += 1
            if j < n:
                if segment[j] in ("'", '"'):
                    q = segment[j]
                    k = j + 1
                    while k < n and segment[k] != q:
                        k += 1
                    targets.append(segment[j + 1 : k])
                    i = k + 1
                    continue
                k = j
                while k < n and not segment[k].isspace() and segment[k] not in ";|&":
                    k += 1
                targets.append(segment[j:k])
                i = k
                continue
        i += 1
    return targets


def check_redirect_targets(
    segment: str,
    base_cwd: str | None,
    policy: dict[str, Any],
    workspaces: list[str],
) -> dict[str, str] | None:
    """Block or ask when unquoted output redirection writes outside allowed roots."""
    for raw_target in find_unquoted_redirection_targets(segment):
        cleaned_target = raw_target.strip("\"'")
        if not cleaned_target or cleaned_target.startswith("&"):
            continue
        if cleaned_target.lower() in {"$null", "nul", "/dev/null"}:
            continue
        verdict = check_target_path_allowed(cleaned_target, base_cwd, policy, workspaces)
        if verdict["decision"] != "allow":
            return verdict
    return None


def extract_non_flag_args(tokens: list[str]) -> list[str]:
    """Extract positional/path arguments from a command token list, skipping option values."""
    args: list[str] = []
    i = 1
    while i < len(tokens):
        tok = tokens[i]
        low = tok.lower()
        if low.startswith("-"):
            if "=" in tok:
                flag_name, rhs = tok.split("=", 1)
                if flag_name.lower() in PS_PATH_FLAGS and rhs:
                    args.append(rhs)
            elif low in PS_VALUE_FLAGS:
                i += 2
                continue
            elif low in PS_PATH_FLAGS and i + 1 < len(tokens):
                args.append(tokens[i + 1])
                i += 2
                continue
            i += 1
            continue
        args.append(tok)
        i += 1
    return args


def is_safe_tmp_target(
    token: str,
    base_cwd: str | None,
    policy: dict[str, Any],
    workspaces: list[str],
) -> bool:
    """Return True if `token` resolves inside an approved `_tmp` / `_work` / cache directory."""
    if "$" in token:
        return False
    allowed_check = check_target_path_allowed(token, base_cwd, policy, workspaces)
    if allowed_check["decision"] != "allow":
        return False
    norm = normalize_path_str(token, base_cwd=base_cwd)
    allowed_tmp_roots = list(policy.get("safe_tmp_delete_roots", []))
    for ws in workspaces:
        allowed_tmp_roots.append(f"{ws}/_tmp")
        allowed_tmp_roots.append(f"{ws}/.tmp")
    if any(is_under_root(norm, root) for root in allowed_tmp_roots):
        return True
    safe_dir_names = {str(d).lower() for d in policy.get("safe_tmp_dir_names", [])}
    parts = [p for p in norm.rstrip("/*").split("/") if p]
    return any(part in safe_dir_names for part in parts[1:])


def is_recursive_delete_invocation(head_stem: str, tokens: list[str]) -> bool:
    """Return True if the delete command carries recursive directory flags (`-Recurse`, `-rf`, `/s`)."""
    for tok in tokens[1:]:
        low = tok.lower()
        if low in {"/s", "--recursive"}:
            return True
        if re.match(r"^-(?:r|rec[a-z]*)$", low):
            return True
        if head_stem == "rm" and re.match(r"^-[a-z]*r[a-z]*$", low):
            return True
    return False


def is_safe_cli_help_invocation(head_stem: str, tokens: list[str], segment: str) -> bool:
    """Return True only when a known CLI is strictly asked for `--help` / `--version`."""
    if head_stem not in SAFE_HELP_CLIS:
        return False
    # Never treat `python evil.py --help` or `node evil.js --help` as non-executing
    if head_stem in {"python", "python3", "py", "node"}:
        if any(tok.lower().endswith((".py", ".js", ".mjs", ".cjs")) or tok == "-c" for tok in tokens[1:]):
            return False
        if len(tokens) == 2 and tokens[1] in {"-V", "-v", "--version", "-h", "--help"}:
            return True
    if len(tokens) == 2 and tokens[1].lower() in {"-h", "--help", "-v", "--version"}:
        return True
    return bool(LONG_HELP_RE.search(segment))


def evaluate_gcalendar_mutate(
    subcommand: str,
    tokens: list[str],
    policy: dict[str, Any],
) -> dict[str, str]:
    """Require confirmation for calendar deletes, RSVPs, moves, or external guest notifications."""
    confirm_subs = {s.lower() for s in policy.get("gcalendar_confirm_subcommands", [])}
    if subcommand in confirm_subs:
        return {
            "decision": "force_ask",
            "tier": "rule_redline",
            "reason": f"Calendar `mutate {subcommand}` requires confirmation.",
        }

    lowered = [t.lower() for t in tokens]
    for idx, tok in enumerate(lowered):
        if tok in {"--attendee", "--optional-attendee", "--remove-attendee"} or tok.startswith(
            ("--attendee=", "--optional-attendee=", "--remove-attendee=")
        ):
            return {
                "decision": "force_ask",
                "tier": "rule_redline",
                "reason": "Calendar event with external attendees requires confirmation.",
            }
        if tok == "--send-updates" and idx + 1 < len(lowered) and lowered[idx + 1] != "none":
            return {
                "decision": "force_ask",
                "tier": "rule_redline",
                "reason": "Calendar update sending guest emails requires confirmation.",
            }
        if tok.startswith("--send-updates=") and tok.split("=", 1)[1] != "none":
            return {
                "decision": "force_ask",
                "tier": "rule_redline",
                "reason": "Calendar update sending guest emails requires confirmation.",
            }

    return {"decision": "allow", "tier": "rule_safe", "reason": "Solo calendar block allowed."}


def evaluate_plugin_cli(
    tool_name: str,
    tokens: list[str],
    segment: str,
    policy: dict[str, Any],
) -> dict[str, str] | None:
    """Evaluate `gdocs`, `gdrive`, `gcalendar`, and `gmail` plugin CLI segments."""
    if tool_name not in {"gdocs", "gdrive", "gcalendar", "gmail"}:
        return None
    if len(tokens) == 1 or is_safe_cli_help_invocation(tool_name, tokens, segment):
        return {"decision": "allow", "tier": "rule_safe", "reason": "Plugin CLI help/version check."}

    positionals = [tok.lower() for tok in tokens[1:] if not tok.startswith("-")]
    if not positionals:
        return {"decision": "allow", "tier": "rule_safe", "reason": f"{tool_name} flag check."}

    namespace = positionals[0]
    subcommand = positionals[1] if len(positionals) > 1 else ""

    if namespace == "readonly":
        return {"decision": "allow", "tier": "rule_safe", "reason": f"{tool_name} readonly allowed."}

    if namespace != "mutate":
        confirm_key = f"{tool_name}_confirm_subcommands"
        confirm_subs = {s.lower() for s in policy.get(confirm_key, [])}
        if any(pos in confirm_subs for pos in positionals):
            return {
                "decision": "force_ask",
                "tier": "rule_redline",
                "reason": f"Destructive unnamespaced `{tool_name}` command requires confirmation.",
            }
        if tool_name == "gcalendar":
            cal_check = evaluate_gcalendar_mutate(namespace, tokens, policy)
            if cal_check["decision"] != "allow":
                return cal_check
        return {"decision": "allow", "tier": "rule_safe", "reason": f"Non-destructive `{tool_name}` invocation allowed."}

    if tool_name == "gdocs":
        confirm_subs = {s.lower() for s in policy.get("gdocs_confirm_subcommands", [])}
        if subcommand in confirm_subs:
            return {
                "decision": "force_ask",
                "tier": "rule_redline",
                "reason": f"Irreversible or sharing gdocs action (`mutate {subcommand}`) requires confirmation.",
            }
        return {"decision": "allow", "tier": "rule_safe", "reason": "Routine gdocs mutate allowed."}

    if tool_name == "gdrive":
        confirm_subs = {s.lower() for s in policy.get("gdrive_confirm_subcommands", [])}
        if subcommand in confirm_subs:
            return {
                "decision": "force_ask",
                "tier": "rule_redline",
                "reason": f"Irreversible or sharing gdrive action (`mutate {subcommand}`) requires confirmation.",
            }
        return {"decision": "allow", "tier": "rule_safe", "reason": "Routine gdrive mutate allowed."}

    if tool_name == "gmail":
        confirm_subs = {s.lower() for s in policy.get("gmail_confirm_subcommands", [])}
        if subcommand in confirm_subs:
            return {
                "decision": "force_ask",
                "tier": "rule_redline",
                "reason": f"Outbound or destructive gmail action (`mutate {subcommand}`) requires confirmation.",
            }
        return {"decision": "allow", "tier": "rule_safe", "reason": "Draft/safe gmail mutate allowed."}

    return evaluate_gcalendar_mutate(subcommand, tokens, policy)


def is_root_boundary(norm_path: str, workspaces: list[str], policy: dict[str, Any]) -> bool:
    """Return True if `norm_path` is itself a workspace root or allowed root."""
    trimmed = norm_path.rstrip("/")
    roots = list(workspaces) + list(policy.get("allowed_write_roots", []))
    return any(trimmed == normalize_path_str(r).rstrip("/") for r in roots if r)


def is_safe_dynamic_nonrecursive_target(
    tok: str,
    base_cwd: str | None,
    policy: dict[str, Any],
    workspaces: list[str],
) -> bool:
    """Allow non-recursive file deletion like `$dir\\page_*.png` when cwd is approved and filename is specific."""
    if not base_cwd or check_target_path_allowed(base_cwd, None, policy, workspaces)["decision"] != "allow":
        return False
    norm = tok.strip().strip("\"'").replace("\\", "/").lower()
    if norm.startswith("c:") or norm.startswith("/windows") or "$(" in norm:
        return False
    basename = Path(norm).name
    if not basename or basename in {"*", "*.*"} or basename.startswith("$"):
        return False
    exact_protected = {str(n).lower() for n in policy.get("protected_exact_filenames", [])}
    if basename in exact_protected:
        return False
    for sub in policy.get("protected_path_substrings", []):
        if sub.lower() in norm:
            return False
    return True


def evaluate_delete_segment(
    head_stem: str,
    tokens: list[str],
    base_cwd: str | None,
    policy: dict[str, Any],
    workspaces: list[str],
) -> dict[str, str]:
    """Allow deletions in `_tmp`/`_work` dirs or non-recursive specific file deletes inside allowed roots."""
    targets = extract_non_flag_args(tokens)
    if not targets:
        return {
            "decision": "force_ask",
            "tier": "rule_redline",
            "reason": "Deletion with missing target requires confirmation.",
        }

    is_recursive = is_recursive_delete_invocation(head_stem, tokens) or head_stem in {"rmdir", "rd"}
    has_unresolved_var = any("$" in tok for tok in targets)

    if not has_unresolved_var and all(is_safe_tmp_target(tok, base_cwd, policy, workspaces) for tok in targets):
        return {"decision": "allow", "tier": "rule_safe", "reason": "Deletion scoped to approved temp/work folder."}

    if is_recursive:
        return {
            "decision": "force_ask",
            "tier": "rule_redline",
            "reason": "Recursive or directory deletion outside _tmp/_work requires confirmation.",
        }

    for tok in targets:
        if "$" in tok:
            if not is_safe_dynamic_nonrecursive_target(tok, base_cwd, policy, workspaces):
                return {
                    "decision": "force_ask",
                    "tier": "rule_redline",
                    "reason": f"Dynamic-variable deletion (`{tok}`) requires confirmation.",
                }
            continue
        norm = normalize_path_str(tok, base_cwd=base_cwd)
        if Path(norm).name in {"*", "*.*"} or is_root_boundary(norm, workspaces, policy):
            return {
                "decision": "force_ask",
                "tier": "rule_redline",
                "reason": f"Broad wildcard or root deletion (`{tok}`) requires confirmation.",
            }
        verdict = check_target_path_allowed(tok, base_cwd, policy, workspaces)
        if verdict["decision"] != "allow":
            return {
                "decision": "force_ask",
                "tier": "rule_redline",
                "reason": f"File deletion outside allowed roots (`{tok}`) requires confirmation.",
            }

    return {"decision": "allow", "tier": "rule_safe", "reason": "Non-recursive file deletion inside approved root."}


def extract_explicit_flag_value(tokens: list[str], flag_names: set[str]) -> str | None:
    """Return the argument passed to an explicit named flag (e.g. `-Destination`), if any."""
    for idx, tok in enumerate(tokens[1:], start=1):
        low = tok.lower()
        if "=" in tok:
            fname, rhs = tok.split("=", 1)
            if fname.lower() in flag_names and rhs:
                return rhs
        elif low in flag_names and idx + 1 < len(tokens):
            return tokens[idx + 1]
    return None


def evaluate_file_write_cmdlet(
    head_stem: str,
    tokens: list[str],
    base_cwd: str | None,
    policy: dict[str, Any],
    workspaces: list[str],
) -> dict[str, str]:
    """Validate destination paths for shell/PowerShell file-writing & copy/move commands."""
    args = extract_non_flag_args(tokens)
    if not args:
        return {
            "decision": "force_ask",
            "tier": "rule_redline",
            "reason": f"Could not determine write target for `{head_stem}`.",
        }

    explicit_dest = extract_explicit_flag_value(tokens, {"-destination"})
    if head_stem in {"copy-item", "cp", "copy", "cpi"}:
        if explicit_dest:
            paths_to_check = [explicit_dest]
        elif len(args) >= 2:
            paths_to_check = [args[-1]]
        else:
            paths_to_check = args
    elif head_stem in {"set-content", "add-content"}:
        # Positional arg 0 is Path; positional arg 1 (if present without -Value) is Value
        paths_to_check = [args[0]]
    else:
        paths_to_check = args

    for target in paths_to_check:
        verdict = check_target_path_allowed(target, base_cwd, policy, workspaces)
        if verdict["decision"] != "allow":
            return verdict

    return {"decision": "allow", "tier": "rule_safe", "reason": f"Allowed `{head_stem}` inside approved roots."}


def is_safe_remote_tmp_path(raw_target: str, policy: dict[str, Any]) -> bool:
    """Return True if a remote SSH `rm -rf` target is strictly a temp/work/`.parts*` path."""
    norm = raw_target.strip().strip("\"'").replace("\\", "/")
    if not norm or "$" in norm or "`" in norm:
        return False
    parts = [p for p in norm.split("/") if p]
    if not parts or ".." in parts:
        return False
    low_norm = norm.lower()
    if low_norm.startswith(("/tmp/", "/var/tmp/")):
        trimmed = low_norm.rstrip("/")
        if trimmed in {"/tmp", "/var/tmp"}:
            return False
        if len(parts) == 2 and parts[1] in {"*", "*.*"}:
            return False
        return True
    safe_names = {str(d).lower() for d in policy.get("safe_tmp_dir_names", [])}
    low_parts = [p.lower().rstrip("*") for p in parts]
    for idx, raw_part in enumerate(parts):
        lp = raw_part.lower()
        if lp.startswith((".parts", "_parts")):
            return True
        if idx >= 1 and low_parts[idx] in safe_names:
            return True
    return False


def evaluate_ssh_segment(tokens: list[str], policy: dict[str, Any]) -> dict[str, str]:
    """Inspect remote commands passed to `ssh` for destructive operations."""
    remote_pattern = str(policy.get("ssh_remote_confirm_regex") or "")
    joined_tail = " ".join(tokens[1:])
    if remote_pattern and re.search(remote_pattern, joined_tail):
        return {
            "decision": "force_ask",
            "tier": "rule_redline",
            "reason": "Destructive remote SSH command requires confirmation.",
        }

    for rm_match in re.finditer(r"(?i)(?:^|[\s;|&('\"])rm\s+([^\n;|&'\"]+)", joined_tail):
        rtokens = ["rm"] + tokenize_segment(rm_match.group(1))
        if is_recursive_delete_invocation("rm", rtokens):
            rtargets = [t for t in rtokens[1:] if not t.startswith("-")]
            if not rtargets or not all(is_safe_remote_tmp_path(t, policy) for t in rtargets):
                return {
                    "decision": "force_ask",
                    "tier": "rule_redline",
                    "reason": "Remote SSH recursive `rm` outside temp/.parts directories requires confirmation.",
                }

    return {"decision": "uncertain", "tier": "tier2_candidate", "reason": "Routine SSH command."}


def update_cwd_from_segment(segment: str, tokens: list[str], current_cwd: str | None) -> str | None:
    """Return updated working directory if segment is `cd` / `Set-Location`."""
    if not SET_LOCATION_RE.match(segment):
        return current_cwd
    args = extract_non_flag_args(tokens)
    if not args:
        return current_cwd
    return normalize_path_str(args[0], base_cwd=current_cwd)


def evaluate_segment(
    segment: str,
    base_cwd: str | None,
    policy: dict[str, Any],
    workspaces: list[str],
) -> tuple[dict[str, str], str | None]:
    """Evaluate a single parsed command segment and return `(verdict, next_cwd)`."""
    redir_verdict = check_redirect_targets(segment, base_cwd, policy, workspaces)
    if redir_verdict is not None:
        return redir_verdict, base_cwd

    if ENV_ASSIGN_RE.match(segment):
        return {"decision": "allow", "tier": "rule_safe", "reason": "Env variable assignment."}, base_cwd

    tokens = tokenize_segment(segment)
    if not tokens:
        return {"decision": "allow", "tier": "rule_safe", "reason": "Empty segment."}, base_cwd

    if SET_LOCATION_RE.match(segment):
        next_cwd = update_cwd_from_segment(segment, tokens, base_cwd)
        return {"decision": "allow", "tier": "rule_safe", "reason": "Directory change."}, next_cwd

    if tokens[0] == "&" and len(tokens) > 1:
        tokens = tokens[1:]

    head_base = Path(tokens[0]).name.lower()
    head_stem = head_base.rsplit(".", 1)[0] if head_base.endswith((".exe", ".cmd", ".bat")) else head_base

    # Check delete and file-write commands BEFORE any help-flag shortcut
    if head_stem in DELETE_COMMAND_TOKENS:
        return evaluate_delete_segment(head_stem, tokens, base_cwd, policy, workspaces), base_cwd

    if head_stem in FILE_WRITE_CMDLETS:
        return evaluate_file_write_cmdlet(head_stem, tokens, base_cwd, policy, workspaces), base_cwd

    plugin_verdict = evaluate_plugin_cli(head_stem, tokens, segment, policy)
    if plugin_verdict is not None:
        return plugin_verdict, base_cwd

    if is_safe_cli_help_invocation(head_stem, tokens, segment):
        return {"decision": "allow", "tier": "rule_safe", "reason": "Safe CLI help/version check."}, base_cwd

    if head_stem in SAFE_READONLY_COMMANDS:
        return {"decision": "allow", "tier": "rule_safe", "reason": f"Safe readonly command `{head_stem}`."}, base_cwd

    if head_stem == "ssh":
        return evaluate_ssh_segment(tokens, policy), base_cwd

    if head_stem == "git":
        sub = tokens[1].lower() if len(tokens) > 1 else ""
        if sub in SAFE_GIT_SUBCOMMANDS:
            return {"decision": "allow", "tier": "rule_safe", "reason": f"Safe git `{sub}`."}, base_cwd
        return {"decision": "uncertain", "tier": "tier2_candidate", "reason": f"Mutating git `{sub}`."}, base_cwd

    return {"decision": "uncertain", "tier": "tier2_candidate", "reason": f"General command `{head_stem}`."}, base_cwd


def evaluate_write_tool(payload: dict[str, Any], policy: dict[str, Any]) -> dict[str, str]:
    """Evaluate file write/edit tools against workspace, C-drive, and protected paths."""
    args_ci = extract_ci_args(payload.get("toolCall", {}))
    raw_path = str(first_arg(args_ci, "path", "targetfile", "target_file", "file_path") or "")
    workspaces = [str(p) for p in payload.get("workspacePaths", []) if p]
    base_cwd = str(payload.get("cwd") or (workspaces[0] if workspaces else "") or "")
    artifact_dir = str(payload.get("artifactDirectoryPath") or "")
    return check_target_path_allowed(
        raw_path,
        base_cwd=base_cwd or None,
        policy=policy,
        workspaces=workspaces,
        artifact_dir=artifact_dir,
        allow_artifact=True,
    )


def evaluate_mcp_tool(payload: dict[str, Any], policy: dict[str, Any]) -> dict[str, str]:
    """Require confirmation for destructive MCP tools (e.g. Notion delete-pages/databases)."""
    tool_call = payload.get("toolCall", {})
    outer_name = str(tool_call.get("name") or "")
    args_ci = extract_ci_args(tool_call)
    inner_name = str(first_arg(args_ci, "toolname", "tool_name", "name") or "")
    combined_name = f"{outer_name}:{inner_name}"

    pattern = str(policy.get("mcp_confirm_tool_regex") or "")
    if pattern and re.search(pattern, combined_name):
        return {
            "decision": "force_ask",
            "tier": "rule_redline",
            "reason": f"Destructive or high-impact MCP tool (`{inner_name or outer_name}`) requires confirmation.",
        }
    return {"decision": "allow", "tier": "rule_safe", "reason": "Routine MCP call allowed."}


def call_tier2_http_api(payload: dict[str, Any], policy: dict[str, Any]) -> dict[str, str]:
    """Optional Tier-2 HTTP API semantic reviewer (pre-wired for future Plan A upgrade)."""
    cfg = policy.get("ai_reviewer", {}).get("http_api", {})
    endpoint = str(cfg.get("endpoint") or "").strip()
    api_key = os.environ.get(str(cfg.get("api_key_env") or "GUARDIAN_API_KEY"), "").strip()
    if not endpoint or not api_key:
        return {
            "decision": policy.get("ai_reviewer", {}).get("fail_decision", "force_ask"),
            "tier": "tier2_unavailable",
            "reason": "Tier-2 HTTP reviewer not configured.",
        }

    import requests

    reviewer_prompt = (
        f"{policy.get('ai_reviewer', {}).get('policy_prompt', '')}\n\n"
        f"User input: {payload.get('lastUserInput', '')}\n"
        f"Workspaces: {payload.get('workspacePaths', [])}\n"
        f"ToolCall: {json.dumps(payload.get('toolCall', {}), ensure_ascii=False)}\n"
        'Return strict JSON: {"decision":"allow|force_ask|deny","reason":"..."}'
    )
    resp = requests.post(
        endpoint,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": cfg.get("model", "gemini-3.5-flash-lite"),
            "messages": [{"role": "user", "content": reviewer_prompt}],
            "temperature": 0,
        },
        timeout=float(cfg.get("timeout_sec", 8)),
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    parsed = json.loads(content)
    decision = parsed.get("decision", "force_ask")
    if decision not in {"allow", "force_ask", "deny"}:
        decision = "force_ask"
    return {
        "decision": decision,
        "tier": "tier2_http_api",
        "reason": str(parsed.get("reason") or "Reviewed by Tier-2 HTTP Guardian."),
    }


def call_tier2_codex_cli(payload: dict[str, Any], policy: dict[str, Any]) -> dict[str, str]:
    """Optional Tier-2 Codex CLI reviewer (pre-wired for future Plan B upgrade)."""
    cfg = policy.get("ai_reviewer", {}).get("codex_cli", {})
    cmd = [
        str(cfg.get("command") or "codex"),
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "-s",
        "read-only",
    ]
    if cfg.get("model"):
        cmd.extend(["-m", str(cfg["model"])])

    prompt = (
        "Act as a strict security reviewer. Reply ONLY with a single JSON object "
        '{"decision":"allow|force_ask|deny","reason":"short reason"}.\n'
        f"Policy: {policy.get('ai_reviewer', {}).get('policy_prompt', '')}\n"
        f"User input: {payload.get('lastUserInput', '')}\n"
        f"ToolCall: {json.dumps(payload.get('toolCall', {}), ensure_ascii=False)}"
    )
    proc = subprocess.run(
        cmd + [prompt],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=float(cfg.get("timeout_sec", 15)),
        check=False,
    )
    if proc.returncode != 0 or not proc.stdout.strip():
        return {
            "decision": policy.get("ai_reviewer", {}).get("fail_decision", "force_ask"),
            "tier": "tier2_codex_error",
            "reason": f"Codex reviewer exited with code {proc.returncode}.",
        }
    match = re.search(r"\{.*\}", proc.stdout, re.DOTALL)
    if not match:
        return {
            "decision": policy.get("ai_reviewer", {}).get("fail_decision", "force_ask"),
            "tier": "tier2_codex_parse_error",
            "reason": "Codex reviewer did not return valid JSON.",
        }
    parsed = json.loads(match.group(0))
    decision = parsed.get("decision", "force_ask")
    if decision not in {"allow", "force_ask", "deny"}:
        decision = "force_ask"
    return {
        "decision": decision,
        "tier": "tier2_codex_cli",
        "reason": str(parsed.get("reason") or "Reviewed by Codex Guardian."),
    }


def resolve_uncertain_command(payload: dict[str, Any], policy: dict[str, Any]) -> dict[str, str]:
    """Handle commands that did not match Tier-1 safe rules or hard redlines."""
    mode = str(policy.get("ai_reviewer", {}).get("mode") or "none").lower()
    if mode == "http_api":
        try:
            return call_tier2_http_api(payload, policy)
        except Exception as exc:  # noqa: BLE001
            return {
                "decision": policy.get("ai_reviewer", {}).get("fail_decision", "force_ask"),
                "tier": "tier2_http_error",
                "reason": f"Tier-2 HTTP review failed ({exc}); requesting confirmation.",
            }
    if mode == "codex_cli":
        try:
            return call_tier2_codex_cli(payload, policy)
        except Exception as exc:  # noqa: BLE001
            return {
                "decision": policy.get("ai_reviewer", {}).get("fail_decision", "force_ask"),
                "tier": "tier2_codex_error",
                "reason": f"Tier-2 Codex review failed ({exc}); requesting confirmation.",
            }

    default_decision = str(policy.get("default_unknown_command_decision") or "allow")
    if default_decision not in {"allow", "force_ask", "deny"}:
        default_decision = "force_ask"
    return {
        "decision": default_decision,
        "tier": "tier1_default",
        "reason": "No Tier-1 redline matched; applied Plan C default policy.",
    }


def evaluate_run_command(payload: dict[str, Any], policy: dict[str, Any]) -> dict[str, str]:
    """Evaluate a `run_command` tool call through Tier-1 rules and optional Tier-2."""
    args_ci = extract_ci_args(payload.get("toolCall", {}))
    command = str(first_arg(args_ci, "commandline", "command_line", "command") or "")
    if not command.strip():
        return {"decision": "allow", "tier": "rule_safe", "reason": "Empty command."}

    for rule in policy.get("confirm_if_raw_regex", []):
        if re.search(rule["pattern"], command):
            return {
                "decision": rule.get("decision", "force_ask"),
                "tier": "rule_redline",
                "reason": rule.get("reason", "Matched Guardian security rule."),
            }

    has_subshell = bool(SUBSHELL_RE.search(command))
    workspaces = [str(p) for p in payload.get("workspacePaths", []) if p]
    cmd_cwd = str(first_arg(args_ci, "cwd") or payload.get("cwd") or (workspaces[0] if workspaces else "") or "")
    current_cwd: str | None = cmd_cwd or None

    segments = split_shell_segments(command)
    verdicts: list[dict[str, str]] = []
    var_map: dict[str, str] = {}
    for raw_seg in segments:
        var_match = LOCAL_VAR_ASSIGN_RE.match(raw_seg)
        if var_match:
            var_name = var_match.group(1).lower()
            var_val = var_match.group(2) if var_match.group(2) is not None else (var_match.group(3) or "")
            var_map[var_name] = expand_known_vars(var_val, var_map)
            verdicts.append({"decision": "allow", "tier": "rule_safe", "reason": "Local variable assignment."})
            continue
        derived_match = DERIVED_VAR_ASSIGN_RE.match(raw_seg)
        if derived_match:
            var_name = derived_match.group(1).lower()
            fn_name = derived_match.group(2).lower()
            expanded_rhs = expand_known_vars(f"{fn_name} {derived_match.group(3)}", var_map)
            rhs_tokens = tokenize_segment(expanded_rhs)
            rhs_args = extract_non_flag_args(rhs_tokens)
            lowered_flags = {t.lower() for t in rhs_tokens[1:] if t.startswith("-")}
            if fn_name == "split-path" and rhs_args and "$" not in rhs_args[0] and not (lowered_flags & {"-leaf", "-qualifier"}):
                var_map[var_name] = str(Path(rhs_args[0]).parent)
                verdicts.append({"decision": "allow", "tier": "rule_safe", "reason": "Split-Path variable derivation."})
                continue
            if fn_name == "join-path" and len(rhs_args) >= 2 and all("$" not in a for a in rhs_args[:2]):
                var_map[var_name] = os.path.join(rhs_args[0], rhs_args[1])
                verdicts.append({"decision": "allow", "tier": "rule_safe", "reason": "Join-Path variable derivation."})
                continue
        seg = expand_known_vars(raw_seg, var_map)
        verdict, current_cwd = evaluate_segment(seg, current_cwd, policy, workspaces)
        if verdict["decision"] in {"deny", "force_ask"}:
            return verdict
        verdicts.append(verdict)

    if not has_subshell and all(v["decision"] == "allow" for v in verdicts):
        return {
            "decision": "allow",
            "tier": "rule_safe",
            "reason": "All command segments matched safe Tier-1 rules.",
        }

    tamper_pattern = str(policy.get("config_tamper_regex") or "")
    if tamper_pattern and re.search(tamper_pattern, command):
        return {
            "decision": "force_ask",
            "tier": "rule_redline",
            "reason": "Command may modify Guardian or global agent configuration.",
        }

    return resolve_uncertain_command(payload, policy)


def evaluate_payload(payload: dict[str, Any], policy: dict[str, Any]) -> dict[str, str]:
    """Evaluate any PreToolUse hook payload and return `{decision, tier, reason}`."""
    tool_call = payload.get("toolCall")
    if not isinstance(tool_call, dict):
        return {"decision": "allow", "tier": "rule_safe", "reason": "No toolCall present."}

    tool_name = str(tool_call.get("name") or "").lower()
    if tool_name == "run_command":
        return evaluate_run_command(payload, policy)
    if tool_name in WRITE_TOOL_NAMES:
        return evaluate_write_tool(payload, policy)
    if tool_name == "call_mcp_tool" or tool_name.startswith("mcp_"):
        return evaluate_mcp_tool(payload, policy)
    return {"decision": "allow", "tier": "rule_safe", "reason": f"Unconstrained tool `{tool_name}`."}


def summarize_args_for_audit(tool_call: dict[str, Any]) -> dict[str, Any]:
    """Return a compact, non-bloated summary of `toolCall.args` for JSONL audit logs."""
    args_ci = extract_ci_args(tool_call)
    tool_name = str(tool_call.get("name") or "").lower()
    if tool_name == "run_command":
        cmd = str(first_arg(args_ci, "commandline", "command_line", "command") or "")
        return {"command": cmd[:500] + ("..." if len(cmd) > 500 else "")}
    if tool_name in WRITE_TOOL_NAMES:
        target = str(first_arg(args_ci, "path", "targetfile", "target_file", "file_path") or "")
        body = str(first_arg(args_ci, "content", "codecontent", "replacement") or "")
        return {"path": target, "chars": len(body)}
    if tool_name == "call_mcp_tool" or tool_name.startswith("mcp_"):
        return {
            "server": first_arg(args_ci, "servername", "server_name"),
            "tool": first_arg(args_ci, "toolname", "tool_name", "name"),
        }
    return {k: (str(v)[:120] if isinstance(v, str) else type(v).__name__) for k, v in args_ci.items()}


def append_audit_log(
    policy: dict[str, Any],
    payload: dict[str, Any],
    verdict: dict[str, str],
    elapsed_ms: float,
) -> None:
    """Append an audit entry to the configured `audit_log_path` JSONL file (best-effort)."""
    log_path_raw = policy.get("audit_log_path")
    if not log_path_raw:
        return
    try:
        log_path = Path(os.path.expandvars(os.path.expanduser(str(log_path_raw))))
        log_path.parent.mkdir(parents=True, exist_ok=True)
        tool_call = payload.get("toolCall") if isinstance(payload, dict) else {}
        safe_tc = tool_call if isinstance(tool_call, dict) else {}
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "tool": safe_tc.get("name"),
            "summary": summarize_args_for_audit(safe_tc),
            "decision": verdict["decision"],
            "tier": verdict.get("tier"),
            "reason": verdict.get("reason"),
            "elapsed_ms": round(elapsed_ms, 2),
        }
        with log_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        pass


def main() -> int:
    start = time.perf_counter()
    policy = load_policy()
    try:
        raw_bytes = sys.stdin.buffer.read()
        raw_stdin = raw_bytes.decode("utf-8", errors="replace")
        payload = json.loads(raw_stdin) if raw_stdin.strip() else {}
        verdict = evaluate_payload(payload, policy)
    except Exception as exc:  # noqa: BLE001
        payload = {}
        verdict = {
            "decision": "force_ask",
            "tier": "parse_error",
            "reason": f"Guardian hook error ({exc}); requesting manual confirmation.",
        }

    elapsed_ms = (time.perf_counter() - start) * 1000.0
    append_audit_log(policy, payload, verdict, elapsed_ms)

    output: dict[str, Any] = {"decision": verdict["decision"]}
    if verdict["decision"] != "allow" and verdict.get("reason"):
        output["reason"] = verdict["reason"]

    sys.stdout.buffer.write((json.dumps(output, ensure_ascii=False) + "\n").encode("utf-8"))
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
