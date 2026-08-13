# dsh-vision-toolkit —— 收录的第三方插件

> 本目录是 **dsh-vision-toolkit 上游发布包快照**(源自本机本地 checkout
> `E:\vibecoding\dsh-vision-toolkit`),由 Dizzy-DSH 收录以便"克隆即装",
> 并以主插件 `dependencies` 的 `file:./third-party/...` 依赖形式随主插件安装。
> 对上游的修改请到上游仓库提交,本目录只做同步,不做修改。

## 上游信息

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/Anionex/dsh-vision-toolkit |
| 收录版本 | `0.1.2` |
| 上游 commit | `8d35621`(docs: keep use-case structure and use DSH screenshots for image Q&A) |
| License | MIT |
| 功能 | DSH 视觉工程工具集:`vision_glance / ground / detect / crop / trace / pixel_diff` 等原生视觉工具,基于上游 [agent-vision-toolkit](https://github.com/Anionex/agent-vision-toolkit)(`v0.1.0+snapshot.c27d1a3`) |

## 收录说明

- 快照取自本机已安装的本地 checkout,**包含本地未提交改动**(`src/` 与 `lib/` 中
  `web.ts / upstream.ts / runtime-install.ts` 及对应产物,整文件格式层面重排,
  功能与上游 `0.1.2` 一致)。
- 已排除 `.git`、`node_modules`、`__pycache__`。

## 更新方式

```bash
# 在上游仓库目录拉取最新
git -C <dsh-vision-toolkit 本地路径> pull
# 重新同步快照(排除 .git / node_modules / __pycache__)
robocopy <dsh-vision-toolkit 本地路径> third-party/dsh-vision-toolkit /E /XD .git node_modules __pycache__ /XF *.tgz
# 更新后同步修改上方"收录版本 / 上游 commit"并提交
```

## 本地安装

本插件**无需单独安装**:它是主插件 `dizzy-dsh` 的 `package.json`
`dependencies` 声明(`"@dsh-external/dsh-vision-toolkit": "file:./third-party/dsh-vision-toolkit"`),
安装主插件时随依赖自动装入:

```bash
dsh plugin --profile web add file:<仓库绝对路径>
```

重启 `dsh web` 生效;挂载由主插件 `cordis.patch.yml` 的 entry
(id `dsh-vision-toolkit`)完成,无需手改 profile。卸载随主插件
`remove dizzy-dsh` 一起移除。
