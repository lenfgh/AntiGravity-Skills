# Research_Hub 3-Party Cloud Sync (`research-hub-sync`)

打通 **本地工程 Agent（Antigravity / Codex）** 与 **云端深度推理模型（ChatGPT / Gemini Web + Google Drive）** 的三方协同协议与工具链。解决多工具切换时的上下文割裂、旧指标误用、RAG 切片丢失全局调用链，以及重复上传大文件耗尽代理流量等核心痛点。

## 🏗️ 三件套云端固定文档架构

为每个在研项目在 Google Drive `Research_Hub/<ProjectKey>/` 下建立三个固定文档（ID 绑定在项目根目录 `AGENTS.md` 与总表 `REGISTRY.md` 中）：

1. **`01_Logbook`（Google Doc · 实验与核验事实台账）**：
   - 仅记录**已核实通过的实验指标、精确评测分母/样本量、关键失败根因与旧结论废止声明**（按日期倒序追加，拒绝日常 debug 噪音）。
2. **`02_Studio`（Google Doc · 跨端方案对焦看板）**：
   - 顶部常驻 5 行精简看板（`vYYYYMMDD-N` 版本号、当前待解问题、已选定方案、验收条件、下一棒交接）。在网页端与 ChatGPT/Gemini 讨论定稿后，回本地对 Antigravity 说一句 **“继续当前方案”** 即可无缝拉取执行。
3. **`[Project]_03_CodeSnapshot.md`（`< 500 KB` 单文件代码快照）**：
   - 由随附脚本 `scripts/pack_codesnapshot.py` 一键生成：包含目录树 + 核心源码全文 + 超预算文件自动降级为 Python AST 类/函数签名摘要，让网页端大模型一次看清完整真实接口。

## 🚀 快速上手

1. **前置插件**：在 Antigravity 插件市场启用官方 `Google Docs` (`gdocs`) 与 `Google Drive` (`gdrive`) 插件并完成账号登录。
2. **配置绑定**：参考 [`examples/REGISTRY.example.md`](./examples/REGISTRY.example.md) 与 [`examples/projects.example.json`](./examples/projects.example.json) 填入你自己的 Google Doc ID（**无需修改任何插件源码**）。
3. **日常口令**：
   - 开工拉取：`“继续当前方案”` / `“接手 Studio”`（Agent 会先读取 `02_Studio` 并在首行汇报看板版本号）
   - 里程碑回写：`“同步云端”`（Agent 自动按倒序模板将新核实结果同步至 `01_Logbook` 或更新 `02_Studio`）
   - 打包代码快照：
     ```bash
     python ~/.gemini/config/plugins/research-hub-sync/scripts/pack_codesnapshot.py \
       --project MyProject --root /path/to/repo --focus src/core tests
     ```
