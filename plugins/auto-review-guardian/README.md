# Auto-Review Security Guardian (`auto-review-guardian`)

受 Codex `auto_review` 启发、专为 **Google Antigravity** 打造的 `PreToolUse` 生命周期安全守卫插件（Hook）。在开启高效率自动执行（Turbo / Eager）模式的同时，实现**“日常只读与工作区内开发 0 打扰秒放行，高危破坏/外发/越权改配置 100% 强制弹窗确认”**。

## 🛡️ 分级防护矩阵

| 操作类别 | 示例命令 / 工具调用 | Guardian 决策 |
| :--- | :--- | :--- |
| **安全只读与 `--help` 探测** | `git status/diff/log`, `rg`, `Get-ChildItem`, `gdocs readonly read`, `gmail readonly search`, 任意 `--help` | ✅ `allow`（静默秒过） |
| **活跃工作区与允许目录写入** | 当前打开的工作区（`workspacePaths`）、配置的 `E:/Project`、`D:/`、`~/.gemini/config/plugins/*` 普通文件读写，及安全 `_tmp` / `_work` 清理 | ✅ `allow`（支持 NTFS 软链接/Junction 真实路径解析与 PowerShell 变量追踪） |
| **毁灭性磁盘/系统级破坏** | `format D:`, `diskpart`, `bcdedit`, `vssadmin delete`, `Stop-Computer` | 🚫 `deny`（直接硬拦截） |
| **破坏性删除与强推代码** | 非临时目录 `rm -rf` / `Remove-Item -Recurse`、`shutil.rmtree`、`git push --force`、`git reset --hard`、`git clean -fd` | ⚠️ `force_ask`（强制人工确认） |
| **外发动作与云端高危变更** | `gmail mutate send/reply/delete`、`gdrive delete/share`、`gdocs delete/share`、Notion `delete-pages` MCP、远程 SSH `rm -rf` / `reboot` | ⚠️ `force_ask`（草稿 `create-draft` 放行，真发送必问） |
| **敏感凭据与守卫自保护** | 读写 `.ssh`、`.aws`、`.gnupg`、`.env`、`.codex/auth.json`、`config.json`、`hooks.json` 或尝试篡改 `antigravity_guardian.py` 自身 | ⚠️ `force_ask`（防越权逃逸） |

此外还预置了可选的 **Tier-2 AI 复核接口**（支持配置 OpenAI 兼容 HTTP API 或 `codex` CLI 对复杂未知命令做二次语义审查）以及毫秒级耗时的 JSONL 审计日志（`~/.gemini/antigravity/logs/guardian_audit.jsonl`）。

## ⚙️ 安装与自定义配置

1. **Python 环境**：需系统 `PATH` 中有 `python`（Python 3.10+，零第三方库依赖，纯标准库实现，单次判定耗时 `< 10 ms`）。若你的 Python 不在系统默认 `PATH` 中，可编辑 `hooks.json` 将 `"python"` 替换为解释器绝对路径。
2. **自定义白名单目录**：编辑 [`scripts/guardian_policy.json`](./scripts/guardian_policy.json) 中的 `allowed_write_roots` 与 `safe_tmp_delete_roots`（支持 `~/` 主目录自动展开）。
3. **运行内置单元测试验证策略**：
   ```bash
   python -B -m unittest discover -s plugins/auto-review-guardian/scripts -p "test_*.py" -v
   ```
