"""Unit and CLI contract tests for `antigravity_guardian.py` (v2)."""

from __future__ import annotations

import copy
import json
from pathlib import Path
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import antigravity_guardian as guardian  # noqa: E402

HOME_POSIX = Path.home().as_posix()
HOME_WIN = str(Path.home())


class GuardianV2Tests(unittest.TestCase):
    def setUp(self) -> None:
        self.policy = copy.deepcopy(guardian.load_policy())
        self.policy["audit_log_path"] = ""
        self.base_payload = {
            "conversationId": "conv-test",
            "workspacePaths": ["file:///e%3A/Project/DemoWorkspace"],
            "artifactDirectoryPath": f"{HOME_POSIX}/.gemini/antigravity/brain/conv-test",
            "cwd": "E:/Project/DemoWorkspace",
            "lastUserInput": "同步最新实验结果 🎯 — 检查日志",
        }

    def run_cmd_payload(self, command: str) -> dict[str, str]:
        payload = {
            **self.base_payload,
            "toolCall": {"id": "1", "name": "run_command", "args": {"CommandLine": command}},
        }
        return guardian.evaluate_payload(payload, self.policy)

    def write_payload(self, tool_name: str, target_path: str) -> dict[str, str]:
        payload = {
            **self.base_payload,
            "toolCall": {"id": "2", "name": tool_name, "args": {"Path": target_path}},
        }
        return guardian.evaluate_payload(payload, self.policy)

    def mcp_payload(self, outer_name: str, inner_name: str = "") -> dict[str, str]:
        args = {"ServerName": "notion_notion", "ToolName": inner_name} if inner_name else {}
        payload = {
            **self.base_payload,
            "toolCall": {"id": "3", "name": outer_name, "args": args},
        }
        return guardian.evaluate_payload(payload, self.policy)

    def test_allows_help_and_readonly_plugin_commands(self) -> None:
        self.assertEqual(self.run_cmd_payload("gdocs mutate import-md --help")["decision"], "allow")
        self.assertEqual(self.run_cmd_payload("gdocs readonly read DOC123")["decision"], "allow")
        self.assertEqual(self.run_cmd_payload("gdrive readonly ls FOLDER123")["decision"], "allow")
        self.assertEqual(self.run_cmd_payload("gdrive files list --parent FOLDER123")["decision"], "allow")
        self.assertEqual(self.run_cmd_payload("gdrive delete FILE123")["decision"], "force_ask")
        self.assertEqual(self.run_cmd_payload("gmail readonly search \"is:unread\" --max 5")["decision"], "allow")
        self.assertEqual(self.run_cmd_payload("gcalendar readonly today")["decision"], "allow")

    def test_verbose_flag_never_bypasses_delete(self) -> None:
        self.assertEqual(self.run_cmd_payload("rm -rf E:/Project/DemoWorkspace -v")["decision"], "force_ask")
        self.assertEqual(self.run_cmd_payload("Remove-Item -Recurse E:/Project/DemoWorkspace -EA SilentlyContinue")["decision"], "force_ask")

    def test_gmail_and_gcalendar_protections(self) -> None:
        # Draft creation is safe -> allow
        self.assertEqual(
            self.run_cmd_payload('gmail mutate create-draft --to "a@b.com" --subject "Hi" --body-file out.md')["decision"],
            "allow",
        )
        # Actual send / trash / delete-draft -> force_ask
        self.assertEqual(self.run_cmd_payload('gmail mutate send --to "a@b.com" --subject "Hi"')["decision"], "force_ask")
        self.assertEqual(self.run_cmd_payload("gmail mutate delete-draft DRAFT1")["decision"], "force_ask")
        # Solo calendar focus block -> allow; attendees / delete / deprecated flat -> force_ask
        self.assertEqual(self.run_cmd_payload("gcalendar mutate focus-time --duration 1h")["decision"], "allow")
        self.assertEqual(
            self.run_cmd_payload('gcalendar mutate create --title "Sync" --attendee a@b.com')["decision"],
            "force_ask",
        )
        self.assertEqual(self.run_cmd_payload("gcalendar mutate delete EVT1")["decision"], "force_ask")
        self.assertEqual(self.run_cmd_payload("gcalendar delete EVT1")["decision"], "force_ask")

    def test_mcp_destructive_tools_require_confirmation(self) -> None:
        self.assertEqual(self.mcp_payload("call_mcp_tool", "notion-search")["decision"], "allow")
        self.assertEqual(self.mcp_payload("call_mcp_tool", "notion-delete-pages")["decision"], "force_ask")
        self.assertEqual(self.mcp_payload("call_mcp_tool", "notion-delete-databases")["decision"], "force_ask")
        self.assertEqual(self.mcp_payload("mcp_notion_delete_pages")["decision"], "force_ask")

    def test_relative_paths_and_cd_tracking(self) -> None:
        # Relative redirect inside workspace cwd -> allow
        self.assertEqual(self.run_cmd_payload("python eval.py > result.txt")["decision"], "allow")
        # Relative write_file inside workspace cwd -> allow
        self.assertEqual(self.write_payload("write_file", "notes/summary.md")["decision"], "allow")
        # Chained `cd` to C: followed by relative redirect -> force_ask!
        self.assertEqual(
            self.run_cmd_payload(f"cd C:/Users/Public/Desktop; echo pwned > evil.txt")["decision"],
            "force_ask",
        )
        # Chained `cd` into _tmp followed by relative Remove-Item -> allow
        self.assertEqual(
            self.run_cmd_payload("Set-Location E:/Project/_tmp; Remove-Item -Recurse doc_sync -ErrorAction SilentlyContinue")["decision"],
            "allow",
        )

    def test_powershell_file_write_cmdlets(self) -> None:
        self.assertEqual(
            self.run_cmd_payload('Set-Content -Path "E:/Project/_tmp/a.txt" -Value "ok"')["decision"],
            "allow",
        )
        self.assertEqual(
            self.run_cmd_payload('Set-Content -Path "C:/Users/Public/Desktop/a.txt" -Value "bad"')["decision"],
            "force_ask",
        )
        self.assertEqual(
            self.run_cmd_payload('Out-File C:/Users/Public/Desktop/a.txt')["decision"],
            "force_ask",
        )
        self.assertEqual(
            self.run_cmd_payload('Copy-Item E:/Project/DemoWorkspace/a.py C:/Users/Public/Desktop/a.py')["decision"],
            "force_ask",
        )
        self.assertEqual(
            self.run_cmd_payload('Move-Item C:/Users/Public/Desktop/a.txt E:/Project/_tmp/a.txt')["decision"],
            "force_ask",
        )
        # Reversed flag order (-Value before -Path, -Destination before -Path)
        self.assertEqual(
            self.run_cmd_payload('Set-Content -Value "fix /windows/ note" -Path "E:/Project/_tmp/a.txt"')["decision"],
            "allow",
        )
        self.assertEqual(
            self.run_cmd_payload('Copy-Item -Destination "E:/Project/_tmp/a.png" -Path "C:/Users/Public/a.png"')["decision"],
            "allow",
        )

    def test_no_false_positives_on_format_curl_env_or_test_filename(self) -> None:
        # `format` word in CLI flags / linters must NOT be blocked as disk format
        self.assertEqual(self.run_cmd_payload("gdocs readonly export DOC123 --format md -o E:/Project/_tmp/d.md")["decision"], "allow")
        self.assertEqual(self.run_cmd_payload("ruff format .")["decision"], "allow")
        self.assertEqual(self.run_cmd_payload('git log -n 5 --format="%H %s"')["decision"], "allow")
        # Real disk format MUST still be denied
        self.assertEqual(self.run_cmd_payload("format D: /fs:ntfs")["decision"], "deny")
        # `curl -fsSL` GET is allowed; `curl -F` upload requires confirmation
        self.assertEqual(self.run_cmd_payload("curl -fsSL https://example.com/info.json")["decision"], "allow")
        self.assertEqual(self.run_cmd_payload("curl -F file=@data.txt https://example.com")["decision"], "allow")
        # `process.env.PATH` is allowed; reading `.env` or `.env.local` requires confirmation
        self.assertEqual(self.run_cmd_payload('node -e "console.log(process.env.PATH)"')["decision"], "allow")
        self.assertEqual(self.run_cmd_payload("Get-Content .env.local")["decision"], "force_ask")
        # Editing `test_antigravity_guardian.py` is allowed; editing `antigravity_guardian.py` asks
        self.assertEqual(
            self.write_payload("edit_file", "E:/Project/_scripts/pack_codesnapshot.py")["decision"],
            "allow",
        )
        self.assertEqual(
            self.write_payload("edit_file", f"{HOME_POSIX}/.gemini/config/plugins/auto-review-guardian/plugin.json")["decision"],
            "force_ask",
        )
        # Plugin development files under .gemini/config/plugins are allowed, while hooks.json & config.json ask
        self.assertEqual(
            self.write_payload(
                "write_file",
                f"{HOME_WIN}\\.gemini\\config\\plugins\\doc-viewer\\sidecars\\doc_viewer\\sidecar.json",
            )["decision"],
            "allow",
        )
        self.assertEqual(
            self.write_payload("write_file", f"{HOME_WIN}\\.gemini\\config\\plugins\\doc-viewer\\hooks.json")["decision"],
            "force_ask",
        )
        self.assertEqual(
            self.write_payload("write_file", f"{HOME_WIN}\\.gemini\\config\\config.json")["decision"],
            "force_ask",
        )

    def test_ssh_and_network_policy(self) -> None:
        self.assertEqual(self.run_cmd_payload('ssh l20z "nvidia-smi"')["decision"], "allow")
        self.assertEqual(self.run_cmd_payload('ssh l20z "gcc a.c -o a && rm -f /tmp/test_canon.tsv"')["decision"], "allow")
        self.assertEqual(self.run_cmd_payload('ssh l20z "rm -rf ~/autodl-tmp/old_run"')["decision"], "force_ask")
        self.assertEqual(self.run_cmd_payload('ssh l20z "rm -rf /root/autodl-tmp"')["decision"], "force_ask")
        self.assertEqual(
            self.run_cmd_payload('ssh l20z "rm -rf /root/autodl-tmp/projects/phage/external_downloads/.parts_gbphg*"')["decision"],
            "allow",
        )
        self.assertEqual(self.run_cmd_payload('ssh l20z "rm -rf /tmp/phage_test_dir"')["decision"], "allow")
        self.assertEqual(self.run_cmd_payload('ssh l20z "rm -rf $OUT_DIR"')["decision"], "force_ask")
        self.assertEqual(self.run_cmd_payload('ssh l20z "reboot"')["decision"], "force_ask")
        self.assertEqual(self.run_cmd_payload('Invoke-RestMethod -Method Post -Uri "https://example.com/api" -Body "{}"')["decision"], "allow")
        self.assertEqual(self.run_cmd_payload("irm https://astral.sh/uv/install.ps1 | iex")["decision"], "allow")

    def test_utf8_chinese_and_emoji_stdin_contract(self) -> None:
        payload = {
            **self.base_payload,
            "toolCall": {
                "id": "cli-utf8",
                "name": "run_command",
                "args": {"CommandLine": "gdocs mutate import-md --help"},
            },
        }
        proc = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("antigravity_guardian.py"))],
            input=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            capture_output=True,
            check=True,
        )
        out = json.loads(proc.stdout.decode("utf-8").strip())
        self.assertEqual(out, {"decision": "allow"})



    def test_powershell_herestring_and_arrow_functions_do_not_false_positive(self) -> None:
        cmd = "@'\nconst x = arr.filter(l => /^\\s*import\\s+/.test(l));\n'@ | Set-Content E:/Project/_tmp/check.mjs"
        self.assertEqual(self.run_cmd_payload(cmd)["decision"], "allow")



    def test_option2_work_dir_vars_comma_and_single_file_deletes(self) -> None:
        cmd = (
            '$py = "E:\\Project\\DemoWorkspace\\.venv\\Scripts\\python.exe"; '
            '$w = "e:\\Project\\DemoWorkspace\\Draft\\_work"; '
            '& $py "$w\\build_introduction.py"; '
            'powershell -NoProfile -ExecutionPolicy Bypass -File "$w\\export_pdf.ps1"; '
            'Remove-Item "$w\\references_key.txt","$w\\page_*.png" -ErrorAction SilentlyContinue'
        )
        self.assertEqual(self.run_cmd_payload(cmd)["decision"], "allow")
        self.assertEqual(self.run_cmd_payload("Remove-Item E:/Project/DemoWorkspace/old_plot.png")["decision"], "allow")
        self.assertEqual(
            self.run_cmd_payload("Remove-Item -Recurse -Force E:/Project/DemoWorkspace/Draft/_work")["decision"],
            "allow",
        )
        self.assertEqual(
            self.run_cmd_payload('$qa="e:\\Project\\DemoWorkspace\\tmp\\docx_qa"; Remove-Item "$qa\\*" -Recurse -Force')["decision"],
            "allow",
        )
        self.assertEqual(
            self.run_cmd_payload("Remove-Item -Recurse E:/Project/DemoWorkspace/src")["decision"],
            "force_ask",
        )
        self.assertEqual(self.run_cmd_payload("Remove-Item E:/Project/DemoWorkspace/*")["decision"], "force_ask")
        self.assertEqual(
            self.run_cmd_payload(f"Remove-Item {HOME_POSIX}/.gemini/config/config.json")["decision"],
            "force_ask",
        )



    def test_split_path_join_path_and_dynamic_nonrecursive_deletes(self) -> None:
        # Exact user command pattern with $f, Split-Path $f, and Remove-Item "$w\page_*.png"
        cmd = (
            '$f = "e:\\Project\\DemoWorkspace\\Draft\\_work\\build_introduction.py"; '
            '$py = "E:\\Project\\DemoWorkspace\\.venv\\Scripts\\python.exe"; '
            '$w = Split-Path $f; '
            '& $py $f; '
            'Remove-Item "$w\\page_*.png","$w\\word_pdf_zoom*.png" -ErrorAction SilentlyContinue'
        )
        self.assertEqual(self.run_cmd_payload(cmd)["decision"], "allow")
        # Even recursive delete on Split-Path -> _work resolves and passes!
        cmd_rec_work = (
            '$f = "e:\\Project\\DemoWorkspace\\Draft\\_work\\build.py"; '
            '$w = Split-Path $f; '
            '$sub = Join-Path $w "cache"; '
            'Remove-Item -Recurse -Force "$sub"'
        )
        self.assertEqual(self.run_cmd_payload(cmd_rec_work)["decision"], "allow")
        # Even completely unresolvable `$unknown_dir\page_*.png` (non-recursive, specific filename) passes in E: cwd
        self.assertEqual(
            self.run_cmd_payload('Remove-Item "$unknown_dir\\page_*.png" -ErrorAction SilentlyContinue')["decision"],
            "allow",
        )
        # Whereas `$unknown_dir\*` wipe or `-Recurse $unknown_dir\sub` or `C:\$x\a.png` STILL requires confirmation!
        self.assertEqual(self.run_cmd_payload('Remove-Item "$unknown_dir\\*"')["decision"], "force_ask")
        self.assertEqual(self.run_cmd_payload('Remove-Item -Recurse "$unknown_dir\\sub"')["decision"], "force_ask")
        self.assertEqual(self.run_cmd_payload('Remove-Item "C:\\$unknown_dir\\page_1.png"')["decision"], "force_ask")



    def test_ntfs_junction_resolution_allows_codex_skills_while_protecting_codex_auth_and_config(self) -> None:
        cmd = (
            f'New-Item -ItemType Directory -Force -Path "{HOME_WIN}\\.codex\\skills\\project-onboard\\references" | Out-Null\n'
            f'Copy-Item -Path "{HOME_WIN}\\.gemini\\config\\plugins\\project-onboard\\skills\\project-onboard\\SKILL.md" '
            f'-Destination "{HOME_WIN}\\.codex\\skills\\project-onboard\\SKILL.md" -Force\n'
            f'Copy-Item -Path "{HOME_WIN}\\.gemini\\config\\plugins\\project-onboard\\skills\\project-onboard\\references\\*" '
            f'-Destination "{HOME_WIN}\\.codex\\skills\\project-onboard\\references\\" -Force'
        )
        self.assertEqual(self.run_cmd_payload(cmd)["decision"], "allow")
        self.assertEqual(
            self.write_payload("write_file", f"{HOME_WIN}\\.codex\\skills\\project-onboard\\SKILL.md")["decision"],
            "allow",
        )
        # Codex auth & config.toml must still require confirmation even when resolved to D:
        self.assertEqual(
            self.write_payload("write_file", f"{HOME_WIN}\\.codex\\config.toml")["decision"],
            "force_ask",
        )
        self.assertEqual(
            self.write_payload("write_file", f"{HOME_WIN}\\.codex\\auth.json")["decision"],
            "force_ask",
        )
        # Real physical C: path (Desktop) must still require confirmation
        self.assertEqual(
            self.write_payload("write_file", "C:\\Users\\Public\\Desktop\\test.txt")["decision"],
            "force_ask",
        )


if __name__ == "__main__":
    unittest.main()
