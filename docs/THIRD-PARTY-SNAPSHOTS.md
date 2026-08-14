# 第三方插件上游登记表(事实源)

`third-party/` 快照的上游登记,与 `THIRD-PARTY-UPDATE.md` 中的表格是同一事实源,更新时同步。
迁移为 git subtree 后,「跟随分支 / 上游 commit」由 git subtree 关系本身维护,本表记录锚点供核对。

| 插件 | 快照目录 | 上游仓库 | 跟随分支 | 收录版本 | 上游 commit | 收录日期 | 手工补丁 |
|---|---|---|---|---|---|---|---|
| dsh-genui | third-party/dsh-genui | https://github.com/omdsh-dev/dsh-genui | main | 0.8.1 | ceab0ed | 2026-08-14 | 无 |
| dsh-notification | third-party/dsh-notification | https://github.com/omdsh-dev/dsh-notification | main | 0.1.1 | 3e33100 | 2026-08-14 | 无 |
| dsh-vision-toolkit | third-party/dsh-vision-toolkit | https://github.com/Anionex/dsh-vision-toolkit | main | 0.1.2(上游 main 当前 0.1.5) | 8d35621 | 2026-08-14 | 有:exposure.js(见 THIRD-PARTY-PATCHES.md) |

## 各上游更新形态(决定更新源)

| 插件 | 更新源 | 备注 |
|---|---|---|
| dsh-genui | git `main` 分支 + 版本 tag(v0.4.0~v0.8.0) | **未发布 npm**;tag 可能落后于 main,优先跟 main,发布点核对 package.json 的 version |
| dsh-notification | git `main` 分支 | **无 tag、未发布 npm**,只能跟 main,用 commit 锚定 |
| dsh-vision-toolkit | git `main`(Anionex)+ **已发布 npm**(最新 0.1.4) | 快照内 package.json 的 `repository` 字段指向已失效的 dsh-external 地址,上游在 Anionex;有手工补丁,更新后必须重放 |

## 记录格式约定

- 收录版本:快照内 package.json 的 `version` 字段(不是 npm 最新版);
- 上游 commit:收录时上游 `main` 的 HEAD 短 hash;
- 手工补丁:该快照是否在 `THIRD-PARTY-PATCHES.md` 登记(有 → 更新后必须重放);
- 更新流程与适配检查:见 `THIRD-PARTY-UPDATE.md`。
