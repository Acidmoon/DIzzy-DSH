# 第三方插件上游登记表(事实源)

`third-party/` 快照的上游登记,与 `THIRD-PARTY-UPDATE.md` 中的表格是同一事实源,更新时同步。
迁移为 git subtree 后,「跟随分支 / 上游 commit」由 git subtree 关系本身维护,本表记录锚点供核对。

| 插件 | 快照目录 | 上游仓库 | 跟随分支 | 收录版本 | 上游 commit | 收录日期 | 手工补丁 |
|---|---|---|---|---|---|---|---|
| dsh-genui | third-party/dsh-genui | https://github.com/omdsh-dev/dsh-genui | main | 0.8.1 | ceab0ed | 2026-08-14 | 无 |
| dsh-notification | third-party/dsh-notification | https://github.com/omdsh-dev/dsh-notification | main | 0.1.1 | 3e33100 | 2026-08-14 | 无 |
| dsh-vision-toolkit | third-party/dsh-vision-toolkit | https://github.com/Anionex/dsh-vision-toolkit | main | 0.1.2(上游 main 当前 0.1.5) | 8d35621 | 2026-08-14 | 有:exposure.js(见 THIRD-PARTY-PATCHES.md) |
| dsh-anchored-standard | third-party/dsh-anchored-standard | https://github.com/xiaobright/dsh-anchored-standard | main | 0.1.0 | e1277b5 | 2026-08-15 | 无 |
| dsh-subscription-auth | third-party/dsh-subscription-auth | https://github.com/Khellendros97/dsh-subscription-auth | main | 0.2.1 | 338c02e | 2026-08-15 | 有:local(见 THIRD-PARTY-PATCHES.md) |

## 各上游更新形态(决定更新源)

| 插件 | 更新源 | 备注 |
|---|---|---|
| dsh-genui | git `main` 分支 + 版本 tag(v0.4.0~v0.8.0) | **未发布 npm**;tag 可能落后于 main,优先跟 main,发布点核对 package.json 的 version |
| dsh-notification | git `main` 分支 | **无 tag、未发布 npm**,只能跟 main,用 commit 锚定 |
| dsh-vision-toolkit | git `main`(Anionex)+ **已发布 npm**(最新 0.1.4) | 快照内 package.json 的 `repository` 字段指向已失效的 dsh-external 地址,上游在 Anionex;有手工补丁,更新后必须重放 |
| dsh-anchored-standard | git `main` 分支 | **agent preset,不是 cordis 插件**:不挂 cordis.patch.yml、不进 package.json 依赖。收录的是完整仓库;安装 = 复制 `preset/` 到 `~/.dsh/.agent-presets/anchored-standard`(用 `scripts/install-anchored-standard.ps1`)。上游基于 rc.5/47f9438 开发,收录时已对照 rc.6 核对 entry 名与 `system-prompt/assemble` 事件,结构兼容 |
| dsh-subscription-auth | git `main` 分支 + **已发布 npm**(0.2.1) | 上游 [Khellendros97/dsh-subscription-auth](https://github.com/Khellendros97/dsh-subscription-auth);合集走仓库快照而不是 registry,因为有本地补丁(usage 钳零 / 投影守卫 / 独立 OAuth state / Grok 设备流 / 代理感知)。更新后必须重放 `patches/dsh-subscription-auth-local.patch` |

## 记录格式约定

- 收录版本:快照内 package.json 的 `version` 字段(不是 npm 最新版);
- 上游 commit:收录时上游 `main` 的 HEAD 短 hash;
- 手工补丁:该快照是否在 `THIRD-PARTY-PATCHES.md` 登记(有 → 更新后必须重放);
- 更新流程与适配检查:见 `THIRD-PARTY-UPDATE.md`。
