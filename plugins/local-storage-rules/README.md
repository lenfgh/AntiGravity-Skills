# Local Storage & Disk Guardrails (`local-storage-rules`)

专为 Windows 多盘工作站（系统盘 `C:` 容量有限 + 数据盘 `D:` / `E:` 大容量 NVMe）设计的全局常驻规则插件（`rules/AGENTS.md`）。

## 💡 解决什么痛点？

AI 编程与科研 Agent 在高频执行任务时，默认会把临时 Python 脚本、PDF/PPT 渲染缓存、`%TEMP%` 编译产物以及会话 `scratch/` 目录写入 `C:\Users\<User>\...`，极易在数天内塞满系统盘。

启用本插件后，Agent 会在每一轮会话自动遵循以下硬约束：
1. **严禁向 `C:` 盘写入任何工作文件、临时脚本（Scratch）、缓存、日志或构建产物**（覆盖默认的 `brain/<id>/scratch/` 习惯，自动改用数据盘工作区内的 `_tmp/` 目录）。
2. **自动重定向 CLI 临时目录**：在运行会产生大体积中间文件的包管理器、编译器或渲染管线时，主动将 `TEMP` / `TMP` 指向 `E:` 或 `D:`。
3. **保留必要例外**：不影响 Antigravity IDE 原生右侧 Artifact 面板所需的轻量级 `.md` 文档渲染。

## ⚙️ 自定义你的目标盘符

如果你的主力数据盘是 `D:`、`F:`，或 Linux 挂载盘 `/mnt/data`，只需安装后编辑 `plugins/local-storage-rules/rules/AGENTS.md` 中的盘符说明即可立即生效（搭配 `auto-review-guardian` 插件更可在工具执行层实现物理拦截确认！）。
