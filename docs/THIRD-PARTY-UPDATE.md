# 第三方插件更新方案:git subtree 跟随上游

**状态:已迁移(2026-08-16)。** `third-party/dsh-genui`、`dsh-notification`、
`dsh-vision-toolkit`、`dsh-anchored-standard` 已转为 git subtree(`--squash`);
`dsh-gui-customization` 是 monorepo 子包,继续 sparse 覆盖;`dsh-better-sidebar`
走 npm registry。例行更新直接按下方「例行更新流程」执行,不再走纯拷贝覆盖。

## 方案总览

每个 `third-party/<name>` 目录是上游仓库的一个 **git subtree**(`--squash` 模式):
git 原生记录「本目录来自哪个上游、跟随哪个 commit」,更新就是一条 pull 命令,不用再手动
clone-覆盖。本地对上游的任何改动**禁止直接改快照内文件**,必须文件化为
`patches/<plugin>-<描述>.patch`,由重放脚本应用——这样 pull 覆盖时补丁可重放、冲突可定位。

```
更新 = git subtree pull + 补丁重放 + 适配检查 + pnpm install + 重启冒烟验证
```

## 上游登记(事实源)

| 插件 | 快照目录 | 上游仓库 | 跟随分支 | 收录版本 | 上游 commit | 手工补丁 |
|---|---|---|---|---|---|---|
| dsh-genui | third-party/dsh-genui | https://github.com/omdsh-dev/dsh-genui | main | 0.8.6 | 2187fa4 | 无 |
| dsh-notification | third-party/dsh-notification | https://github.com/omdsh-dev/dsh-notification | main | 0.1.2 | 2399457 | 无 |
| dsh-vision-toolkit | third-party/dsh-vision-toolkit | https://github.com/Anionex/dsh-vision-toolkit | main | 0.1.24 | 86fcf71 | 有:exposure + windows-ensurepip |
| dsh-anchored-standard | third-party/dsh-anchored-standard | https://github.com/xiaobright/dsh-anchored-standard | main | 0.1.0 | 25f21ae | 无 |
| dsh-subscription-auth | third-party/dsh-subscription-auth | https://github.com/Khellendros97/dsh-subscription-auth | main | 0.2.1 | 338c02e | 有:local |
| dsh-gui-customization | third-party/dsh-gui-customization | https://github.com/LAN-TINA-WS/dsh-gui-customization | master | 0.6.2 | 57d7098 | 无 |

各上游形态备注:

- **dsh-genui**:未发布 npm,有版本 tag 但可能落后于 main → 跟 `main`,发布时在 package.json 的 `version` 核对;
- **dsh-notification**:无 tag、未发布 npm → 只能跟 `main`,用 commit 锚定;
- **dsh-vision-toolkit**:已发布 npm `@anionex/dsh-vision-toolkit@0.1.24`(旧 scope
  `@dsh-external/dsh-vision-toolkit` 已停用,合集依赖与 patch entry 必须跟新包名);
  有手工补丁,迁移/更新后必须重放 `patches/dsh-vision-toolkit-exposure.patch`
  与 `patches/dsh-vision-toolkit-windows-ensurepip.patch`。上游 0.1.8+ 新增
  `workers/`(Cloudflare Worker 部署,与 DSH 插件本体无关),subtree pull 带入时
  被 `.gitignore` 排除,不入库。
- **dsh-anchored-standard**:**agent preset,不是 cordis 插件**——不挂 cordis.patch.yml、不进
  package.json 依赖,subtree pull 后无需 pnpm install;安装 = 复制 `preset/` 到
  `~/.dsh/.agent-presets/anchored-standard`(用 `scripts/install-anchored-standard.ps1`)。
  上游 HEAD 另含 `zero-anchored-standard/`、`whoami-standard/`、`wire-think-standard/`
  等变体,需单独复制才会出现;`preset/` 下新增的 mjs 文件(如 `context-gate.mjs`)
  会被安装脚本整目录复制,不影响必备列表校验。
- **dsh-subscription-auth**:已发布 npm(0.2.1),合集走仓库快照因为有本地补丁(usage 钳零 /
  投影守卫 / 独立 OAuth state / Grok 设备流 / 代理感知 / schemastery 改 peer /
  思考档位对齐官方最高档)。更新后必须先重放 `patches/dsh-subscription-auth-local.patch`,
  再重放 `patches/dsh-subscription-auth-reasoning-effort.patch`。
- **dsh-gui-customization**:已发布 npm(0.6.2),上游是 monorepo,可安装组合插件在
  `packages/dsh-gui-customization/`;本快照只收录该子包(含已构建 `lib/` 与内置背景图)。
  默认分支 `master`。无本地补丁。monorepo 无法对子包直接 subtree,继续 sparse 覆盖
  (见下方「gui-customization 更新」)或 `npm pack`。

## 一次性迁移(已完成,2026-08-16)

genui / notification / vision-toolkit / anchored-standard 已按下方步骤转为
subtree(`--squash`,每条合并只留一个 squash commit)。迁移过程记录:

1. 备份被补丁的文件与 `UPSTREAM.md`;
2. `git rm -r third-party/<name>` 提交「移除纯拷贝快照」;
3. 逐个 `git subtree add --squash --prefix=third-party/<name> <上游URL> <分支>`;
4. 重放补丁 `node scripts/reapply-third-party-patches.mjs`;
5. 适配检查通过后提交。

> 注意:git subtree add/pull 走 read-tree,**不受 `.gitignore` 约束**,上游被忽略的
> 文件(demo.mp4、pnpm-lock.yaml)会进 index。迁移/更新后要 `git rm --cached` 这些
> 文件再提交,保持忽略规则生效。

