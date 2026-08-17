# HANDOFF-2 — 2026-08-17 第二轮交接（涨价后：低成本锚定质量工程）

> 前置阅读：`HANDOFF.md`（第一轮交接，其全部工作已通过 PR #66 合入 main，实现原样保留）。
> 本文件自包含：本轮的背景、全部改动、实验记录、当前卡点、后续步骤。
> 交接对象：下一个接手的 AI。所有路径基于 `E:\Desktop\mytests\dsh-anchored-standard`（main @ ba7a27c + 本轮未提交改动）。

## 0. 背景与预算约束（本轮一切决策的前提）

- **DeepSeek 大幅涨价**：Project2 单轮完整评测从 ~2 元涨到 ~12 元，**完整能力测试全部停止**。
- 用户批准的预算范围（原话要点）：**可以真实调用重新 roll 模板（花的钱不多）；可以多次 roll 尝试真实对话/任务中思维链锚定的稳定性，但仅限第一句**——即每次试验只花一个模型请求，拿到首个 assistant 消息的首行分类即停。
- 用户目标：改进预制模板（prefab），**更多"工具调用回传的思维链"**（机制见 §1.1）以强化锚定，同时**严守通用性**，避免再出现 DeepSeek 后训练式的过拟合。
- 本轮 API 花费记录（全部已花，后续接手者从零开始记账）：roll 4 次尝试（其中 attempt 1 为合格品，已导出为 v3 候选）+ 探针 9 个请求（smoke 1 + v3×4 + shipped×3 + 工作任务式×1）。**后续每次真实调用前先看本节预算。**

## 1. 机制知识（本轮新增/确认，全部免费获得）

### 1.1 锚定质量 = 回传切片的"锚定质量块"（anchor mass）
harness 回放规则（llm-deepseek serialize，第一轮交接已确认）：**assistant 消息含工具调用 → 其 reasoning_content 回传给后续请求；纯文本消息 → reasoning 丢弃**。因此模板对克隆的锚定贡献 = Σ(带工具调用消息的 reasoning 字符数)。关键推论：
- 模板清洗（loadPrefabTemplate 剔除失败的 AGENTS.md 读取）会**连带丢回传资格**：project2 模板原始 roll 5,178 字符/7 步，清洗后只剩 3,533/7；shipped 通用模板 1,096/3。
- **roll-runner 的 richEnough 门看的是清洗前的原始会话**——这是个已修复的漏洞（见 §2.3）。

### 1.2 "The user..." 开头是正常跟进轮语言，不是锚定失败
2026-08-17 的 4 次 roll 全部被旧分类器的 `/^the user\b/` 一票否决击穿（真实 let me 仅 1 处）。对照第一轮的 request-2 pilot 结论（首个用户轮之后的推理不开 "We need"——轮形依赖），"The user wants/asks..." 是跟进轮的自然叙述声。**已发布模板本身也过不了旧分类器**（2 处 "The user" 开头）——说明旧规则是 roll 之后才收紧的、与已交付产物不一致。本轮已把规则修正为：
- 硬失败：let me（全文任意处）+ 首行 let-me/I-家族；
- 新增硬要求：**锚定轮首个推理块必须 "We" 开头**（anchorWeFirst）；
- "The user" 开头：记录不失败。

### 1.3 今日模型侧观察（2026-08-17，官方 API，v4-pro alias）
- 锚定轮首块 We 开头率今日仅 1/4（前一天同任务 1/1）——基础抽卡变差，疑似 alias 切到 0813 检查点（noone89 的条件分布失配理论与此吻合：社区研究库 `contributions/noone89-deepseek-v4/`）。
- 加载轮推理天然是简短步骤叙述（"Step 2 returned no match. Next step 3..."，125-350 字符），we 词频低是**今日检查点的自然行为**，不是任务设计缺陷。想拉 we-mass 需要更多 roll 尝试碰运气——所以先探针验证"多步是否即使 we 不密也能稳住首句"再决定是否继续烧钱 roll。

### 1.4 roll 工作区的技能注册表为空 → 模板烘焙的 skill_search 结果全是 "No skills match"
天然通用；seeder 的实时重渲染（§2.2）则覆盖有技能的机器——两个方向都干净。

## 2. 本轮代码改动（全部未提交，`git status` 可见）

