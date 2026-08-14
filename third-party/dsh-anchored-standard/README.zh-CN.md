# dsh-anchored-standard

[English](./README.md)

这是一个实验性的 DeepSeek Harness agent preset：第一次模型请求使用与 Minimal 对齐的
完整 system prompt 和两项工具；会话记录首次持久 `tool/call` 后，开放 Standard 的完整
工具目录。

这是社区项目，并非 DeepSeek 官方 preset，也不代表 DeepSeek 的认可或背书。

## 为什么这样做

DeepSeek V4 Pro 会强烈依赖 API 中可见的工具目录选择执行轨迹。在 Project2 评测中，
Standard 和 PTC 分别得到 91、92 分，官方 Minimal 得到 99、96 分；但如果全程停留在
Minimal，又会失去 Standard 的大部分工具。

Anchored Standard 把“首次轨迹选择”和“后续完整工具能力”拆开：

1. 保持 Minimal 的完整 system prompt；
2. 首次模型请求只暴露当前平台 shell 和 `read`；
3. 会话出现首次 `tool/call` 后开放全部 Standard 工具；
4. 从持久 session event 推导阶段，resume 和 reload 不会丢失状态。

Windows 首次目录为 `pwsh/read`，Linux 为 `bash/read`。

## 实测结果

Project2 V4.1b、DeepSeek V4 Pro、`reasoningEffort=max`、Windows 原生环境：

| 运行 | Ability | reasoning 块 | `we` | `let's` | `let me` | 可见回复 |
|---|---:|---:|---:|---:|---:|---:|
| r1 | 98 | 193 | 179 | 88 | 1 | 1 |
| r2 | 99 | 162 | 165 | 98 | 0 | 1 |

两轮都只出现两份工具目录快照：首次两工具，随后为 25 项 Standard 工具。这证明该方案
在本题同配置下可以复现，不代表它对所有模型和任务都普遍增益。

完整方法和聚合证据见
[`xiaobright/modeltest`](https://github.com/xiaobright/modeltest)。

## 兼容范围

开发和验证版本：

- DeepSeek Harness `0.1.0-rc.5`
- 仓库提交 [`47f9438`](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a)
- Windows / Node.js 24

DeepSeek Harness 目前仍是开发者预览版，官方明确说明未来会有破坏性变更。本 preset 是
Standard 组装的完整快照；升级 Harness 后，应先对照上游改动再继续使用。

## 安装

克隆本仓库，将整个 `preset` 目录复制到用户 preset 根目录，并将目标目录命名为
`anchored-standard`。

PowerShell：

```powershell
$target = Join-Path $env:USERPROFILE '.dsh\.agent-presets\anchored-standard'
if (Test-Path -LiteralPath $target) { throw "Preset already exists: $target" }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
Copy-Item -Recurse -LiteralPath '.\preset' -Destination $target
```

Linux/macOS：

```sh
dsh_home="${DSH_HOME:-$HOME/.dsh}"
mkdir -p "$dsh_home/.agent-presets"
test ! -e "$dsh_home/.agent-presets/anchored-standard"
cp -R preset "$dsh_home/.agent-presets/anchored-standard"
```

完整重启 DeepSeek Harness，新建空 session，选择 **Anchored Standard (experimental)**。
不要在已经产生内容的会话中途切换 preset。

## 验证加载

导出 session JSONL，检查 `request/header`：

- 第一份 header 应只有 `pwsh/read` 或 `bash/read`；
- 首次工具调用后，下一份变更 header 应包含完整 Standard 目录；
- 此后的请求应保持完整目录。

本仓库的零依赖测试：

```sh
npm test
```

## 重要行为

- 第一次模型响应如果没有调用工具，会话不会晋升；
- 工具执行即使失败，只要 `tool/call` 已持久化，下一步仍会晋升；
- 工具目录只变化一次，因此第一、第二次请求之间也会发生一次前缀缓存变化；
- preset 与 shell 访问具有相同信任等级，安装前应自行审阅文件；
- 插件不会发起网络请求，也不增加遥测。

## 官方生态要求

DeepSeek 当前建议社区作者把插件放在自己的 GitHub 项目中，并为仓库添加
[`dsh-plugin`](https://github.com/topics/dsh-plugin) topic 方便发现。官方仓库目前不接受
外部 PR，也没有强制社区插件仓库模板。原文见官方
[`CONTRIBUTING.zh.md`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/CONTRIBUTING.zh.md)。

## 许可证

MIT。`preset/agent.cordis.yml` 基于 DeepSeek Harness Standard preset 修改，原始 DeepSeek
版权和 MIT 许可声明保留在 [`NOTICE`](./NOTICE) 中。
