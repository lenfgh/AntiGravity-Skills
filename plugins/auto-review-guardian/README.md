# Auto-Review Security Guardian (`auto-review-guardian`)

面向 Google Antigravity 的 `PreToolUse` 生命周期安全审查钩子（Hook）。在开启自动执行命令（Turbo / Eager）模式时，在工具真正执行前对 `run_command`、文件写入与 MCP 调用做规则分级审查（纯 Python 标准库实现，单次判定通常 `< 10 ms`）。

## 默认规则分级

| 类别 | 匹配的典型操作 | 处理决策 |
| :--- | :--- | :--- |
| **只读与帮助查询** | `git status/diff/log`、`rg`、`Get-ChildItem`、`gdocs/gdrive/gmail/gcalendar readonly ...`、常见 CLI 的 `--help` / `--version` | `allow`（直接放行） |
| **工作区与白名单目录写入** | 当前打开的工作区（`workspacePaths`）、`guardian_policy.json` 中配置的 `allowed_write_roots`，以及安全临时目录（`_tmp`、`_work` 等）清理 | `allow`（支持解析 NTFS Junction 软链接与基础 PowerShell 变量路径） |
| **高危系统/磁盘破坏** | `format D:`、`diskpart`、`bcdedit`、`vssadmin delete`、`Stop-Computer` | `deny`（直接拒绝） |
| **非临时目录递归删除与 Git 强改** | 非临时目录的 `rm -rf` / `Remove-Item -Recurse`、`shutil.rmtree`、`git push --force`、`git reset --hard`、`git clean -fd` | `force_ask`（要求人工确认） |
| **对外发送与云端删除/共享** | `gmail mutate send/reply/delete`（仅创建草稿 `create-draft` 放行）、`gdrive/gdocs delete|share`、Notion 删除类 MCP 工具、远程 SSH `rm -rf` / `reboot` | `force_ask`（要求人工确认） |
| **敏感凭据与配置自保护** | 访问 `.ssh`、`.aws`、`.gnupg`、`.env`、`.codex/auth.json`，或修改 `config.json`、`hooks.json`、`antigravity_guardian.py`、`guardian_policy.json` | `force_ask`（要求人工确认） |

此外，`guardian_policy.json` 中预留了可选的 `ai_reviewer`（Tier-2 二次审查，支持配置 OpenAI 兼容 HTTP 接口或调用 `codex` CLI）以及 JSONL 审计日志输出（默认路径 `~/.gemini/antigravity/logs/guardian_audit.jsonl`，置空可关闭）。

## 安装与配置说明

1. **Python 环境**：默认通过系统 `PATH` 中的 `python` 运行（需 Python 3.10+）。若默认 `python` 不在系统 `PATH` 中，可编辑 `hooks.json` 将 `"python"` 改为解释器完整路径。
2. **修改允许写入的目录**：编辑 [`scripts/guardian_policy.json`](./scripts/guardian_policy.json) 中的 `allowed_write_roots` 与 `safe_tmp_delete_roots`（支持 `~/` 主目录自动展开）。
3. **运行单元测试**：修改策略或脚本后，可运行内置单元测试验证规则行为：
   ```bash
   python -B -m unittest discover -s plugins/auto-review-guardian/scripts -p "test_*.py" -v
   ```