### 2.1 `prefab/analyze-template.mjs`（新文件，CLI + 可导入）
离线模板锚定质量分析器，零 API。走真实种子管线（loadPrefabTemplate → buildSeedPlan）后输出：
- 每条 assistant 消息：块构成、reasoning 字符数、REPLAYS/DROPS；
- 汇总：effectiveToolReasoningTurns、replayedReasoningChars、replayRatio、**回传切片上的** we/letMe/i（不是全量——全量会高估克隆继承的锚定）、declaredUnlocks、首行列表；
- 通用性 lint（error 级：源 cwd 残留/绝对路径/项目名/机器标识；warn 级：非支持下划线工具名提及）；
- 阈值门 `--min-replayed-chars/--min-effective-turns`，退出码可作模板替换的 CI 门。
- 导出 `analyzeTemplate(path, {targetCwd, agentsMd})`（CLI 部分有 main-guard，可被 roll-prefab 导入）。
- 基线数据（重要，写报告/PR 直接用）：

| 模板 | 有效步 | 回传字符 | replay 比 | 回传切片 we/letMe/i |
|---|---|---|---|---|
| shipped generic | 3 | 1,096 | 85.9% | 3/0/0 |
| project2-benchmark | 7 | 3,533 | 73.6% | 20/0/0 |
| **generic-candidate-v3（本轮新 roll，未晋升）** | **5** | **1,158** | **90.3%** | 2/0/0 |

### 2.2 `prefab/prefab-session-seed.mjs`（修改：通用性修复 + 异步化）
- **skill_search 结果实时重渲染**（通用性关键修复）：模板烘焙的技能目录是 roll 机器的（实测含 algorithmic-art/frontend-design/doc-coauthoring），克隆会"记得"目标机上不存在的技能。新增：
  - `renderSkillSearchResult(query, skills)`——与 skill-search.mjs 逐字一致的结果渲染（tokenization/上限 20/两种文案）；
  - `renderLiveSkillResults(ctx, plan, agent, cwd)`——种子时对每个模板 skill_search 调用按**本机注册表**重渲染，键为模板 callId；注册表缺失→空映射（原样），列表失败→"skill_search unavailable:..."（与真实工具一致的降级文案）；
  - `buildSeedPlan` 第 4 参 `skillResults: Map<callId, text>`（纯函数，可测）。
- **注水异步化**：apply 的微任务里先 `await renderLiveSkillResults`（一次本地注册表扫描）再 append。破坏了原"RPC 返回前完成"的时序（注释已如实说明）；turn/start 守卫仍防双播。测试用 `settle()`（setTimeout 0）代替单微任务等待。
- inject 增加 `'skills'`。

### 2.3 `prefab/roll-prefab.mjs`（修改：新任务 + 清洗后质量门）
- **新 LOAD_TASK**（目标式，锚定质量导向）：1 次 dev_tool_search 解锁全部 8 工具 + 3 次 skill_search（code/document/data-testing 三方向自选查询词）+ 每步前简短推理 + 禁止重读 AGENTS.md/任何文件 + 结尾单词 "Ready"。旧任务是 4 步机械脚本（只产出 3 条回传消息）。
- **templateQualityGate**：roll 通过后先写 `<out>.candidate.jsonl`，经 analyzeTemplate 按**清洗后**标准门控：步数≥5、回传字符≥1000、letMe=0、首条回传行 "We" 开头、lint error=0。不达标→删除候选、继续尝试；不会覆盖已发布的 template.jsonl。
- meta.json 新增 anchorMass 块（步数/字符/比率/风格计数）。

### 2.4 `prefab/roll-runner.mjs`（修改：分类器修正）
见 §1.2：去掉 "The user" 一票否决；新增 weFirst/userFirst 字段与 anchorWeFirst 硬要求（verdict.ok = styleOk && anchorWeFirst && flowOk && richEnough）。

### 2.5 `prefab/probe-clone-runner.mjs` + `prefab/probe-clone.mjs`（新文件：首句探针）
- runner（headless 插件）：创建空白会话（meta.agentPreset='prefab-anchored-standard'）→ 轮询等待种子（turn/start，超时 5s）→ 发一条 follow-up → **首个 assistant/message 落盘即 cancel**（100ms watch，同 verify-runner 手法）→ 分类首行 family（we/lets/let-me/user/i/other）+ we/letMe 计数 + 首消息工具调用数 → 打印 `PROBE_RESULT: {json}`。**每次试验恰好一个模型请求。**
- 外层：把仓库 prefab 模式安装到 checkout 的 `apps/cli/config/agent-presets/prefab-anchored-standard/`（文件清单见 PRESET_FILES 常量）+ 覆盖所选 template.jsonl → N 次试验 → 家族计数汇总（`SUMMARY [label]: {...} — we/lets-first X/N`）。
- 用法：
  ```
  DSH_HARNESS_ROOT=E:\Desktop\mytests\agent-test\deepseek-harness node prefab/probe-clone.mjs \
    --cwd "E:\Desktop\mytests\prefab-generic-roll-workspace" --trials 4 \
    --template prefab/template.jsonl --label shipped
  ```

