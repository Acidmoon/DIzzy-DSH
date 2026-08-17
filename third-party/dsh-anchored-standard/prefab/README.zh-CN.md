# Prefab Anchored Standard（实验性）

[English](./README.md)

本目录是一个自包含的 DeepSeek Harness 模式：它把 Anchored Standard composition、
一次成功 roll 的会话模板和会话内预填充插件放在同一目录。安装时只复制 `prefab/`，
运行时不依赖仓库中的 `shared/` 或 `preset/`。预填充不会请求模型，也不会产生 API 费用。

## 一键安装（推荐）

把仓库交给 AI 编程 agent，让它严格执行
[`AGENT_INSTALL.md`](./AGENT_INSTALL.md)。Agent 在 DSH 完全关闭时只需运行一条命令：

```powershell
node .\prefab\install.mjs --confirm-dsh-closed
```

出现 `INSTALL READY` 后，用户启动 DSH、打开任意目标工作区，选择
**Prefab Anchored Standard** 模式并新建会话。该会话会在模式选择完成时自动预填充模板，
随后直接发送评测提示词即可。无需手工复制、修改 YAML、预注册工作区或导入 session。
这条命令安装的是通用模板。

Project2 派生的评测模板只用于复现，必须显式选择；它默认使用独立模式 id，不会静默覆盖
通用安装：

```powershell
node .\prefab\install.mjs --confirm-dsh-closed --template project2
```

该命令把 **Prefab Anchored Project2** 安装为 `prefab-anchored-project2`。

Harness 会先创建空会话、再挂载所选 preset。模式内的 `prefab-session-seed.mjs` 监听
已提交的 preset 选择事件，越过 `Session.append` 的重入边界后，把模板的两轮模型可见
历史写入当前会话。它只重放 turn/step、消息和工具调用/结果，不推送数千条 token chunk，
因此不会在新会话时冲击 WebUI。插件还会把 live Agent 在构造时缓存的 turn 游标同步到
预填充后的第二轮，所以第一条真实提示词从 turn 3 开始，不会重复生成 turn 1。选择操作
返回前预填充已经完成。

## 手工安装（高级）

推荐使用上面的一键安装器。如需人工安装，只需在 DSH 完全关闭时复制目录：

```powershell
$mode = Join-Path $env:USERPROFILE '.dsh\.agent-presets\prefab-anchored-standard'
if (Test-Path -LiteralPath $mode) { throw "Preset already exists: $mode" }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $mode) | Out-Null
Copy-Item -Recurse -LiteralPath '.\prefab' -Destination $mode
```

Linux/macOS：

```sh
dsh_home="${DSH_HOME:-$HOME/.dsh}"
mode="$dsh_home/.agent-presets/prefab-anchored-standard"
mkdir -p "$dsh_home/.agent-presets"
test ! -e "$mode"
cp -R prefab "$mode"
```

安装器默认使用通用模板和 `prefab-anchored-standard`。`install.mjs --preset my-prefab-id`
可以使用其他合法模式 id；预填充插件会从安装目录名识别它。旧的离线实例化流程仍保留
作高级兼容入口：给安装器额外传入
`--cwd 'E:\path\to\workspace'`，会再生成一个 Ready 会话。`instantiate.mjs --dry-run`
只检查替换；`--allowed-tools`、`--rename` 和 `--agents-md` 只用于这条旧式离线路径。

## 实例化时会替换什么

- 在当前空 session 内原位写入两轮预制历史，不创建第二个会话。
- 在推理、消息、工具调用和工具结果中递归替换源 cwd；兼容正斜杠、反斜杠、
  JSON 双反斜杠和 Windows 路径大小写变体。
- 用 `$DSH_HOME/AGENTS.md`、再用目标工作区根 `AGENTS.md` 的原文替换 roll 时指令结果；
  内容相同只注入一次，不扫描 README、目录或源码。两者都不存在时使用中性的“无额外规则”
  结果。
- 预填充时剔除 warm-up 中失败的指令文件读取调用及其错误结果。
- 模板中的 `dev_tool_search` 会为真实任务轮持久解锁 `read`、`write`、`edit`、
  `glob`、`grep`、`ask_user_question`、`todo_write` 和 `web_search`；`bash`、
  `str_replace_editor` 与发现工具仍常驻。

默认通用模板不包含 Project2 事实、README 输出或目录清单。显式 opt-in 的
`templates/project2-benchmark.jsonl` 保留了复现实验使用的 Project2 派生轨迹，不是
通用模板。通用版通过了结构和风格检查，但 API 涨价前没有重新跑完整 Project2 评测。
证据和限制见
[研究贡献](https://github.com/0liveiraaa/DeepseekCotexplorations/tree/main/contributions/xiaobright-v4-tool-surface-dose-response/)。

模板不内置 MCP 工具：保存的请求 schema 与工具调用中均无 MCP 工具，本目录也不发布
MCP server 配置或凭据。使用者若另行在该 preset/profile 中注册 MCP 工具，运行时仍可
通过 `dev_tool_search` 发现并解锁。

## 文件

- `agent.cordis.yml`、`preset.yml` 与本地插件：可安装的 Anchored Standard composition。
- `template.jsonl`：已经审查并内置的会话模板。
- `template.jsonl.meta.json`：roll 来源与轨迹摘要。
- `templates/project2-benchmark.jsonl`：显式 opt-in 的评测模板。
- `prefab-session-seed.mjs`：选择模式时在当前空会话内自动预填充。
- `install.mjs`：一条命令完成模式安装。
- `instantiate.mjs`：兼容用的工作区级离线实例化器。
- `roll-runner.mjs`、`roll-prefab.mjs`：可选的重 roll 工具。

## 可选：重 roll 模板

这一步会真实调用模型并产生费用，需要兼容的 Harness 源码 checkout、用于多帧 zstd 解码
的 Python 3.14，以及已经配置的 `headless` DSH profile。

```powershell
$env:DSH_HARNESS_ROOT = 'E:\path\to\deepseek-harness'
node .\prefab\roll-prefab.mjs --cwd 'E:\path\to\workspace' --attempts 6
```

请限制尝试次数。任何新 roll 的模板都会包含原始推理、提示词、工具调用与结果、路径和工作区
内容；替换仓库内模板前，必须重新检查凭据和非预期数据。
