# 🌀 Dizzy-DSH —— DSH 插件合集

一个「克隆即装」的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件合集:
**一条命令装完,重启即用** —— 余额/额度、用量、Agent 规则、浏览器控制、订阅登录、视觉识别、生成式 UI、桌面通知、IDE 侧边栏、界面换装,一次到位。

无需 npm 发布;仓库本身作为 bundle 层安装,重启后依然生效。

##  能力总览

### 自有插件

| 插件 | 能力 | 怎么用 | 状态 |
|---|---|---|---|
|  **余额/额度** `dizzy-dsh-balance` | 输入栏同一徽章:DeepSeek 显示人民币余额,Grok 显示 SuperGrok 周额度剩余%。Grok 凭证读订阅插件 `GROK_SUBSCRIPTION_TOKEN` | 切到对应模型即显示;问「余额」/`balance_check` 或「Grok 额度」/`grok_quota_check` | ✅ 稳定 |
|  **本月用量** `dizzy-dsh-usage-card` | 本地会话日志聚合 token 用量 + **人民币金额**:DeepSeek 官方价(含峰谷,官网自动取)+ OpenRouter 聚合价兜底 + 本地可覆盖:月度热力图 / 近 7 天趋势 / 今日分模型堆叠条(输入未命中 / 命中缓存 / 输出) / 峰谷时段 / 本月花费统计卡 | 对话区右侧「用量」Tab(对话、轨迹并列);曲线按横坐标吸附最近一天;悬浮弹窗看分项并跟随鼠标;支持月份切换 + 60s 自动刷新;设置页「用量统计」段看花费概览与价格配置 | ✅ 稳定 |
|  **Agent 规则注入** `dizzy-dsh-agent-instructions` | 向每个会话注入 Agent 规则:用户哨兵规则(第一性原理 / 对抗式审查 / 子代理优先 / 喵字开头)+ 开发规范(不重复造轮子 / 核心约定 / 防御性模式 / 类型安全) | 装完即全局生效,所有会话、所有工作区;编辑规则文本**下一轮对话即生效**,无需重启 | ✅ 稳定 |
|  **浏览器控制** `dizzy-dsh-kimi-webbridge` | 通过 Kimi WebBridge(daemon + 浏览器扩展)控制你的**真实浏览器**:打开网页、读取页面、点击、填表、截图、抓包、存 PDF —— 带登录态的会话直接可用 | 渐进式披露:模型先调用 `kimi_browser_activate` 引导工具,随后获得全套 `kimi_browser_*` 工具(导航/快照/点击/输入/截图/标签管理) | ✅ 稳定 |

### 第三方插件(能力速览)

| 插件 | 能力 | 怎么用 | 状态 |
|---|---|---|---|
|  **视觉识别** `dsh-vision-toolkit` | 看图问答 / 描述 / OCR / 元素定位 / 检测 / 像素对比 / 长截图 OCR / UI 还原 | `vision_glance` / `vision_ground` / `vision_detect` / `vision_pixel_diff` 四个核心工具**随会话常驻**;其余工具加载 vision-tools skill 后可用 | ✅ 稳定(v0.1.24) |
|  **生成式 UI** `dsh-genui` | 模型的回答中直接渲染可交互组件:数据卡片、图表、表格、表单、试卷判分、mermaid 流程图、3D 场景 | 模型回答时自动输出 `dsh-ui` 围栏;`render_ui` 工具可把界面渲染到工具行 | ✅ 稳定(v0.8.6) |
|  **桌面通知** `dsh-notification` | 会话跑完一轮任务时弹系统通知,切走也能知道进度 | 设置 > 通知 可配:结束状态(完成/出错/中止/阻塞)、关键词包含/排除规则 | ✅ 稳定(v0.1.2) |
|  **IDE 侧边栏** `dsh-better-sidebar` | VSCode 风格右侧侧边栏:资源管理器 / 编辑器 / 终端 / Git / 浏览器,按会话隔离 | 界面右侧的侧边栏图标,即点即用 | ✅ 稳定(v0.12.3) |
|  **订阅登录** `dsh-subscription-auth` | 用订阅会员账号 OAuth 登录模型提供商,而不是 API key:ChatGPT Plus/Pro、Claude Pro/Max、Grok、Kimi Code;登录后自动发现模型并出现在模型选择器 | 设置 → 订阅服务 点「登录」;已登录渠道会出现在模型选择器,可选手动思考强度 | ✅ 稳定(v0.2.1,有本地补丁) |
|  **界面设定** `dsh-gui-customization` | DSH Web UI 时装工坊:Nous 蓝默认配色(明暗双模式)+ 四预设 + 13 色自定义(明暗可分开编辑)、氛围光、图片/视频背景(含内置 deepseek娘 01/02/03)、配色导入导出、中英双语 | 设置 → 界面设定;配色/背景保存在本机浏览器,刷新与重启后仍在 | ✅ 稳定(v0.6.2) |

