# Auto-Review Security Guardian (`auto-review-guardian`)

面向 Google Antigravity 的 `PreToolUse` 生命周期安全审查钩子（Hook，当前内置策略版本 **v11**）。在开启自动执行命令（Turbo / Eager）模式时，在工具真正执行前对 `run_command`、文件写改工具（`write_file`、`edit_file` 等）以及 MCP 工具（`call_mcp_tool`、`mcp_*`）进行分级判定。脚本基于纯 Python 标准库实现，单次判定通常耗时 `< 10 ms`。

## 判定决策模型

每次拦截会输出以下三种决策之一：

- `allow`：自动放行，不打断当前执行流程。
- `force_ask`：强制弹出人工确认（忽略历史“始终允许”缓存），并附上触发原因。
- `deny`：直接拒绝执行，用于明显具有系统/磁盘破坏性的命令。

## 内置规则明细（v11）

### 1. 工作区、白名单目录与文件写入保护
- **自动放行范围**：当前打开的工作区（`workspacePaths`）、`guardian_policy.json` 中配置的 `allowed_write_roots`（默认包含 `E:/Project`、`D:/` 以及 `~/.gemini/config/plugins`、`~/.codex/skills`、`~/.claude/skills` 等插件与技能目录），以及 Antigravity Artifact 目录内的 Markdown 文档写入。
- **禁止落盘路径**：默认阻止向白名单外路径（如 Windows `C:` 盘桌面/系统目录）及 `.gemini/antigravity/brain/.../scratch/` 写入。
- **NTFS Junction / 软链接穿透解析**：通过 `os.path.realpath` 统一规范物理路径后再校验——即使 `~/.gemini/config/plugins` 或 `~/.codex/skills` 通过软链接指向数据盘也可正常读写，同时不会绕过对 `.codex/auth`、`.codex/config.toml`、`config.json`、`hooks.json` 的保护。
- **Shell 重定向与 PowerShell 写入识别**：跟踪复合命令中的 `cd` / `Set-Location` 目录切换；解析未加引号的 `>` / `>>` 输出重定向与 `Set-Content`、`Add-Content`、`Out-File`、`Copy-Item`、`Move-Item`、`New-Item` 等命令的目标路径（支持 `-Destination` / `-Path` 任意参数顺序，并跳过 PowerShell Here-String `@'...'@` 内的箭头函数 `=>` 避免误报）。

### 2. 删除命令分级与动态变量追踪
- **安全临时目录递归删除放行**：目标位于 `safe_tmp_delete_roots`、当前工作区 `_tmp`/`.tmp`，或路径段包含 `safe_tmp_dir_names`（`_tmp`、`.tmp`、`_work`、`.work`、`__pycache__`、`.pytest_cache`、`.ruff_cache`、`.mypy_cache`、`tmp`、`temp`）时，允许执行 `rm -rf` / `Remove-Item -Recurse`。
- **具名非递归单文件删除放行**：在工作区或允许目录内，支持解析 PowerShell 逗号列表（如 `"a","b"`）、本地变量赋值（`$w = "..."`）及 `Split-Path` / `Join-Path` 派生路径；在安全工作目录下对 `$dir\page_*.png` 这类具名非递归临时图清理也会放行。
- **强制确认红线**：非临时目录的递归删除（`rm -rf`、`Remove-Item -Recurse`、`rmdir`、`shutil.rmtree`）、通配全清（`*` / `*.*`）、工作区根目录删除，以及指向 `C:` 盘或系统目录的动态路径删除均触发 `force_ask`。

### 3. 只读排查、配置自保护与凭据隔离（v11）
- **只读与帮助命令放行**：`rg`、`grep`、`ls`、`Get-ChildItem`、`Get-Content`、`Select-String`、`git status/diff/log/show/branch` 等只读命令，以及白名单 CLI 的 `--help` / `--version` 直接放行（不会把 `python script.py --help` 或 `node script.js --help` 误判为纯帮助）。
- **配置只读 vs 写改分离（`config_tamper_regex`）**：允许使用 `Get-Content`、`Select-String` 等纯只读命令检索 `config.json`、`hooks.json`、`antigravity_guardian.py` 排查问题；一旦通过写文件工具、`Set-Content`、内联脚本（如 `python -c "open(...)"`）或子 shell 触碰配置或 `auto-review-guardian` 目录，则触发 `force_ask`。
- **敏感凭据一律拦截**：`.ssh`、`.aws`、`.gnupg`、`.codex/auth` 以及 `.env` / `.env.local`（排除 `.env.example` / `.env.sample` / `.env.template`）位于原始命令红线中，**即使只读命令（如 `Get-Content .env.local`）也会强制确认**。

