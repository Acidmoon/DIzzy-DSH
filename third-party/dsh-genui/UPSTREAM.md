# dsh-genui —— 收录的第三方插件

> 本目录是 **dsh-genui 上游仓库快照**,由 Dizzy-DSH 收录以便"克隆即装",
> 并以主插件 `dependencies` 的 `file:./third-party/dsh-genui` 依赖随主插件安装。
>
> 对上游的修改请到上游仓库提交,本目录只做同步,不做修改。

## 上游信息

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/omdsh-dev/dsh-genui |
| 作者 | [omdsh-dev](https://github.com/omdsh-dev) |
| 收录版本 | `0.8.6` |
| 上游 commit | `2187fa4`(Merge PR #26 release/v0.8.6-draft; tag `v0.8.6`) |
| License | MIT |
| 功能 | 模型回答中直接渲染 `dsh-ui` 围栏:布局 / 图表 / 表单 / quiz / mermaid / 3D,以及 `render_ui` 工具 |

## 收录说明

- git subtree 跟随上游 `main`(`2187fa4` / v0.8.6,`--squash` 模式)。
- `assets/demo.mp4` 与上游 `pnpm-lock.yaml` 被仓库 `.gitignore` 排除,不入库。
- **未修改任何上游文件**。合集侧只多这一份 `UPSTREAM.md`。

## 更新方式

```bash
git subtree pull --squash --prefix=third-party/dsh-genui https://github.com/omdsh-dev/dsh-genui main
# 更新后同步修改上方「收录版本 / 上游 commit」以及
# docs/THIRD-PARTY-SNAPSHOTS.md、docs/THIRD-PARTY-UPDATE.md
```

## 本地安装

本插件**无需单独安装**:它是主插件 `dizzy-dsh` 的 `package.json`
`dependencies` 声明(`"@omdsh-dev/dsh-genui": "file:./third-party/dsh-genui"`),
安装主插件时随依赖自动装入:

```bash
dsh plugin --profile web add file:<仓库绝对路径>
```

重启 `dsh web` 生效;挂载由主插件 `cordis.patch.yml` 的 entry
(id `genui`)完成。卸载随主插件 `remove dizzy-dsh` 一起移除。
