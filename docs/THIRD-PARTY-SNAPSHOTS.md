# 第三方插件上游登记表(事实源)

`third-party/` 快照的上游登记,与 `THIRD-PARTY-UPDATE.md` 中的表格是同一事实源,更新时同步。
迁移为 git subtree 后,「跟随分支 / 上游 commit」由 git subtree 关系本身维护,本表记录锚点供核对。

| 插件 | 快照目录 | 上游仓库 | 跟随分支 | 收录版本 | 上游 commit | 收录日期 | 手工补丁 |
|---|---|---|---|---|---|---|---|
| dsh-genui | third-party/dsh-genui | https://github.com/omdsh-dev/dsh-genui | main | 0.9.1 | 1ca5da4 | 2026-08-22 | 无 |
| dsh-notification | third-party/dsh-notification | https://github.com/omdsh-dev/dsh-notification | main | 0.1.3 | ddec603 | 2026-08-22 | 有:peer-ranges(见 THIRD-PARTY-PATCHES.md) |
| dsh-vision-toolkit | third-party/dsh-vision-toolkit | https://github.com/Anionex/dsh-vision-toolkit | main | 0.1.38 | 5a33bf6 | 2026-08-22 | 有:exposure + windows-ensurepip(见 THIRD-PARTY-PATCHES.md) |
| dsh-anchored-standard | third-party/dsh-anchored-standard | https://github.com/xiaobright/dsh-anchored-standard | main | 0.1.0 | 25f21ae | 2026-08-16 | 无 |
| dsh-subscription-auth | third-party/dsh-subscription-auth | https://github.com/Khellendros97/dsh-subscription-auth | main | 0.2.1 | 338c02e | 2026-08-15 | 有:local + reasoning-effort(见 THIRD-PARTY-PATCHES.md) |
| dsh-gui-customization | third-party/dsh-gui-customization | https://github.com/LAN-TINA-WS/dsh-gui-customization | master | 0.6.3 | 9945cdb | 2026-08-22 | 无(0.6.3 已吸收 keyed-slot) |

## 各上游更新形态(决定更新源)

| 插件 | 更新源 | 备注 |
|---|---|---|
| dsh-genui | git `main` 分支 + 版本 tag(v0.4.0~v0.8.6,main 已到 0.9.1) | **未发布 npm**;tag 可能落后于 main,优先跟 main,发布点核对 package.json 的 version。0.9.1 peer:`^0.1.0-rc.8 \|\| >=0.1.1-rc.0 <0.2.0`,目标 DSH `0.1.1-rc.2` |
| dsh-notification | git `main` 分支 + tag v0.1.3 | 跟 main,用 commit 锚定。上游 peer 仍是 `*`,合集用 `dsh-notification-peer-ranges.patch` 收敛以免 pnpm 合并不出 `0.1.0-rc.*` |
| dsh-vision-toolkit | git `main`(Anionex)+ **已发布 npm** `@anionex/dsh-vision-toolkit@0.1.38` | 包名已从停用的 `@dsh-external/dsh-vision-toolkit` 迁到 `@anionex`;合集 `package.json` / `cordis.patch.yml` 必须跟新包名。有手工补丁,更新后必须重放。0.1.8+ 上游新增 `workers/`(Cloudflare Worker 部署),覆盖时被 `.gitignore` 排除。skill 已改名为 `vision-skills`(旧 `vision-tools` 仍识别) |
| dsh-anchored-standard | git `main` 分支 | **agent preset,不是 cordis 插件**:不挂 cordis.patch.yml、不进 package.json 依赖。收录的是完整仓库;安装 = 复制 `preset/` 到 `~/.dsh/.agent-presets/anchored-standard`(用 `scripts/install-anchored-standard.ps1`)。上游 HEAD 另含 `zero-anchored-standard/`、`whoami-standard/`、`wire-think-standard/` 等变体 |
| dsh-subscription-auth | git `main` 分支 + **已发布 npm**(0.2.1) | 上游 [Khellendros97/dsh-subscription-auth](https://github.com/Khellendros97/dsh-subscription-auth);合集走仓库快照而不是 registry,因为有本地补丁(usage 钳零 / 投影守卫 / 独立 OAuth state / Grok 设备流 / 代理感知 / 思考档位对齐官方最高档)。更新后必须重放 `patches/dsh-subscription-auth-local.patch` 再重放 `patches/dsh-subscription-auth-reasoning-effort.patch` |
| dsh-gui-customization | git `master` + 版本 tag + **已发布 npm**(0.6.3) | 上游是 monorepo,可安装组合插件在 `packages/dsh-gui-customization/`;本快照只收录该子包(含 `lib/`)。默认分支是 `master`。0.6.3 已对 `settings.plugin.item` 做 id+key 双协议,本地 keyed-slot 补丁已删除。也可 `npm pack dsh-gui-customization@<版本>` 覆盖,但 npm 包不含 `src/` |

## 记录格式约定

- 收录版本:快照内 package.json 的 `version` 字段(不是 npm 最新版);
- 上游 commit:收录时上游 `main` 的 HEAD 短 hash;
- 手工补丁:该快照是否在 `THIRD-PARTY-PATCHES.md` 登记(有 → 更新后必须重放);
- 更新流程与适配检查:见 `THIRD-PARTY-UPDATE.md`。
