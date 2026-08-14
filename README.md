# 🌀 Dizzy-DSH —— DSH 插件合集

一个「克隆即装」的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件合集:
**一条命令装完,重启即用** —— 余额、用量、Agent 规则、视觉识别、生成式 UI、桌面通知、IDE 侧边栏,一次到位。

无需 npm 发布;仓库本身作为 bundle 层安装,重启后依然生效。

##  能力总览

### 自有插件

| 插件 | 能力 | 怎么用 | 状态 |
|---|---|---|---|
|  **余额查询** `dizzy-dsh-balance` | DeepSeek 官方账户余额实时显示,每分钟自动刷新 | 输入栏右侧常驻徽章;对话中直接问「余额」或调用 `balance_check` 工具;`/dizzy/balance` 命令 | ✅ 稳定 |
|  **本月用量** `dizzy-dsh-usage-card` | 本地会话日志聚合 token 用量:月度热力图 / 近 7 天趋势 / 今日分模型明细 / 峰谷时段 | 对话区右侧「用量」Tab(对话、轨迹并列);悬浮弹窗看输入/输出/缓存分项;支持月份切换 + 60s 自动刷新 | ✅ 稳定 |
|  **Agent 规则注入** `dizzy-dsh-agent-instructions` | 向每个会话注入 Agent 规则:用户哨兵规则(第一性原理 / 对抗式审查 / 子代理优先 / 喵字开头)+ 开发规范(不重复造轮子 / 核心约定 / 防御性模式 / 类型安全) | 装完即全局生效,所有会话、所有工作区;编辑规则文本**下一轮对话即生效**,无需重启 | ✅ 稳定 |
|  **浏览器控制** `dizzy-dsh-kimi-webbridge` | 通过 Kimi WebBridge(daemon + 浏览器扩展)控制你的**真实浏览器**:打开网页、读取页面、点击、填表、截图、抓包、存 PDF —— 带登录态的会话直接可用 | 渐进式披露:模型先调用 `kimi_browser_activate` 引导工具,随后获得全套 `kimi_browser_*` 工具(导航/快照/点击/输入/截图/标签管理) | ✅ 稳定 |

### 第三方插件(能力速览)

| 插件 | 能力 | 怎么用 | 状态 |
|---|---|---|---|
|  **视觉识别** `dsh-vision-toolkit` | 看图问答 / 描述 / OCR / 元素定位 / 检测 / 像素对比 / 长截图 OCR / UI 还原 | `vision_glance` / `vision_ground` / `vision_detect` / `vision_pixel_diff` 四个核心工具**随会话常驻**;其余工具加载 vision-tools skill 后可用 | ✅ 稳定(v0.1.2) |
|  **生成式 UI** `dsh-genui` | 模型的回答中直接渲染可交互组件:数据卡片、图表、表格、表单、试卷判分、mermaid 流程图、3D 场景 | 模型回答时自动输出 `dsh-ui` 围栏;`render_ui` 工具可把界面渲染到工具行 | ✅ 稳定(v0.8.1) |
|  **桌面通知** `dsh-notification` | 会话跑完一轮任务时弹系统通知,切走也能知道进度 | 设置 > 通知 可配:结束状态(完成/出错/中止/阻塞)、关键词包含/排除规则 | ✅ 稳定(v0.1.1) |
|  **IDE 侧边栏** `dsh-better-sidebar` | VSCode 风格右侧侧边栏:资源管理器 / 编辑器 / 终端 / Git / 浏览器,按会话隔离 | 界面右侧的侧边栏图标,即点即用 | ✅ 稳定(v0.10.3) |

## 收录的第三方插件

本合集收录以下第三方 DSH 插件(快照保留于 `third-party/`),能力与用法见上方
「能力总览」。上游登记与更新方案见 [docs/THIRD-PARTY-SNAPSHOTS.md](docs/THIRD-PARTY-SNAPSHOTS.md)
与 [docs/THIRD-PARTY-UPDATE.md](docs/THIRD-PARTY-UPDATE.md)。

| 插件 | 作者 | 项目 | 地址 | 版本 | 收录方式 |
|---|---|---|---|---|---|
| dsh-vision-toolkit | [Anionex](https://github.com/Anionex) | dsh-vision-toolkit | https://github.com/Anionex/dsh-vision-toolkit | 0.1.2 | 仓库快照 |
| dsh-genui | [omdsh-dev](https://github.com/omdsh-dev) | dsh-genui | https://github.com/omdsh-dev/dsh-genui | 0.8.1 | 仓库快照 |
| dsh-notification | [omdsh-dev](https://github.com/omdsh-dev) | dsh-notification | https://github.com/omdsh-dev/dsh-notification | 0.1.1 | 仓库快照 |
| dsh-better-sidebar | [omdsh-dev](https://github.com/omdsh-dev) | DSH-better-sidebar | https://github.com/omdsh-dev/DSH-better-sidebar | 0.10.3 | npm registry |

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
dsh plugin --profile web add file:<仓库绝对路径>
```

> 收录的第三方插件快照更新走独立流程(跟随上游 + 补丁重放 + 适配检查):
> 见 [docs/THIRD-PARTY-UPDATE.md](docs/THIRD-PARTY-UPDATE.md)。

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

**配置**:零配置,即点即用(界面右侧侧边栏图标)。

**验证**:点开侧边栏,可见资源管理器 / 编辑器 / 终端 / Git / 浏览器分区,按会话隔离。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 架构与开发:双半区机制、平面规则、如何新增子包 |
| [docs/THIRD-PARTY-UPDATE.md](docs/THIRD-PARTY-UPDATE.md) | 第三方插件更新方案(git subtree 跟随上游 + 适配清单) |
| [docs/THIRD-PARTY-SNAPSHOTS.md](docs/THIRD-PARTY-SNAPSHOTS.md) | 第三方插件上游登记表(仓库 / 版本 / commit / 补丁) |
| [docs/THIRD-PARTY-PATCHES.md](docs/THIRD-PARTY-PATCHES.md) | 对快照的手工补丁登记(patches/ 目录 + 重放工具) |