### 自有预设(agent preset)

| 预设 | 能力 | 怎么用 | 状态 |
|---|---|---|---|
|  **DIY 模式** `diy` | 持久造物：合集子包 / agent preset / 技能。不挂 `tool-cordis`，与官方「创造模式」解耦，两边可同进程共存 | 运行 `scripts/install-diy-preset.ps1` 装到 `~/.dsh/.agent-presets/diy`，重启后新会话选「DIY 模式」。动态插件探测请另开创造模式 | ✅ 稳定 |

### 收录的第三方预设(agent preset)

| 预设 | 能力 | 怎么用 | 状态 |
|---|---|---|---|
|  **Anchored Standard** `dsh-anchored-standard` | 两阶段工具目录引导:首个模型请求只暴露官方 Minimal 的真实工具对(`bash` + `str_replace_editor`),并对齐 Minimal 的系统提示词条件;会话记录首次工具调用或助手回复后,晋升到小型 resident 目录,重型 Standard 工具按需解锁;阶段由持久会话事件推导,resume/刷新不丢状态 | 运行 `scripts/install-anchored-standard.ps1` 装到 `~/.dsh/.agent-presets/`,重启后新会话预设选择「Anchored Standard (experimental)」 | ✅ 稳定(v0.1.0 @ `25f21ae`) |

## 收录的第三方插件

本合集收录以下第三方 DSH 插件,能力与用法见上方「能力总览」。多数以仓库快照
放在 `third-party/`(随主包 `file:` 依赖安装);`dsh-better-sidebar` 走 npm
registry。上游登记与更新方案见 [docs/THIRD-PARTY-SNAPSHOTS.md](docs/THIRD-PARTY-SNAPSHOTS.md)
与 [docs/THIRD-PARTY-UPDATE.md](docs/THIRD-PARTY-UPDATE.md)。
`dsh-gui-customization` 只收录上游 monorepo 的插件包子目录
(`packages/dsh-gui-customization/`),不是整个仓库。

