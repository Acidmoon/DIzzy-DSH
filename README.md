# 🌀 Dizzy-DSH —— DSH 插件合集

一个「克隆即装」的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件合集:
**一条命令装完,重启即用** —— 余额/额度、本月用量与花费、Agent 规则注入、浏览器控制。

无需 npm 发布;仓库本身作为 bundle 层安装,重启后依然生效。

> **合集只收录自己写的插件。** 2026-09 起,原先收录的第三方插件
> (`dsh-vision-toolkit` / `dsh-genui` / `dsh-notification` /
> `dsh-better-sidebar` / `dsh-subscription-auth` / `dsh-gui-customization`)
> 与其 agent preset(`dsh-anchored-standard`)已**全部移除**:`third-party/`
> 快照、`patches/` 本地补丁、第三方专属文档与安装脚本都已删除,
> `package.json` 也不再声明任何第三方依赖。需要哪个第三方能力,请自行
> `dsh plugin --profile web add <包名>` 单独安装。

> 目标 DSH:**`@deepseek-ai/dsh@0.1.5-rc.1`**。四个自有插件只依赖内核公开
> 契约;`balance` 与 `usage-card` 已在 0.1.5-rc.1 上完成适配并实测(见
> [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) §10),`agent-instructions` 与
> `kimi-webbridge` 在同一版本上尚未实测。
>
> 0.1.5-rc.1 适配修掉几处真问题:`balance` 的凭证变更监听事件名
> (`credentials/updated` → `credentials/reference-updated`)、两个插件
> `dsh.client.inject` 里已被内核删除的 `@deepseek-ai/dsh-client-runtime`、
> 客户端徽章改读 `useProjection('modelSelection')`(原来读不到的
> `modelDirectories` 让它整个不渲染),以及**会话日志改名**
> (`session.v3.jsonl.zstd`,旧文件名白名单曾让整月用量漏统计)。
>
> **第三方插件只保留一个**:`dsh-plugin-memory-tencentdb`。曾收录的
> `dsh-vision-toolkit` / `dsh-genui` / `dsh-notification` /
> `dsh-better-sidebar` / `dsh-subscription-auth` / `dsh-gui-customization`
> 与其 agent preset(`dsh-anchored-standard`)已连同快照与本地补丁移除 ——
> 快照跟随上游漂移,上游改 peer 范围或新增运行时依赖就会让合集装不上或起不来,
> 而排查成本落在本仓库。需要那些能力请自行 `dsh plugin --profile web add <包名>`。

##  能力总览

四个自有插件(`plugins/<name>/`)+ 一个收录的第三方插件(`third-party/`),
一条命令一起装完。

| 插件 | 能力 | 怎么用 | 状态 |
|---|---|---|---|
|  **余额/额度** `dizzy-dsh-balance` | 输入栏同一徽章:DeepSeek 显示人民币余额,Grok 显示 SuperGrok 周额度剩余% | 切到对应模型即显示;问「余额」/`balance_check`,或「Grok 额度」/`grok_quota_check` | ✅ 稳定 |
|  **本月用量** `dizzy-dsh-usage-card` | 本地会话日志聚合 token 用量 + **人民币金额**:DeepSeek 官方价(含峰谷,官网自动取)+ OpenRouter 聚合价兜底 + 本地可覆盖:月度热力图 / 近 7 天趋势 / 今日分模型堆叠条(输入未命中 / 命中缓存 / 输出) / 峰谷时段 / 本月花费统计卡。**汇总标记**:页头显示「上次汇总于 X(上一轮 Y)· 较上次新增 N tokens」;**增量汇总**:只重读 (mtime,size) 变化的会话日志,其余沿用缓存;**空月自动就近**:所选月份(不早于当前月)没有用量时静默落到最近有数据的月份(默认行为,不做标注),并在空月前后给出相邻有数据月的一键回跳;日志名按后缀识别(`session.v3.jsonl.zstd` 等) | 对话区右侧「用量」Tab(对话、轨迹并列);曲线按横坐标吸附最近一天;悬浮弹窗看分项并跟随鼠标;支持月份切换 + 60s 自动刷新;设置页「用量统计」段看花费概览与价格配置 | ✅ 稳定 |
|  **Agent 规则注入** `dizzy-dsh-agent-instructions` | 向每个会话注入 Agent 规则:用户哨兵规则(第一性原理 / 对抗式审查 / 子代理优先 / 喵字开头)+ 开发规范(不重复造轮子 / 核心约定 / 防御性模式 / 类型安全) | 装完即全局生效,所有会话、所有工作区;编辑 `plugins/agent-instructions/prompts/agent-instructions.md` 后**下一轮对话即生效**,无需重启 | ✅ 稳定 |
|  **浏览器控制** `dizzy-dsh-kimi-webbridge` | 通过 Kimi WebBridge(daemon + 浏览器扩展)控制你的**真实浏览器**:打开网页、读取页面、点击、填表、截图、抓包、存 PDF —— 带登录态的会话直接可用 | 渐进式披露:模型先调用 `kimi_browser_activate` 引导工具,随后获得全套 `kimi_browser_*` 工具(导航/快照/点击/输入/截图/标签管理) | ✅ 稳定 |

