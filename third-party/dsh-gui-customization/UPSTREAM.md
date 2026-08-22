# dsh-gui-customization —— 收录的第三方插件

> 本目录是 **dsh-gui-customization 上游插件包快照**(不是整个 monorepo),
> 由 Dizzy-DSH 收录以便"克隆即装",并以主插件 `dependencies` 的
> `file:./third-party/dsh-gui-customization` 依赖随主插件安装。
>
> 对上游的修改请到上游仓库提交,本目录只做同步,不做修改。

## 上游信息

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/LAN-TINA-WS/dsh-gui-customization |
| 作者 | [LAN-TINA-WS](https://github.com/LAN-TINA-WS) |
| 收录版本 | `0.6.3` |
| 上游 commit | `9945cdb`(fix: dual-protocol registration for settings.plugin.item; bump 0.6.3) |
| License | MIT |
| 功能 | DSH Web UI 时装工坊:Nous 蓝默认配色(明暗双模式)+ 四预设 + 13 色自定义(明暗可分开编辑)、氛围光、图片/视频背景、配色导入导出、中英双语;入口在「设置 → 界面设定」 |

## 收录说明

- 上游是 monorepo,可安装的组合插件在 `packages/dsh-gui-customization/`。
  本快照只收录该子包(含已构建的 `lib/` 与内置背景图),不含仓库根的
  `plugins/` 动态原型、`docs/`、`build/`、`templates/`。
- 已排除 `.git`、`node_modules`。
- **未修改任何上游文件**(0.6.3 已吸收 keyed-slot 双协议,本地补丁已删除)。合集侧只多这一份 `UPSTREAM.md`。
- 包自带 `dsh.bundle.patch`(id `ui-gui-customization`),但合集安装时它
  **不会**作为独立 bundle 生效(reconcile 只扫 profile 顶层依赖)。挂载
  由主插件 `cordis.patch.yml` 的 entry(id `ui-gui-customization`,与上游
  自带 patch 一致)完成。

## 更新方式

```bash
# 拉取上游子包(sparse)后覆盖本目录
git clone --depth 1 --filter=blob:none --sparse https://github.com/LAN-TINA-WS/dsh-gui-customization.git <tmp>
git -C <tmp> sparse-checkout set packages/dsh-gui-customization
robocopy <tmp>\packages\dsh-gui-customization third-party\dsh-gui-customization /E /XD .git node_modules /XF UPSTREAM.md
# 更新后同步修改上方「收录版本 / 上游 commit」以及
# docs/THIRD-PARTY-SNAPSHOTS.md、docs/THIRD-PARTY-UPDATE.md
```

也可从 npm 取发布包:`npm pack dsh-gui-customization@<版本>` 后解压覆盖
(发布包不含 `src/`,本快照刻意保留源码便于对照)。

当前仍是纯拷贝快照。未迁 subtree 前不要对快照内上游文件做本地补丁。

## 本地安装

本插件**无需单独安装**:它是主插件 `dizzy-dsh` 的 `package.json`
`dependencies` 声明(`"dsh-gui-customization": "file:./third-party/dsh-gui-customization"`),
安装主插件时随依赖自动装入:

```bash
dsh plugin --profile web add file:<仓库绝对路径>
```

重启 `dsh web` 生效;打开「设置 → 界面设定」配置。卸载随主插件
`remove dizzy-dsh` 一起移除。

> 若本机曾经单独 `dsh plugin add dsh-gui-customization`(或 GitHub 直装),
> 合集接管前先 `dsh plugin --profile web remove dsh-gui-customization`。
> 两套同时挂会撞 `duplicate loader entry id: ui-gui-customization`。
