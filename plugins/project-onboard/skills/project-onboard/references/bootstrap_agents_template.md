# Bootstrap `<Project>/AGENTS.md` Template (for `STATE_C_NEW_OR_BARE` Projects)

When onboarding a brand-new or unstructured project and the user approves creating its initial `AGENTS.md`, keep the file **strictly `< 22 KB`** (ideally `2–5 KB`) and follow the standard `E:\Project` convention:

```markdown
## Research_Hub 固定文档绑定（置顶必读）

- **科研项目名（Project Key）**：`<ProjectKey>`（本地根 `E:\Project\<DirName>`）
- **云端目录（Drive Folder）**：`<DRIVE_FOLDER_ID_OR_PENDING>`（`Research_Hub/<ProjectKey>`）
- **`01_Logbook` Doc ID**：`<LOGBOOK_DOC_ID_OR_PENDING>`
- **`02_Studio` Doc ID**：`<STUDIO_DOC_ID_OR_PENDING>`
- **`03_CodeSnapshot` File ID**：`<CODESNAPSHOT_ID_OR_PENDING>`
- **全局路由表**：`E:\Project\REGISTRY.md` ｜ **同步协议**：遵循全局 `research-hub-sync` 技能：
  1. **开工拉取**：收到“继续当前方案 / 接手 Studio”时，先读取 `02_Studio` 顶部看板，首行报出版本号再在获准范围内执行。
  2. **里程碑回写**：核实新实验结果、确认关键失败或修正旧结论时更新 `01_Logbook`（注明分母、评测口径与证据路径）；拍板新方案时更新 `02_Studio` 顶部并递增版本。
  3. **体积与磁盘红线**：严禁将例行监控心跳追加进 `AGENTS.md`（保持 `< 22 KB`，运行回执一律写入 `work/` 或 `runs/`）；严禁在 `C:` 盘写工作/临时文件；云端纯英文命名且禁止未经批准上传 `> 1 MB` 文件。

---

# 项目工作约定（常驻硬约束）

## 1. 核心目标与主力架构路线
- **研究/工程主线**：<简述核心问题、主力模型/模块与对照范围>
- **代码与关键目录**：<源码入口、脚本入口、测试入口、状态回执落盘目录>

## 2. 运行环境、算力与资产边界
- **本地/远程 Python 环境**：<明确虚拟环境路径或服务器 Conda 环境>
- **计算与归属边界**：<明确 Debug 端 vs 正式训练端、获准节点/配额、严禁改动他人任务或大文件经本机中转>

## 3. 评测口径与有效基线锚点
- **标准评测口径**：<数据集划分、样本量分母、截点规则或随机种子约定>
- **当前有效基线**：<基准模型得分与对应回执路径>
```