### 4. 远程 SSH 命令审查
- **硬红线拦截**：通过 `ssh` 执行远程 `rmdir`、`mkfs`、`dd if=`、`reboot`、`shutdown`、`poweroff`、`git reset --hard`、`git clean -f` 或 `find ... -delete` 时触发 `force_ask`。
- **远程 `rm -rf` 细粒度判断**：仅当目标严格位于 `/tmp/<子路径>`、`/var/tmp/<子路径>`，或路径包含 `.parts*` / `_parts*` / `safe_tmp_dir_names` 且不含未解析变量（如 `$OUT_DIR`）或 `..` 时放行；其余远程递归删除一律 `force_ask`。

### 5. Google Workspace CLI 与 MCP 工具策略
- **Google Docs / Drive (`gdocs`, `gdrive`)**：`readonly` 子命令、非破坏性查询（如 `gdrive files list`）及常规同步放行；`delete`、`delete-doc`、`delete-tab`、`delete-comment`、`clear`、`empty-trash`、`share`、`unshare` 触发 `force_ask`。
- **Gmail (`gmail`)**：只读检索与创建草稿（`mutate create-draft`）放行；`send`、`reply`、`forward`、`send-with-attachment`、`send-draft`、`react`、`trash`、`delete-draft`、`delete`、`batch-delete` 触发 `force_ask`。
- **Google Calendar (`gcalendar`)**：查询与个人日程块（如 `focus-time`）放行；`delete`、`rsvp`、`move`，以及携带 `--attendee`、`--optional-attendee`、`--remove-attendee` 或 `--send-updates` 非 `none` 的外部通知变更触发 `force_ask`。
- **MCP 工具 (`call_mcp_tool` / `mcp_*`)**：常规读写与检索放行；工具名命中 `mcp_confirm_tool_regex`（默认 `delete|remove|cancel-events|restore-version|drop`，例如 `notion-delete-pages`）时触发 `force_ask`。

### 6. 高危系统管理与 Git 强改拦截
- **直接拒绝 (`deny`)**：`format` 磁盘、`Format-Volume`、`diskpart`、`bcdedit`、`cipher /w`、`vssadmin delete`、`Stop-Computer`、`Restart-Computer`（不会误伤 `ruff format`、`gdocs --format md` 或 `git log --format=...`）。
- **要求确认 (`force_ask`)**：系统服务/注册表/计划任务/防火墙/ACL 修改（`reg add/delete`、`sc`、`schtasks`、`New-ScheduledTask`、`Set-MpPreference`、`netsh advfirewall`、`takeown`、`icacls`）、PowerShell `-EncodedCommand`、`git push --force/-f/--force-with-lease`、`git reset --hard`、`git clean -f`。

## 可选能力：Tier-2 AI 二次复核与审计日志

在 [`scripts/guardian_policy.json`](./scripts/guardian_policy.json) 中可按需开启以下选项：

- **JSONL 审计日志 (`audit_log_path`)**：默认写入 `~/.gemini/antigravity/logs/guardian_audit.jsonl`（自动展开 `~`），记录每次调用的时间戳、工具名、参数摘要、决策结果、触发层级与毫秒耗时；置为空字符串 `""` 即可关闭。
- **Tier-2 AI 复核 (`ai_reviewer`)**：默认 `"mode": "none"`（未命中红线的常规未知命令按 `default_unknown_command_decision` 决策）。如需对未明确覆盖的复杂命令做二次语义审查，可将 `mode` 设为 `"http_api"`（配置 OpenAI 兼容端点与环境变量 `GUARDIAN_API_KEY`）或 `"codex_cli"`（调用本机只读沙箱 `codex exec`）。

## 安装与自定义说明

1. **Python 解释器**：`hooks.json` 在插件根目录以相对路径运行 `python -X utf8 scripts/antigravity_guardian.py`（需 Python 3.10+）。若 `python` 不在系统默认 `PATH` 中，可将 `hooks.json` 内的 `python` 替换为你的解释器完整路径。
2. **调整本机目录白名单**：根据你自己的磁盘与工作目录结构，编辑 [`scripts/guardian_policy.json`](./scripts/guardian_policy.json) 中的 `allowed_write_roots` 与 `safe_tmp_delete_roots`（支持 `~/` 主目录自动展开；当前打开的工作区始终会自动放行，无需逐个添加）。
3. **运行内置单元测试（14 项用例）**：修改策略或脚本后，运行单元测试确认各项边界与防误报用例全部通过：
   ```bash
   python -B -m unittest discover -s plugins/auto-review-guardian/scripts -p "test_*.py" -v
   ```