## 例行更新流程

```sh
# 1. 跟随上游(逐插件执行;也可一次全部)
git subtree pull --squash --prefix=third-party/dsh-genui https://github.com/omdsh-dev/dsh-genui main
git subtree pull --squash --prefix=third-party/dsh-notification https://github.com/omdsh-dev/dsh-notification main
git subtree pull --squash --prefix=third-party/dsh-vision-toolkit https://github.com/Anionex/dsh-vision-toolkit main
git subtree pull --squash --prefix=third-party/dsh-anchored-standard https://github.com/xiaobright/dsh-anchored-standard main

# 2. 重放补丁(上游已吸收则删除对应 .patch;冲突则手动适配)
node scripts/reapply-third-party-patches.mjs

# 3. 适配检查(见下)
# 4. 依赖变化时:cd C:\Users\17740\.dsh\profiles\web && pnpm install
# 5. 重启 dsh web + 硬刷新 + 冒烟验证(见下)
# 6. 更新本登记表(版本/commit 列),提交
```

### gui-customization 更新(monorepo 子包,非 subtree)

```sh
git clone --depth 1 --filter=blob:none --sparse https://github.com/LAN-TINA-WS/dsh-gui-customization.git <tmp>
git -C <tmp> sparse-checkout set packages/dsh-gui-customization
robocopy <tmp>\packages\dsh-gui-customization third-party\dsh-gui-customization /E /XD .git node_modules /XF UPSTREAM.md
# 还原 UPSTREAM.md(robocopy /E 不删,若用 /MIR 则先备份);也可 npm pack dsh-gui-customization@<版本>(不含 src/)
```

### better-sidebar 更新(npm registry)

```sh
npm pack dsh-better-sidebar@<新版本>
tar -xzf dsh-better-sidebar-<版本>.tgz -C third-party/DSH-better-sidebar --strip-components=1
# 同步把根 package.json 的 "dsh-better-sidebar" 依赖版本钉到同一号
```

### subtree 更新后的忽略文件处理

`git subtree pull` 走 read-tree,`third-party/**/pnpm-lock.yaml`、demo.mp4 等
被忽略文件会重新进入 index。提交前执行:

```sh
git rm --cached third-party/dsh-genui/assets/demo.mp4 third-party/dsh-genui/pnpm-lock.yaml third-party/dsh-notification/pnpm-lock.yaml third-party/dsh-vision-toolkit/pnpm-lock.yaml third-party/dsh-vision-toolkit/workers/moondream-openai-proxy/pnpm-lock.yaml
```

## 适配检查清单(每次 pull 后必过)

1. **补丁重放**:`scripts/reapply-third-party-patches.mjs` 输出 `ok` 或冲突清单;
   上游已吸收该改动的 → 删除对应 `.patch` 并更新登记;冲突 → 按 `patches/` 内说明手动适配。
2. **peer 版本 vs 当前 dsh**:对比新旧 `package.json` 的 `peerDependencies` 与当前 dsh 版本
   (0.1.0-rc.6)是否相容;不相容 → 暂不升级(参考:genui 精确绑定 `^0.1.0-rc.6`,
   vision-toolkit 0.1.24 已对齐 rc.6)。
3. **依赖增删**:`dependencies` 有变化 → profile `pnpm install`;新增 file: 依赖路径要受 `.gitignore` 覆盖。
4. **构建产物**:快照必须带 `lib/`;上游若只推 `src/`,需在快照内自行
   `pnpm install && pnpm run build`(genui/notification/vision-toolkit 均自带 lib/)。
5. **新扩展点**:上游新增的 host 能力(fence-registry、新 slot、新 service、client inject 列表)
   → 确认当前 dsh 已提供;缺则行为降级或挂载失败,此时锁定旧 commit 不升级。
6. **客户端 bundle**:client 半区有变化 → 重启后**硬刷新**(Ctrl+Shift+R)。
7. **体积/忽略规则**:新增大二进制(演示视频、上游锁文件)→ 按 `.gitignore` 现有模式补排除规则。

## 生效验证(重启 dsh web 后)

| 插件 | 冒烟项 |
|---|---|
| dsh-genui | 新会话让模型输出 dsh-ui 围栏 → 正常渲染;工具目录含 `render_ui` |
| dsh-vision-toolkit | 工具目录含 `vision_glance` 等 4 个常驻工具;加载 skill 后出现全部 |
| dsh-notification | 设置 > 通知 出现设置段;授权后测试通知可弹 |
| dsh-subscription-auth | 设置 > 订阅服务 列出四个渠道;`GET /subscription-auth/providers` 返回 JSON;已登录渠道出现在模型选择器 |
| dsh-gui-customization | 设置 → 界面设定 出现配色/氛围光/背景区块;选预设配色即时换肤;刷新后设置仍在 |
| 全部 | host 日志无挂载报错(duplicate entry / 缺 service) |

## 回滚

- 例行更新失败 → `git revert <pull 合并 commit>`,profile `pnpm install` 后重启;
- 迁移失败 → 快照旧内容仍在 git 历史,`git revert` 迁移 commit 即可复原。

## 相关文档

- `THIRD-PARTY-SNAPSHOTS.md` — 上游登记表(本文件的表格与它是同一事实源,更新时同步);
- `THIRD-PARTY-PATCHES.md` — 补丁登记与重放规范;
- `scripts/reapply-third-party-patches.mjs` — 补丁重放工具。