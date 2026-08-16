# dsh-vision-toolkit —— 收录的第三方插件

> 本目录是 **dsh-vision-toolkit 上游仓库快照**,由 Dizzy-DSH 收录以便
> "克隆即装",并以主插件 `dependencies` 的 `file:./third-party/...`
> 依赖形式随主插件安装。
>
> **本快照含本地补丁**,不是上游原版。功能修改应尽量回馈上游;合集侧的
> 持久载体是 `patches/dsh-vision-toolkit-exposure.patch`,覆盖更新后必须重放。

## 上游信息

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/Anionex/dsh-vision-toolkit |
| 收录版本 | `0.1.7`(npm 包 `@anionex/dsh-vision-toolkit@0.1.7`) |
| 上游 commit | `29850a8`(release: prepare v0.1.7; tag `v0.1.7`) |
| License | MIT |
| 功能 | DSH 视觉工程工具集:`vision_glance / ground / detect / crop / trace / pixel_diff` 等原生视觉工具,基于上游 [agent-vision-toolkit](https://github.com/Anionex/agent-vision-toolkit)(`v0.1.0+snapshot.bc9803d`) |
| 手工补丁 | 有,见 [docs/THIRD-PARTY-PATCHES.md](../../docs/THIRD-PARTY-PATCHES.md) 的 `dsh-vision-toolkit-exposure.patch` 与 `dsh-vision-toolkit-windows-ensurepip.patch` |

## 收录说明

- 快照取自上游 `main`(`29850a8` / v0.1.7),排除 `.git`、`node_modules`、`__pycache__`。
- 包名已从停用的 `@dsh-external/dsh-vision-toolkit` 迁到 `@anionex/dsh-vision-toolkit`;
  合集 `package.json` 与 `cordis.patch.yml` 必须跟新包名。
- 本地补丁:
  - `src/exposure.ts` 与已构建的 `lib/exposure.js`:四个核心视觉工具
    (`vision_glance` / `vision_ground` / `vision_detect` / `vision_pixel_diff`)随会话常驻;
  - `src/runtime-install.ts`:Windows 上不把 `USERPROFILE`/`LOCALAPPDATA` 指到隔离 home,
    避免微软商店版 Python 的 `ensurepip` 以 101 退出。

## 更新方式

```bash
git clone --depth 1 https://github.com/Anionex/dsh-vision-toolkit.git <tmp>
robocopy <tmp> third-party/dsh-vision-toolkit /MIR /XD .git node_modules __pycache__ /XF UPSTREAM.md
node scripts/reapply-third-party-patches.mjs dsh-vision-toolkit
# 更新后同步修改上方「收录版本 / 上游 commit」以及
# docs/THIRD-PARTY-SNAPSHOTS.md、docs/THIRD-PARTY-UPDATE.md
```

## 本地安装

本插件**无需单独安装**:它是主插件 `dizzy-dsh` 的 `package.json`
`dependencies` 声明(`"@anionex/dsh-vision-toolkit": "file:./third-party/dsh-vision-toolkit"`),
安装主插件时随依赖自动装入:

```bash
dsh plugin --profile web add file:<仓库绝对路径>
```

重启 `dsh web` 生效;挂载由主插件 `cordis.patch.yml` 的 entry
(id `dsh-vision-toolkit`)完成,无需手改 profile。卸载随主插件
`remove dizzy-dsh` 一起移除。

> 本机若还留着单独安装的 `@dsh-external/dsh-vision-toolkit`,先
> `dsh plugin --profile web remove @dsh-external/dsh-vision-toolkit`,
> 再重装合集,否则会撞旧包名或留下失效 junction。
