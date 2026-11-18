# Local Storage & Disk Guardrails (`local-storage-rules`)

面向 Windows 多盘环境（系统盘 `C:` 容量较小、数据盘 `D:` / `E:` 存放项目）的全局常驻规则插件（`rules/AGENTS.md`）。

## 规则内容

启用插件后，Agent 在会话中默认遵循以下约束：

1. **禁止在 `C:` 盘写入工作与临时文件**：不在 `C:` 盘创建项目产物、临时测试脚本、缓存、日志或渲染中间文件；不使用默认的 `C:\Users\<User>\.gemini\...\scratch\` 存放临时脚本，统一改用数据盘工作区内的 `_tmp/` 或 `.tmp/` 目录，并在任务结束后清理临时脚本。
2. **重定向命令行临时目录**：运行会产生较大临时文件的构建、包管理或文档渲染命令时，将 `TEMP` / `TMP` 指向 `E:` 或 `D:` 盘目录。
3. **保留的例外情况**：
   - Antigravity IDE 右侧 Artifact 面板展示所需的 `.md` 文档（位于 `brain/<conversation-id>/*.md`）。
   - 用户明确指定并同意修改的 `C:` 盘全局配置文件。

## 自定义盘符

如果你的数据盘盘符不是 `E:` / `D:`（例如 `F:` 盘或 Linux 挂载目录 `/mnt/data`），直接编辑 [`rules/AGENTS.md`](./rules/AGENTS.md) 中的目标路径说明即可。若希望在工具执行层对越界写入做强制拦截确认，可配合本仓库中的 [`auto-review-guardian`](../auto-review-guardian/README.md) 插件一起使用。
