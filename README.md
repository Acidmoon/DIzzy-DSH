# 🌀 Dizzy-DSH —— DSH 插件合集

一个「克隆即装」的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件合集:
**一条命令装完,重启即用** —— 余额、用量、Agent 规则、视觉识别、生成式 UI、桌面通知、IDE 侧边栏,一次到位。

无需 npm 发布;仓库本身作为 bundle 层安装,重启后依然生效。

## ✨ 能力总览

### 自有插件

| 插件 | 能力 | 怎么用 | 状态 |
|---|---|---|---|
| 💰 **余额查询** `dizzy-dsh-balance` | DeepSeek 官方账户余额实时显示,每分钟自动刷新 | 输入栏右侧常驻徽章;对话中直接问「余额」或调用 `balance_check` 工具;`/dizzy/balance` 命令 | ✅ 稳定 |
| 📊 **本月用量** `dizzy-dsh-usage-card` | 本地会话日志聚合 token 用量:月度热力图 / 近 7 天趋势 / 今日分模型明细 / 峰谷时段 | 对话区右侧「用量」Tab(对话、轨迹并列);悬浮弹窗看输入/输出/缓存分项;支持月份切换 + 60s 自动刷新 | ✅ 稳定 |
| 🧭 **Agent 规则注入** `dizzy-dsh-agent-instructions` | 向每个会话注入 Agent 规则:用户哨兵规则(第一性原理 / 对抗式审查 / 子代理优先 / 喵字开头)+ 开发规范(不重复造轮子 / 核心约定 / 防御性模式 / 类型安全) | 装完即全局生效,所有会话、所有工作区;编辑规则文本**下一轮对话即生效**,无需重启 | ✅ 稳定 |

### 收录的第三方插件

| 插件 | 能力 | 怎么用 | 状态 |
|---|---|---|---|
| 👁️ **视觉识别** `dsh-vision-toolkit` | 看图问答 / 描述 / OCR / 元素定位 / 检测 / 像素对比 / 长截图 OCR / UI 还原 | `vision_glance` / `vision_ground` / `vision_detect` / `vision_pixel_diff` 四个核心工具**随会话常驻**;其余工具加载 vision-tools skill 后可用 | ✅ 稳定(v0.1.2) |
| 🎨 **生成式 UI** `dsh-genui` | 模型的回答中直接渲染可交互组件:数据卡片、图表、表格、表单、试卷判分、mermaid 流程图、3D 场景 | 模型回答时自动输出 `dsh-ui` 围栏;`render_ui` 工具可把界面渲染到工具行 | ✅ 稳定(v0.8.1) |
| 🔔 **桌面通知** `dsh-notification` | 会话跑完一轮任务时弹系统通知,切走也能知道进度 | 设置 > 通知 可配:结束状态(完成/出错/中止/阻塞)、关键词包含/排除规则 | ✅ 稳定(v0.1.1) |
| 📑 **IDE 侧边栏** `dsh-better-sidebar` | VSCode 风格右侧侧边栏:资源管理器 / 编辑器 / 终端 / Git / 浏览器,按会话隔离 | 界面右侧的侧边栏图标,即点即用 | ✅ 稳定(v0.10.3) |

> 🔗 第三方插件均来自各自上游仓库(快照收录,保留来源与版本),详见 [docs/THIRD-PARTY-SNAPSHOTS.md](docs/THIRD-PARTY-SNAPSHOTS.md)。

## 🚀 快速开始

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

## 📚 文档

| 文档 | 内容 |
|---|---|
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 架构与开发:双半区机制、平面规则、如何新增子包 |
| [docs/THIRD-PARTY-UPDATE.md](docs/THIRD-PARTY-UPDATE.md) | 第三方插件更新方案(git subtree 跟随上游 + 适配清单) |
| [docs/THIRD-PARTY-SNAPSHOTS.md](docs/THIRD-PARTY-SNAPSHOTS.md) | 第三方插件上游登记表(仓库 / 版本 / commit / 补丁) |
| [docs/THIRD-PARTY-PATCHES.md](docs/THIRD-PARTY-PATCHES.md) | 对快照的手工补丁登记(patches/ 目录 + 重放工具) |