### 收录的第三方插件(唯一一个)

| 插件 | 能力 | 怎么用 | 状态 |
|---|---|---|---|
|  **记忆与知识** `dsh-plugin-memory-tencentdb` | 个人长期记忆(L0 对话 / L1 原子记忆 / L2 场景 / L3 画像)+ LLM-Wiki + CodeGraph;自动捕获、每轮召回、画像注入;MemoryCore / MemoryKnowledge **打进插件** `engines/`,sidecar 随 DSH 启停 | 对话区右侧「记忆」Tab;模型工具 `tdai_memory_*` / `tdai_knowledge_*`;CodeGraph 需本机有 git | ✅ 稳定(v0.1.2,内置引擎) |

作者 [TencentCloud](https://github.com/TencentCloud),上游
[TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory);
合集收录的是「本地适配层(`src/`)+ engines/ 稀疏快照」并带一个本地补丁
(sidecar 绑回环 + `tsx` 列生产依赖)。上游登记与更新流程见
[docs/THIRD-PARTY-SNAPSHOTS.md](docs/THIRD-PARTY-SNAPSHOTS.md) /
[docs/THIRD-PARTY-UPDATE.md](docs/THIRD-PARTY-UPDATE.md)。

> 合集 2026-09 起不再收录其余第三方插件(原因见开头)。`third-party/` 下现在
> 只有这一个目录。

### 自有预设(agent preset)

| 预设 | 能力 | 怎么用 | 状态 |
|---|---|---|---|
|  **DIY 模式** `diy` | 持久造物：合集子包 / agent preset / 技能。不挂 `tool-cordis`，与官方「创造模式」解耦，两边可同进程共存 | 运行 `scripts/install-diy-preset.ps1` 装到 `~/.dsh/.agent-presets/diy`，重启后新会话选「DIY 模式」。动态插件探测请另开创造模式 | ✅ 稳定 |

##  快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/Acidmoon/DIzzy-DSH.git

# 2. 一条命令安装全部插件(4 个自有子包 + 记忆插件)
dsh plugin --profile web add file:<仓库绝对路径>

# 3. 重启 dsh web,全部生效(含浏览器 UI)
```

> ⚠️ 必须用 **`file:`** 而不是 `link:`(`link:` 不安装依赖树,插件无法加载)。

> ⚠️ 首次安装如遇 `ERR_PNPM_IGNORED_BUILDS: node-pty / protobufjs`:在
> `~/.dsh/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds` 里把两者设为
> `true`,重新 add 即可。记忆引擎(engine)依赖由 sidecar 首次启动时在
> `engines/` 里自行 `npm install`。

**卸载**:`dsh plugin --profile web remove dizzy-dsh`(自有子包与记忆插件随依赖一起移除)

**更新**:`git pull` 后删除 profile 里的旧副本再重装:

```powershell
Remove-Item ~/.dsh/profiles/web/node_modules/dizzy-dsh* -Recurse -Force
Remove-Item ~/.dsh/profiles/web/node_modules/dsh-plugin-memory-tencentdb -Recurse -Force
Remove-Item ~/.dsh/profiles/web/node_modules/@tencentdb-agent-memory -Recurse -Force
dsh plugin --profile web add file:<仓库绝对路径>
```

> 若你还装过本合集早期收录的第三方插件,升级到本版本后一并清掉残留副本
> (`node_modules` 下的 `dsh-better-sidebar` / `dsh-notification` /
> `dsh-subscription-auth` / `dsh-gui-customization` / `@anionex` /
> `@omdsh-dev` / `@dsh-external`)。

> ⚠️ **每次仓库改动后都要走这一步**(新增/修改插件、改 `cordis.patch.yml`、
> 改 `plugins/` 代码):pnpm 对 `file:` 依赖只检测 `package.json` 是否变化,
> **不会同步 patch 文件与子包内容**——只跑 `pnpm install` 会导致插件挂载不上
> (实测:改了 `cordis.patch.yml` 只 `pnpm install`,重启后新 entry 完全不生效)。

## 装完起不来?恢复到纯净状态

装完合集后 `dsh web` 起不来(或其他插件把环境搞坏)时,不用重装 DSH,也不用删数据 ——
故障面只在 profile 目录的三处:`package.json`(依赖 + bundles)、`cordis.patch.yml`(用户 patch 层)、
`node_modules/`(已安装副本)。**会话日志、凭证、设置、技能都在 `$DSH_HOME` 顶层,与 profile 无关,一律不动。**

按严重程度三级递进(脚本 `scripts/restore-clean-profile.ps1`,默认 dry 风格只做减法):

```powershell
# 第 1 级(默认):把合集从 profile 移除。保留同一 profile 与全部数据。
#   dsh plugin remove 会同时清 dependencies 与 dsh.profile.bundles(已实测)
powershell -ExecutionPolicy Bypass -File scripts\restore-clean-profile.ps1

# 第 2 级:profile 的配置 / node_modules 已损坏时,按官方模板重建同名 profile
#   先整目录备份到 $DSH_HOME\.backup-restore-<时间戳>\ ,可随时复制回来回滚
powershell -ExecutionPolicy Bypass -File scripts\restore-clean-profile.ps1 -RebuildProfile

# 第 3 级:另起一个纯净救援 profile(不碰原 profile),先确认「DSH 本身没问题」
powershell -ExecutionPolicy Bypass -File scripts\restore-clean-profile.ps1 -RescueProfile
dsh --profile rescue --port 3081        # 能起来 = 内核没问题,故障在原 profile
```

手工等价操作(不想用脚本时):

```powershell
# A. 只想去掉合集
dsh plugin --profile web remove dizzy-dsh

# B. profile 坏到连 remove 都跑不动:把配置清成纯净再让它自愈
'[]' | Set-Content ~/.dsh/profiles/web/cordis.patch.yml            # 清空用户 patch 层
'{ "name":"dsh-profile-web","private":true }' | Set-Content ~/.dsh/profiles/web/package.json
dsh --profile web --dump-config    # 确认组合干净(应只有 dsh-base + dsh-web-app)
dsh web

# C. 最彻底:重建 profile 目录(数据不受影响)
Rename-Item ~/.dsh/profiles/web web.broken                         # 别删,改名留证据
dsh --profile web --dump-config                                     # 按内置模板重新落盘
dsh web
```

几个实测要点:

- **`--from-default-profile web` 不能用于 `web` 自己** —— 内置 profile 名会报
  `profile "web" is shipped and cannot be a custom profile target`;要恢复 `web`
  就直接跑 `dsh --profile web --dump-config`,它会按内置模板落盘。该 flag 只用于
  **新建**自定义 profile(如 `--profile rescue --from-default-profile web`)。
- `~/.dsh/.backup-20260911-211654/` 那个旧备份**不是纯净版**(里面就装着 dizzy-dsh),别拿它当"干净还原点"。
- 恢复后重启 `dsh web` + 硬刷新浏览器;`node_modules` 里若有孤儿目录(如已不再引用的
  第三方实验包),删掉即可 —— 没被任何层引用就是死代码。

### 启用 DIY 模式预设(可选)

`diy` 是 **agent preset,不走 `dsh plugin add` 机制**,安装 = 把仓库
`presets/diy/` 复制到用户预设根,并从本机 DSH 部署同步官方创作手册快照:
```powershell
# 4. (可选)安装 DIY 模式预设(持久造物,与创造模式解耦)
powershell -ExecutionPolicy Bypass -File scripts\install-diy-preset.ps1
```

脚本幂等:目标已存在且文件齐全时跳过仓库文件(官方快照仍刷新);缺文件时补全;
加 `-Force` 覆盖为仓库版。装完**重启 dsh web**,新会话的预设下拉选择「DIY 模式」。

> ⚠️ DIY 模式没有 `cordis_define` / `cordis_run`。动态插件探测请另开官方
> 「创造模式」。不要在已经产生内容的会话中途切换 preset。

## 插件配置指南(Agent 向)

> 本段写给读取本仓库的 AI Agent:当用户要求「配置 / 启用 / 排查」本合集的
> 插件时,按下列流程执行。**「需用户提供」中缺什么就向用户问什么**,不要擅自
> 假设或编造;拿不到就停下来说明。

### 通用步骤(所有插件)

1. 确认已安装:`dsh plugin --profile web list` 应包含 dizzy-dsh;没有则先走「快速开始」;
2. 配置改动后一律**重启 dsh web + 浏览器硬刷新**(Ctrl+Shift+R);
3. 配置文件:DSH 设置 `~/.dsh/settings.yaml`;**密钥只进 DSH credentials**
   (`~/.dsh/.credentials.yaml` / 设置界面),settings 里只放 credential 引用,绝不写明文密钥。

### 0.2 记忆与知识 dsh-plugin-memory-tencentdb(收录的第三方)

**需用户提供**:无密钥。sidecar 默认随 DSH 启停并跑包内 `engines/`,首次启动
会在 `engines/` 里自行 `npm install`(需要网络);CodeGraph 部分需要本机有 `git`。
若要让记忆/知识引擎自己调用 LLM 做提炼,它默认指向
`https://api.deepseek.com/v1` + `deepseek-chat` —— 此时同样用 `DEEPSEEK_API_KEY`,
可在设置页「记忆」段改 `runtime.llmBaseUrl` / `llmModel`。

**配置步骤**:

1. 零配置即可用:重启 dsh web 后,对话区右侧出现「记忆」Tab,模型工具目录出现
   `tdai_memory_*` / `tdai_knowledge_*`;sidecar 监听 127.0.0.1:8420(记忆)与
   8421(知识);
2. 可选:在 `settings.yaml` 的 `memory-tencentdb` 段或设置页调整。默认值
   (来自插件 schema,改前先确认你要的是哪一项):

```yaml
memory-tencentdb:
  server:
    url: http://127.0.0.1:8420     # 记忆网关
    apiKey: local
    instanceId: default
    teamId: personal
    agentId: personal-agent
    userId: personal-user
    autoIdentity: true             # 身份留空时自动填上面的默认值
    timeoutMs: 30000
    rejectUnauthorized: true
  recall:
    enabled: true
    autoInject: true               # 每轮自动召回并注入
    maxResults: 5                  # 1~20
    refreshIntervalMs: 60000
  capture:
    enabled: true
    onlyUserSource: true           # 只从用户发言捕获,避免把模型自述写进记忆
    flushIntervalMs: 2000
    skipFailedTurns: true
  knowledge:
    enabled: true
    url: http://127.0.0.1:8421
    serviceId: default
  runtime:
    manageSidecars: true           # 由插件托管两个 sidecar 的启停
    gatewayDir: ''                 # 留空 = 用包内 engines/(换机即用)
    knowledgeDir: ''
    gatewayPort: 8420
    knowledgePort: 8421
    llmBaseUrl: https://api.deepseek.com/v1
    llmModel: deepseek-chat
    llmMaxTokens: 8192
```

3. 想用自己已有的引擎部署(例如独立装的 MemoryCore),把 `runtime.manageSidecars`
   设为 false 并指向外部地址 —— `gatewayDir` / `knowledgeDir` 留空表示继续用包内引擎。

**验证**:`GET http://127.0.0.1:8420/health` 与 `GET http://127.0.0.1:8421/health`
返回 200,且两个端口**绑在 127.0.0.1 而不是 `*`**(个人模式不应暴露到局域网,
本地补丁保证这一点);「记忆」Tab 能列出已捕获的记忆;`tdai_memory_search` 能查到
刚聊过的内容。

**排查**:

- sidecar 起不来:看 host 日志里 `engines/` 的 npm install 是否失败(常见是网络/
  代理);也可手动进 `third-party/dsh-plugin-memory-tencentdb/engines/` 跑 `npm install`;
- 端口被占:8420 / 8421 与别的服务冲突 → 改 `runtime.gatewayPort` / `knowledgePort`,
  并同步 `server.url` / `knowledge.url`;
- 健康检查通但没有记忆:「记忆」Tab 空 → 确认 `capture.enabled` 与
  `recall.autoInject` 没被关掉,且会话确实产生了用户发言(默认只从用户侧捕获);
- 换机后不可用:`gatewayDir` / `knowledgeDir` 若被填成绝对路径会失效,清空即回到包内引擎。

### 0. 浏览器控制 dizzy-dsh-kimi-webbridge

**需用户提供**:无密钥。但依赖 Kimi 官方的两个组件(不在本仓库):
① daemon(`%USERPROFILE%\.kimi-webbridge\bin\kimi-webbridge.exe`,监听 127.0.0.1:10086)
② Chrome/Edge 的 **Kimi WebBridge 浏览器扩展**(需已安装并连接)。

**配置步骤**:

1. 检测 daemon:POST `http://127.0.0.1:10086/status`(或工具调用时插件会自动尝试启动);
   daemon 缺失 → 请用户到 https://www.kimi.com/zh-cn/features/webbridge 安装;
2. 检查 `/status` 的 `extension_connected`;为 false → 请用户检查浏览器扩展是否启用;
3. 无配置文件;工具调用时插件会自动处理 session 命名与 daemon 自愈。

**验证**:让模型调用 `kimi_browser_activate`,随后工具目录出现全套 `kimi_browser_*`;
让模型打开一个网页并截图,截图返回的是文件路径。

**排查**:`kimi_browser_* 失败:浏览器扩展未连接` → 检查扩展;错误含
「Please update the Kimi WebBridge extension」→ 让用户更新扩展;
daemon 无法连接且自动启动失败 → 让用户手动运行
`& "$env:USERPROFILE\.kimi-webbridge\bin\kimi-webbridge.exe" start`。

### 0.5 余额/额度徽章 dizzy-dsh-balance

**需用户提供**:DeepSeek 走 `DEEPSEEK_API_KEY`;Grok **无单独密钥**,凭证是
credentials 里的 `GROK_SUBSCRIPTION_TOKEN`(JSON:`refresh`/`access`/`expires`)。
**本合集不含 OAuth 登录插件**,该令牌需用户自行写入凭据(或用第三方的订阅登录
插件生成);拿不到就只显示 DeepSeek 余额,Grok 显示「未登录」。

**配置步骤**:

1. DeepSeek:在 credentials 配好 `DEEPSEEK_API_KEY`,切到官方模型即可看到 ¥;
2. Grok:确认 credentials 里有 `GROK_SUBSCRIPTION_TOKEN`,再把模型切到 Grok ——
   同一位置显示剩余百分比(插件会在 401 时用 refresh token 自动续期并写回);
3. 可选:`settings.yaml` 的 `dizzy-balance` 段覆盖 `refreshIntervalMs` /
   `grokBillingBaseURL`(企业代理)。不要改 `grokCredentialName`,除非你自己换了凭据引用。

**验证**:DeepSeek 时 `GET /dizzy/balance` 有 `balanceCny`;Grok 时 `GET /dizzy/grok-quota`
有 `remainingPercent`。问「Grok 额度」应调用 `grok_quota_check`。

**排查**:

- 徽章不出现:当前既不是 `deepseek-official` 也不是 `grok`,或 client 半区未加载
  (删 `node_modules/dizzy-dsh-balance` 后重装合集并重启);
- Grok 显示「未登录」:`GROK_SUBSCRIPTION_TOKEN` 缺失或格式不对——写入凭据,
  不要向用户要 cookie;
- HTTP 401 反复失败:refresh token 失效,重新获取订阅令牌;
- 数字对不上 grok.com 网页:网页还有 2h 查询桶,本插件只读 CLI 周额度账本。

### 0.65 用量统计与金额 dizzy-dsh-usage-card

**需用户提供**:无。金额按**人民币**计价,开箱即用:
DeepSeek **官方路由**的模型按 [官网价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)
自动计价(含峰谷两档,按每条消息的实际时间计费);其他模型取
[OpenRouter](https://openrouter.ai/models) 聚合价(美元 × `fxRate` 换算);
价格不对时可在设置页直接调整,实时生效。

内置官方价(人民币/百万 token,**2026-09-15 核对官网**):

| 模型(api 名) | 版本 | 缓存命中 空闲/高峰 | 未命中 空闲/高峰 | 输出 空闲/高峰 |
|---|---|---|---|---|
| `deepseek-flash` | DeepSeek-V4.1-Flash | 0.02 / 0.04 | 1 / 2 | 4 / 8 |
| `deepseek-v4-pro` | DeepSeek-V4-Pro-0813 | 0.15 / 0.30 | 4.5 / 9 | 13.5 / 27 |

- 峰谷时段 = 北京时间 **周一至周五** 9:00-12:00 / 14:00-18:00(周末全为空闲);
- 历史模型名(`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`、`deepseek-v4-pro-0813`)
  自动归一到现行条目 —— 官方说明这些旧名仍可调用,由 V4.1-Flash 提供服务并按 Flash 价计费;
- 官方价**只对 `deepseek-official` 生效**:同一模型走第三方网关时套官方价会算错,
  那种情况落到 OpenRouter 聚合价,查不到就按 0 计并在悬浮提示里说明。

**配置步骤**:

1. 零配置:用量 Tab 统计卡第一张即「本月花费」。价格优先级:
   **本地配置 > DeepSeek 官网价(峰谷,仅官方路由) > OpenRouter 聚合价(6 小时同步)**;
2. 价格不对/想按实际扣费算:**设置页 → 用量统计 → 搜索模型 → 点进详情**,
   直接改输入/输出/缓存单价,点「保存」即实时生效(写回 settings.yaml,
   无需重启);「还原为默认」删除该模型的本地覆盖;
3. 高级参数(货币符号 / 汇率 / 同步间隔)仍可手写 `settings.yaml` 的
   `dizzy-usage-card` 段(设置页保存时保留这些字段):

```yaml
dizzy-usage-card:
  # currency: ¥   # 金额前缀(仅展示,不换算);默认 ¥
  # fxRate: 6.8   # USD→CNY,仅用于 OpenRouter 美元价换算
  # priceSyncMs: 0   # 0 = 禁用 OpenRouter 聚合价,只用官方价 + 本地价
```

**验证**:用量 Tab 统计卡出现「本月花费」(¥);今日明细每行右侧有金额列,悬浮显示
价格来源(本地配置 / DeepSeek 官网含峰谷 / OpenRouter / 无价格按 0 计);
设置页「用量统计」段有搜索框与模型列表,点击可编辑价格,保存后金额立即变化。

**排查**:

- 统计卡金额为 `—`:Host 未重载,重启 dsh web;
- 金额明显偏低:该模型在官网/OpenRouter 都无对应条目且无本地价(无价格按 0 计),
  在设置页搜索该模型补本地价;
- 改价后金额没变:确认「已保存 ✓」提示出现;仍不行则看 Host 日志是否有
  settings 写入错误;
- 想完全离线:设置 `priceSyncMs: 0`。

### 1. Agent 规则注入 dizzy-dsh-agent-instructions

**需用户提供**:无。规则文本就在仓库里。

**配置步骤**:编辑 `plugins/agent-instructions/prompts/agent-instructions.md`,
然后走「更新」仪式(删副本 → `dsh plugin add`),**下一轮对话即生效**(注入内容
动态读取,不需要重启)。

**验证**:新会话的系统提示词里出现注入的规则;直接问 agent「你的哨兵规则是什么」
应能复述第一性原理 / 对抗式审查 / 子代理优先 / 喵字开头。

**排查**:规则没出现在新会话 → 装的是旧副本,走「更新」仪式同步 file: 快照。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 架构与开发:双半区机制、平面规则、如何新增子包、合集边界、**§10 DSH 0.1.5-rc.1 适配与复验方法** |
| [docs/THIRD-PARTY-SNAPSHOTS.md](docs/THIRD-PARTY-SNAPSHOTS.md) | 收录的第三方插件上游登记表(当前只有 memory 插件) |
| [docs/THIRD-PARTY-UPDATE.md](docs/THIRD-PARTY-UPDATE.md) | 该插件的更新流程(engines 稀疏覆盖 + 补丁重放) |
| [docs/THIRD-PARTY-PATCHES.md](docs/THIRD-PARTY-PATCHES.md) | 本地补丁登记(当前只有 personal-sidecar 一条) |
| [prompts/daily-local-pull.md](prompts/daily-local-pull.md) | 每日无人值守任务:快进仓库 + 重装本机 profile |

## 脚本

| 脚本 | 用途 |
|---|---|
| `scripts/smoke-plugins.mjs` | 自有插件冒烟测试(mock ctx,mock 内核契约) |
| `scripts/test-usage-scan.mjs` | usage-card 行为回归:直接 apply 安装副本跑 `/dizzy/usage`,覆盖「上次汇总 + 增量」与「空月就近」,以及价目表/峰谷/provider 门控 |
| `scripts/verify-usage-accounting.mjs [YYYY-MM]` | 用量记账口径核对:独立读会话日志,把插件聚合规则与内核 `token-meter` 逐会话比对,退出码表态 |
| `scripts/reapply-third-party-patches.mjs [plugin]` | 重放 `patches/` 到第三方快照(支持按插件过滤,目标缺失自动跳过) |
| `scripts/install-diy-preset.ps1` | 安装「DIY 模式」agent preset(含从本机部署同步官方创作手册快照) |
| `scripts/repair-zstd-header-frame.mjs` | 修复首帧损坏的 `session.jsonl.zstd` |
| `scripts/patch-dsh-history-projections.mjs` | 给本机内核打历史投影补丁(可选,非插件代码) |
| `scripts/patch-dsh-subagent-reasoning.mjs` | 修 0.1.6-alpha.1 的「子代理完成通知带 reasoning 块 → 会话永久卡死」:让 DeepSeek 适配器丢掉无法表达的块而不是整轮失败 |

> 两个 `patch-dsh-*.mjs` 都是**给本机内核打的补丁**,不是插件代码;`npm i -g` 重装 dsh 后需要重跑(默认 dry-run,加 `--apply` 写盘并备份)。