| 插件 | 作者 | 项目 | 地址 | 版本 | 收录方式 |
|---|---|---|---|---|---|
| dsh-vision-toolkit | [Anionex](https://github.com/Anionex) | dsh-vision-toolkit | https://github.com/Anionex/dsh-vision-toolkit | 0.1.24 | 仓库快照(包名 `@anionex/dsh-vision-toolkit`) |
| dsh-genui | [omdsh-dev](https://github.com/omdsh-dev) | dsh-genui | https://github.com/omdsh-dev/dsh-genui | 0.8.6 | 仓库快照 |
| dsh-notification | [omdsh-dev](https://github.com/omdsh-dev) | dsh-notification | https://github.com/omdsh-dev/dsh-notification | 0.1.2 | 仓库快照 |
| dsh-better-sidebar | [omdsh-dev](https://github.com/omdsh-dev) | DSH-better-sidebar | https://github.com/omdsh-dev/DSH-better-sidebar | 0.12.3 | npm registry |
| dsh-anchored-standard | [xiaobright](https://github.com/xiaobright) | dsh-anchored-standard | https://github.com/xiaobright/dsh-anchored-standard | 0.1.0 | 仓库快照(agent preset) |
| dsh-subscription-auth | [Khellendros97](https://github.com/Khellendros97) | dsh-subscription-auth | https://github.com/Khellendros97/dsh-subscription-auth | 0.2.1 | 仓库快照 + 本地补丁 |
| dsh-gui-customization | [LAN-TINA-WS](https://github.com/LAN-TINA-WS) | dsh-gui-customization | https://github.com/LAN-TINA-WS/dsh-gui-customization | 0.6.2 | 仓库快照(插件包子目录) |

##  快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/Acidmoon/DIzzy-DSH.git

# 2. 一条命令安装全部插件(自有 + 收录的第三方)
dsh plugin --profile web add file:<仓库绝对路径>

# 3. 重启 dsh web,全部生效(含浏览器 UI)
```

> ⚠️ 必须用 **`file:`** 而不是 `link:`(`link:` 不安装依赖树,插件无法加载)。

> ⚠️ 首次安装如遇 `ERR_PNPM_IGNORED_BUILDS: node-pty / protobufjs`:在
> `~/.dsh/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds` 里把两者设为
> `true`,重新 add 即可。

**卸载**:`dsh plugin --profile web remove dizzy-dsh`(自有与收录插件随依赖一起移除)

**更新**:`git pull` 后删除 profile 里的旧副本再重装:

```powershell
Remove-Item ~/.dsh/profiles/web/node_modules/dizzy-dsh* -Recurse -Force
Remove-Item ~/.dsh/profiles/web/node_modules/dsh-subscription-auth -Recurse -Force
Remove-Item ~/.dsh/profiles/web/node_modules/dsh-gui-customization -Recurse -Force
Remove-Item ~/.dsh/profiles/web/node_modules/@anionex -Recurse -Force
Remove-Item ~/.dsh/profiles/web/node_modules/@dsh-external -Recurse -Force
Remove-Item ~/.dsh/profiles/web/node_modules/@omdsh-dev -Recurse -Force
dsh plugin --profile web add file:<仓库绝对路径>
```

> ⚠️ **每次仓库改动后都要走这一步**(新增/修改插件、改 `cordis.patch.yml`、
> 改 `plugins/` 代码):pnpm 对 `file:` 依赖只检测 `package.json` 是否变化,
> **不会同步 patch 文件与子包内容**——只跑 `pnpm install` 会导致插件挂载不上
> (实测:改了 `cordis.patch.yml` 只 `pnpm install`,重启后新 entry 完全不生效)。

> 收录的第三方插件快照更新走独立流程(跟随上游 + 补丁重放 + 适配检查):
> 见 [docs/THIRD-PARTY-UPDATE.md](docs/THIRD-PARTY-UPDATE.md)。

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

### 启用 Anchored Standard 预设(可选)

`dsh-anchored-standard` 是 **agent preset,不走 `dsh plugin add` 机制**,安装 = 把快照的
`preset/` 目录复制到用户预设根:

```powershell
# 4. (可选)安装 Anchored Standard 预设(两阶段工具目录引导)
powershell -ExecutionPolicy Bypass -File scripts\install-anchored-standard.ps1
```

脚本幂等:目标已存在且文件齐全时跳过;缺文件时补全;加 `-Force` 覆盖为快照版。装完**重启
dsh web**,新会话的预设下拉选择「Anchored Standard (experimental)」。

> ⚠️ 不要在已经产生内容的会话中途切换 preset;首次请求只暴露官方 Minimal 的
> `bash` + `str_replace_editor`,第一次工具调用或助手回复后才晋升到 resident
> 目录(重型工具按需解锁),这是设计行为。

## 插件配置指南(Agent 向)

> 本段写给读取本仓库的 AI Agent:当用户要求「配置 / 启用 / 排查」本合集的
> 插件时,按下列流程执行。**「需用户提供」中缺什么就向用户问什么**,不要擅自
> 假设或编造;拿不到就停下来说明。

### 通用步骤(所有插件)

1. 确认已安装:`dsh plugin --profile web list` 应包含 dizzy-dsh;没有则先走「快速开始」;
2. 配置改动后一律**重启 dsh web + 浏览器硬刷新**(Ctrl+Shift+R);
3. 配置文件:DSH 设置 `~/.dsh/settings.yaml`;**密钥只进 DSH credentials**
   (`~/.dsh/.credentials.yaml` / 设置界面),settings 里只放 credential 引用,绝不写明文密钥。

### 0. 浏览器控制 dizzy-dsh-kimi-webbridge(自有)

**需用户提供**:无密钥。但依赖 Kimi 官方的两个组件(不在本仓库):
① daemon(`%USERPROFILE%\.kimi-webbridge\bin\kimi-webbridge.exe`,监听 127.0.0.1:10086)
② Chrome/Edge 的 **Kimi WebBridge 浏览器扩展**(需已安装并连接)。

**配置步骤**:

1. 检测 daemon:POST `http://127.0.0.1:10086/status`(或工具调用时插件会自动尝试启动);
   daemon 缺失 → 请用户到 https://www.kimi.com/zh-cn/features/webbridge 安装;
2. 检查 `/status` 的 `extension_connected`;为 false → 请用户检查浏览器扩展是否启用;
3. 无配置文件;工具调用时插件会自动处理 session 命名与 daemon 自愈。

**验证**:让模型调用 `kimi_browser_activate`,随后工具目录出现全套 `kimi_browser_*`;
让模型打开一个网页并截图,截图路径可用 `vision_glance` 查看。

**排查**:`kimi_browser_* 失败:浏览器扩展未连接` → 检查扩展;错误含
「Please update the Kimi WebBridge extension」→ 让用户更新扩展;
daemon 无法连接且自动启动失败 → 让用户手动运行
`& "$env:USERPROFILE\.kimi-webbridge\bin\kimi-webbridge.exe" start`。

### 0.5 订阅登录 dsh-subscription-auth(第三方,有本地补丁)

**需用户提供**:对应渠道的订阅账号(ChatGPT Plus/Pro、Claude Pro/Max、Grok SuperGrok / X Premium+、Kimi Code)。**不要向用户索取 API key**;登录走 OAuth,令牌由插件写入 DSH credentials。

**配置步骤**:

1. 打开 **设置 → 订阅服务**:四个渠道始终列出,显示登录状态、账号与可用模型;
2. 点对应渠道的「登录」:
   - **ChatGPT / Claude**(授权码 + PKCE):本机浏览器打开授权页 → 用户授权 → 跳回 `127.0.0.1` 回调。**必须在本机跑 dsh**,远程/无桌面环境收不到回调;
   - **Grok / Kimi**(设备授权流):页面展示验证链接 + 设备码 → 用户在浏览器打开并输入代码;
3. 登录成功后该提供商出现在模型选择器;可选手动思考强度(ChatGPT 默认 `medium`,最高 `max`;Claude 默认 `high`,最高 `max`;Grok 最高 `xhigh`;Kimi 默认/最高 `max`);
4. 可选:在 `settings.yaml` 的 `subscription-auth-<id>` 段覆盖 `apiBaseURL` / `redirectPort` / `maxTokens`,或用 `models` 手动固定模型列表。密钥只进 credentials,settings 里不要写令牌。

**验证**:设置页该渠道显示「已登录」;模型选择器出现对应提供商;新会话切到该模型能发出一轮请求。日志:`~/.dsh/tmp/subscription-auth.log`;状态:`GET /subscription-auth/providers`。切到 Grok 模型后,输入栏原余额位置应显示周额度剩余百分比。

**排查**:

- 设置页有渠道、模型选择器没有:未登录或令牌失效——重新登录。未登录渠道故意不注册 provider;
- ChatGPT / Claude 点登录无反应或一直 pending:`rundll32` 打开浏览器失败,或本机 1455 / 54545 端口被占;不要用 `cmd /c start`(URL 里的 `&` 会被截断);
- `history unavailable` + `uncachedInputTokens` / `Too small: expected number to be >=0`:旧会话日志里有负 usage。写入侧已钳零,读路径有投影守卫;仍炸则换新会话,不要改 DSH 内核;
- 已有本机 junction 试装(`~/.dsh/profiles/web/cordis.patch.yml` 再 insert 一次同 id):会与合集 patch 撞 `duplicate loader entry id`。合集接管后删掉 profile 那条 insert,并删掉指向仓库外的 junction。

### 0.6 余额/额度徽章 dizzy-dsh-balance(自有)

**需用户提供**:DeepSeek 走 `DEEPSEEK_API_KEY`;Grok **无单独密钥**,凭证复用订阅插件写入的 `GROK_SUBSCRIPTION_TOKEN`(先完成 §0.5 的 Grok 登录)。

**配置步骤**:

1. DeepSeek:在 credentials 配好 `DEEPSEEK_API_KEY`,切到官方模型即可看到 ¥;
2. Grok:确认设置 → 订阅服务 → Grok 为「已登录」,再把模型切到 Grok —— 同一位置显示剩余百分比;
3. 可选:`settings.yaml` 的 `dizzy-balance` 段覆盖 `refreshIntervalMs` / `grokBillingBaseURL`(企业代理)。不要改 `grokCredentialName`,除非你自己换了凭据引用。

**验证**:DeepSeek 时 `GET /dizzy/balance` 有 `balanceCny`;Grok 时 `GET /dizzy/grok-quota` 有 `remainingPercent`。问「Grok 额度」应调用 `grok_quota_check`。未登录提示去订阅服务。

**排查**:

- 徽章不出现:当前既不是 `deepseek-official` 也不是 `grok`,或 client 半区未加载(删 `node_modules/dizzy-dsh-balance` 后重装合集并重启);
- Grok 显示「未登录」:先走 §0.5 登录,不要向用户要 cookie / API key;
- HTTP 401 反复失败:refresh token 失效,重新在订阅服务登录;
- 数字对不上 grok.com 网页:网页还有 2h 查询桶,本插件只读 CLI 周额度账本。

### 0.65 用量统计与金额 dizzy-dsh-usage-card(自有)

**需用户提供**:无。金额按**人民币**计价,开箱即用:
DeepSeek 官方模型按 [官网价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)
自动计价(含峰谷两档,按每条消息的实际时间计费);其他模型取
[OpenRouter](https://openrouter.ai/models) 聚合价(美元 × `fxRate` 换算);
价格不对时可在设置页直接调整,实时生效。

**配置步骤**:

1. 零配置:用量 Tab 统计卡第一张即「本月花费」。价格优先级:
   **本地配置 > DeepSeek 官网价(峰谷) > OpenRouter 聚合价(6 小时同步)**;
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

### 1. 视觉识别 dsh-vision-toolkit

**需用户提供**:① 视觉模型 API 的 `baseUrl`(OpenAI 兼容,`/v1` 结尾)② API key
③ 模型名(如 `mimo-v2.5`、`gemini-3.6-flash`)。

**配置步骤**:

1. 向用户索取上述三项;用户没有明确倾向时,可沿用默认形态
   (`credential` 名 `VISION_API_KEY`,`language: zh`);
2. 把 API key 写入 DSH credentials,名字与 `provider.credential` 一致
   (默认 `VISION_API_KEY`);
3. 写入 `settings.yaml` 的 `vision-toolkit` 段(实测可用示例):

```yaml
vision-toolkit:
  provider:
    baseUrl: https://api.xiaomimimo.com/v1
    credential: VISION_API_KEY
    model: mimo-v2.5
  language: zh
  timeoutMs: 60000
  maxImageBytes: 10485760
  maxImagePixels: 40000000
  concurrency: 4
  runtime:
    mode: managed
  allowedDirs: []
```

   或让用户走 **设置 > Vision Toolkit** 的 Web 编辑器(保存前会预检,非法配置拒绝保存);
4. 重启 + 硬刷新。

**验证**:新会话给模型一张图片,让它用 `vision_glance` 描述;工具目录应直接
出现 `vision_glance` / `vision_ground` / `vision_detect` / `vision_pixel_diff`
四个常驻工具(其余工具加载 vision-tools skill 后出现)。

**排查**:

- host 日志报 `runtime not ready`:运行时未就绪——`managed` 模式会自动准备上游
  Python 工具链,失败多为网络/磁盘问题;或改用 `runtime.mode: external` 并指定
  `agentVisionToolkitPath` / `python` 指向已有环境;
- 调用报 credential 错误:检查 credentials 里是否真的设置了对应名字的 key;
- 只能看到 4 个常驻工具:正常,其余工具由 vision-tools skill 激活。

### 2. 生成式 UI dsh-genui

**需用户提供**:无。

**配置**:零配置。可选增强——把 `third-party/dsh-genui/SKILL.md` 复制到
`~/.dsh/skills/genui/`,让模型拿到更细的「内容 → 组件」映射。

**验证**:新会话要求「用 dsh-ui 画一个统计仪表盘」,回答中应直接渲染出组件;
工具目录含 `render_ui` / `validate_dsh_ui`。

**排查**:

- `dsh-ui` 围栏渲染成代码块:未重启 / 未硬刷新 / 插件不在 bundle 列表;
- scene3d / mermaid 空白:按需资产路由失效——先硬刷新,仍不行则
  `dsh plugin --profile web remove dizzy-dsh` 后重新 add(快照重装)。

### 3. 桌面通知 dsh-notification

**需用户提供**:无(浏览器权限由用户本人操作)。

**配置步骤**:

1. 打开 **设置 > 通知**:确认「启用通知」为开,点击授权按钮授予浏览器
   Notification 权限,并发送测试通知确认能弹;
2. 按需调整:结束状态开关(完成 / 出错 / 中止 / 阻塞 / 达 Token 上限)、
   关键词包含/排除规则、需要手动关闭、仅在任务不在眼前时通知;
3. 可选 host 参数:profile 的 `cordis.yml` 中 `dsh-notification` 行
   `config.maxBodyChars`(默认 400,通知正文预算)。

**验证**:让模型跑一个耗时任务,切到其他标签页,任务完成时应收到系统通知。

**排查**:标签页**关闭**后不弹(浏览器限制,页面需处于打开状态);断线期间完成的
轮次重连后不补发;站点权限被拒后页面内无法恢复,需浏览器站点设置里改回。

### 4. IDE 侧边栏 dsh-better-sidebar

**需用户提供**:无。

**配置**:零配置,即点即用(界面右侧侧边栏图标)。v0.12.2 起内置 Office 预览(docx/xlsx/pptx)已拆出,需要时另装上游推荐的扩展插件。

**验证**:点开侧边栏,可见资源管理器 / 编辑器 / 终端 / Git / 浏览器分区,按会话隔离。

### 5. 界面设定 dsh-gui-customization

**需用户提供**:无密钥、无 `settings.yaml`。背景图 / 视频从本机选;内置三张
「deepseek娘」预设可直接用。文案随 DSH 语言在中 / 英之间切换。

**配置步骤**:

1. 打开 **设置 → 界面设定**(设置 → 插件 区也有一张识别卡片);
2. 预设配色四选一(系统默认 / Nous 蓝 / 靛紫 / 翡翠绿),或改 13 个颜色字段后点「应用配色」(不是每个字段即时写回);
3. 氛围光:开关、强度、呼吸幅度、位置(右上·左下 / 左上·右下 / 顶 / 底 / 居中)实时生效;
4. 背景:选图片 / 内置预设 01–03 / 选视频(静音循环,与图片互斥);调背景透明度(10%–90%)与侧边栏透明;
5. 配色可导出 JSON(自动复制剪贴板)或粘贴导入。导出不含背景图 / 视频。

设置走浏览器 `localStorage`,图片 / 视频走 IndexedDB,跟当前浏览器走,不进
`settings.yaml`,也不跨设备。选「系统默认」会清掉已保存的配色设置(背景图可保留)。

**验证**:设置页出现「界面设定」段;换预设后面板配色立即变;刷新页面后设置仍在。
`dsh --profile web --dump-config` 的 `# == dizzy-dsh` 段应有
`id: ui-gui-customization`。

**排查**:

- 设置里没有「界面设定」:未重装合集或未硬刷新。走「更新」仪式(删 `dizzy-dsh*` 与 `dsh-gui-customization` 副本再 add)后重启 + Ctrl+Shift+R;
- 曾单独 `dsh plugin add dsh-gui-customization`(或 GitHub 直装):合集接管前先 `remove` 那份,否则会撞 `duplicate loader entry id: ui-gui-customization`;
- 大背景图不显示:上游 0.5.1 已改 Blob URL;确认快照版本 ≥ 0.6.2;
- 侧边栏开透明后 better-sidebar 衬底可能发虚:关「侧边栏透明」即可,不是挂载失败;
- 换浏览器 / 清站点数据会丢配色和背景,这是浏览器存储,不是合集没装上。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 架构与开发:双半区机制、平面规则、如何新增子包 |
| [docs/THIRD-PARTY-UPDATE.md](docs/THIRD-PARTY-UPDATE.md) | 第三方插件更新方案(git subtree 跟随上游 + 适配清单) |
| [docs/THIRD-PARTY-SNAPSHOTS.md](docs/THIRD-PARTY-SNAPSHOTS.md) | 第三方插件上游登记表(仓库 / 版本 / commit / 补丁) |
| [docs/THIRD-PARTY-PATCHES.md](docs/THIRD-PARTY-PATCHES.md) | 对快照的手工补丁登记(patches/ 目录 + 重放工具) |
