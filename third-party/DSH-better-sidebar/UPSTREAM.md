# dsh-better-sidebar —— 收录的第三方插件

> 本目录是上游项目的**完整发布包快照**,由 Dizzy-DSH 收录以便"克隆即装"。
> 对上游的修改请到上游仓库提交,本目录只做同步,不做修改。

## 上游信息

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/omdsh-dev/DSH-better-sidebar |
| 收录版本 | `0.10.3`(npm 包 `dsh-better-sidebar@0.10.3`) |
| 上游 commit | `efb2e2bd58965145e8f0c902e333e589dad2f01f`(release/v0.10.3) |
| License | MIT |
| 功能 | VSCode 风格右侧侧边栏:资源管理器 / 编辑器 / 终端 / Git / 浏览器,按会话隔离;暴露 `ctx.betterSidebar` 服务供其他插件注册 tab 与文件预览器 |

## 收录方式

从 npm registry 下载 tarball 解包(含构建产物 `lib/`、源码 `src/`、`cordis.patch.yml`),**未修改任何上游文件**。

## 更新方式

```bash
npm pack dsh-better-sidebar@<新版本>
tar -xzf dsh-better-sidebar-<版本>.tgz -C third-party/DSH-better-sidebar --strip-components=1
# 更新后同步修改上方"收录版本 / 上游 commit"并提交
```

## 本地安装

```bash
dsh plugin --profile web add link:<仓库绝对路径>/third-party/DSH-better-sidebar
```

安装后重启 `dsh web`,侧边栏出现在对话右侧;插件自带 `cordis.patch.yml`(entry id `better-sidebar`),无需手改 profile。
