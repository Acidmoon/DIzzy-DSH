# dsh-anchored-standard —— 收录的第三方预设

> 本目录是 **dsh-anchored-standard 上游仓库快照**。它是 agent preset,
> 不是 cordis 插件:不挂 `cordis.patch.yml`、不进主包 `dependencies`。
> 安装 = 把 `preset/` 复制到 `~/.dsh/.agent-presets/anchored-standard`
> (用仓库根 `scripts/install-anchored-standard.ps1`)。

## 上游信息

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/xiaobright/dsh-anchored-standard |
| 作者 | [xiaobright](https://github.com/xiaobright) |
| 收录版本 | `0.1.0` |
| 上游 commit | `db4527a`(Merge develop: self-contained modes, README restructure) |
| License | MIT |
| 功能 | 首轮用官方 Minimal 真实工具对(`bash` + `str_replace_editor`)锚定轨迹,晋升后走小型 resident 目录;另含 `zero-anchored-standard/` 与 `whoami-standard/` 变体 |

## 收录说明

- 快照取自上游 `main`(`db4527a`),排除 `.git`、`node_modules`。
- **未修改任何上游文件**。合集侧只多这一份 `UPSTREAM.md`。
- `scripts/install-anchored-standard.ps1` 只安装基础模式 `preset/`;两个变体需单独复制到 `~/.dsh/.agent-presets/`。

## 更新方式

```bash
git clone --depth 1 https://github.com/xiaobright/dsh-anchored-standard.git <tmp>
robocopy <tmp> third-party/dsh-anchored-standard /MIR /XD .git node_modules /XF UPSTREAM.md
# 更新后同步修改上方「收录版本 / 上游 commit」以及
# docs/THIRD-PARTY-SNAPSHOTS.md、docs/THIRD-PARTY-UPDATE.md
# 并核对本仓库 scripts/install-anchored-standard.ps1 的必备文件列表
```

## 本地安装

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-anchored-standard.ps1
```

重启 `dsh web` 后,新会话预设下拉选择「Anchored Standard (experimental)」。