### 2.6 其他
- `scripts/sync-modes.mjs`：prefab own 白名单 += analyze-template.mjs、probe-clone.mjs、probe-clone-runner.mjs。
- `test/prefab-session-seed.test.mjs`：settle() 适配异步；fixture 增加 skill_search 调用/结果对；+3 个测试（渲染一致性/烘焙目录不外泄/实时重渲染三分支）。**全套 194/194 绿（`npm run check`）。**
- checkout 同步：`preset/context-gate.mjs` 复制到 harness checkout（补 baselineIds 短路改进，其余文件本就一致）。

## 3. 实验记录（烧过钱的事实，别重复花）

1. **4 次 roll 尝试**（新 LOAD_TASK，2026-08-17）：全部 styleOk=false——**全是 "The user" 开头被旧规则击穿**；flowOk 全过（8 工具解锁/AGENTS 读取/技能查询），rich=4-5。
2. **attempt 1 实际是合格品**（新标准下）：会话 `session-88e0af92-bfdf-4b13-a2bb-3081dfe1b886`，位于 `C:\Users\y2278\.dsh\sessions\--E-Desktop-mytests-prefab-generic-roll-workspace--\`。已导出为 **`prefab/generic-candidate-v3.jsonl`**（83KB，gitignore 的 generic-candidate* 模式，不会误提交）。指标见 §2.1 表格第 3 行；过新门；**尚未晋升为 template.jsonl**——等 A/B 探针定夺。
3. 4 个 roll 会话的逐块分析（哪一步退化、首行全文）已在会话中做过，结论 §1.2/§1.3；会话文件都在上述 sessions 目录（当日全部 7 个会话）。

## 4. ~~当前卡点~~ 已解除（2026-08-17 当日修复）

**症状**：探针冒烟报 "session did not seed within timeout"（未产生 API 费用）。
**根因**：`agent-preset/selected` 事件由 **UI 层**发出（`packages/client/ui-agent-preset/src/client/index.ts`，预设选择 RPC 路径）；headless 的 `agents.create({meta:{agentPreset}})` 不走这条路 → seeder 的触发事件从未发生。
**修复**：`probe-clone-runner.mjs` 在 create + whenIdle 之后**显式补发**该事件（此时 agent 已注册，seeder 的 `agents.get(session.id)` 可解析；seeder 的 WeakSet 防重复）。顺带 probe-clone.mjs 改为总是打印 harness stderr 尾部。
**教训（记入坑表）**：凡是监听 UI RPC 事件的插件（agent-preset/selected、credentials/updated 等在 API_REMOTE_FORWARDED_EVENTS 清单里的），headless 驱动都必须手动补发事件——roll/verify 流程此前只依赖 session/event 类观察者所以没踩过。

## 4.5 首句探针实验结果（已执行，2026-08-17，共 9 个模型请求）

环境：DSH checkout rc.5 / Windows 11 / DeepSeek 官方 API / v4-pro（alias，疑似 0813）/ 每试验恰好 1 请求、首个 assistant 消息即 cancel / cwd=中性 roll 工作区 / 默认 follow-up 为总结式提问（"Briefly summarize what has already been prepared... what the next concrete step should be."）。

| 变体 | n | seeded | let-me（首行或正文） | we 首行 | 首行家族 | 正文 we 均值 |
|---|---|---|---|---|---|---|
| shipped 模板（总结式提问） | 4 | 4/4 | **0/4** | 0/4 | user ×4 | ~5.3（5,5,5,6） |
| **candidate-v3**（总结式提问） | 4 | 4/4 | **0/4** | 0/4 | user ×3 + other ×1 | ~1.8（0,1,3,3） |
| shipped（工作任务式提示） | 1 | 1/1 | **0/1** | 0/1 | user ×1 | **12**，首消息即 2 个工具调用 |

**结论（探索性，n 小）**：
1. **两个模板 9/9 全部零 let-me**——回传锚完全压制了 let-me 退化，这是模板方案的核心承诺，成立。
2. **克隆首行家族由 follow-up 提示词的轮形决定**（总结/转述式提问 → "The user asks..."叙述开头），与模板无关；与第一轮 request-2 pilot 的轮形依赖结论一致。模板管的是"不崩"，提示词管的是"开口"。
3. 反直觉数据点：shipped（回传切片 we=3）的克隆正文 we 均值 5.3 > v3（we=2）的 1.8——**回传切片的 we 密度（而非步数）与克隆正文 we 用量同向**，支持"下一次 roll 的目标应是 we-mass 而非单纯步数"。
4. **晋升决定：保留 shipped 为 template.jsonl**（v3 无任何测量轴占优；其结构优势——5 步/90.3% 回传比——未转化为风格收益）。v3 留作 `prefab/generic-candidate-v3.jsonl` 候选，等模型侧 we 产出改善时按 §2.3 新任务+门再 roll 高 we-mass 版本。
5. 探针工具本身即交付物：后续任何模板/预设改动，`probe-clone.mjs --trials 4` 一个命令拿到首句稳定性数据。

## 5. 后续步骤（按序执行，预算敏感）

1. ~~修探针管线~~ **已完成**（§4），A/B 探针 **已执行**（§4.5）。
2. ~~A/B 首句探针~~ **已执行，结论：保留 shipped**（§4.5）。可选加测（各 1-4 请求）：greeting follow-up（"你好"——历史最难案例）；subagent 场景（克隆会话派生子代理的首句）；不同目标 cwd 的克隆（验证 cwd/技能重渲染在真实异机的表现，0 额外机制成本）。
3. **提交**：本轮改动清单见 §2（analyze-template / probe-clone×2 / prefab-session-seed 技能重渲染 / roll-runner 分类器 / roll-prefab 门 / sync 白名单 / 测试）。shipped 模板不换，无模板发布审查负担；`generic-candidate-v3.jsonl` 是 gitignore 的候选，保留本地。提交前 `npm run check`（当前 194/194 绿）。
4. **可选免费工作**（不花一分钱，随时可做）：
   - 三个新模式（eternal-minimal/wire-think/combo-anchored）统一挂 context-gate 替换各自的枚举式 suppressedContextSources（第一轮交接 §5 的未竟事项，新模式重犯了旧方案）；
   - probe 加 `tool_choice:'none'` 条件到 minimal-trigger-probe（wire-think 的"可见不可调用"剂量空格，脚本写好不跑，等降价）；
   - 用本地 8 个导出会话（E:\download\Compressed\dsh-session-*）做免费的"回传推理质量 vs 下一轮风格"相关性分析——验证锚定质量块假设的另一条路。
5. **远期**（降价后）：we-mass 更高的 roll（今日检查点产出低，见 §1.3）；Project2 全量复测；社区 C1-C7（第一轮交接 §7.3）。

## 6. 第一轮遗留但在本轮复核过的信息（摘要）

- PR #66 把第一轮交接全部合入，`shared/context-gate.mjs` 零改动存活（+baselineIds 小加固）。
- 三个新社区模式（均 Greenhand-monster，机制+质量评述见会话记录）：eternal-minimal（目录永远 Minimal 对 + `dshx` bash 网关，tools/pre-execute → ctx.tools.execute 全管线，deny 通道回传；风险：结果带 error 标志/JSON-in-shell 引号/persona 字节纯净被 guide 破坏）；wire-think（sibling provider 在 wire 上 tool_choice=none，工具可见禁调用；风险：前缀缓存每轮两次失效 + vendored adapter 漂移 + "可见不可调用"剂量未测）；combo-anchored（think-phase + deliberation-gate(<400 字符 deny 一次) + cot-drip(每 4 结果一条 "We…" 节拍)——事后矫正哲学，注入频率的剂量效应未量化）。三模式 Project2：98(n=1)/99,97(n=2)/97(n=1)。
- 研究库：`xiaobright-v4-tool-surface-dose-response` 已收录（含 Flash 首动作合法性复核：search-only/discovery-trio 0/8 合法，全去调未提供的 bash）；新贡献者 noone89 的机制归因研究（MoE 路由/口吻专家/条件分布失配）+ PTC Warmup 插件，与实测结论互相印证。
- 本机安装副本 `~/.dsh/.agent-presets/anchored-standard/`：与仓库基本同步（context-gate 差 baselineIds，可直接 cp 仓库版覆盖；30 行含 8 个 MCP 行，**MCP 行永不入库**）。

## 7. 纪律（同第一轮，继续有效）

- `.env`/API key 永不打印、永不提交；MCP 服务器行只存在于安装副本。
- 真实 roll 的推理文本发布前必须人工审查（项目标识/机器标识/复述内容）。
- 小样本诚实：n=1~4 的探针结果标注为探索性证据；环境四字段（dsh 版本/OS/API 来源/模型）随数据走。
- 每次真实调用前对照 §0 预算；探针单试验 = 1 请求；roll 单尝试 = 2 轮小会话；Project2 全轮 = 12 元级，禁跑。
