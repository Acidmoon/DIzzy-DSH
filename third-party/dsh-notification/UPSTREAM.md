# dsh-notification —— 收录的第三方插件

> 本目录是 **dsh-notification 上游仓库快照**,由 Dizzy-DSH 收录以便
> "克隆即装",并以主插件 `dependencies` 的
> `file:./third-party/dsh-notification` 依赖随主插件安装。
>
> 对上游的修改请到上游仓库提交,本目录只做同步,不做修改。

## 上游信息

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/omdsh-dev/dsh-notification |
| 作者 | [omdsh-dev](https://github.com/omdsh-dev) |
| 收录版本 | `0.1.2` |
| 上游 commit | `2399457`(feat: notify for pending interactions) |
| License | MIT |
| 功能 | 会话跑完一轮任务时弹系统通知;设置 > 通知 可配结束状态与关键词规则 |

## 收录说明

- git subtree 跟随上游 `main`(`2399457` / v0.1.2,`--squash` 模式)。
- **未修改任何上游文件**。合集侧只多这一份 `UPSTREAM.md`。
- 上游无 tag、未发布 npm,只能跟 `main`。

## 更新方式

```bash
git subtree pull --squash --prefix=third-party/dsh-notification https://github.com/omdsh-dev/dsh-notification main
# 更新后同步修改上方「收录版本 / 上游 commit」以及
# docs/THIRD-PARTY-SNAPSHOTS.md、docs/THIRD-PARTY-UPDATE.md
```

## 本地安装

本插件**无需单独安装**:它是主插件 `dizzy-dsh` 的 `package.json`
`dependencies` 声明(`"dsh-notification": "file:./third-party/dsh-notification"`),
安装主插件时随依赖自动装入:

```bash
dsh plugin --profile web add file:<仓库绝对路径>
```

重启 `dsh web` 生效;挂载由主插件 `cordis.patch.yml` 的 entry
(id `dsh-notification`)完成。卸载随主插件 `remove dizzy-dsh` 一起移除。
