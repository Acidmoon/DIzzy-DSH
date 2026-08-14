# 第三方插件更新方案:git subtree 跟随上游

**状态:方案已定稿(2026-08-14),尚未执行迁移。** 当前 `third-party/` 还是纯拷贝快照;
下次任一上游需要同步时,先按「一次性迁移」把该插件(或全部)转为 subtree,之后按「例行更新」走。

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
| dsh-genui | third-party/dsh-genui | https://github.com/omdsh-dev/dsh-genui | main | 0.8.1 | ceab0ed | 无 |
| dsh-notification | third-party/dsh-notification | https://github.com/omdsh-dev/dsh-notification | main | 0.1.1 | 3e33100 | 无 |
| dsh-vision-toolkit | third-party/dsh-vision-toolkit | https://github.com/Anionex/dsh-vision-toolkit | main | 0.1.2(上游 main 当前 0.1.5) | 8d35621 | 有:exposure.js 核心工具常驻 |

各上游形态备注:

- **dsh-genui**:未发布 npm,有版本 tag 但可能落后于 main → 跟 `main`,发布时在 package.json 的 `version` 核对;
- **dsh-notification**:无 tag、未发布 npm → 只能跟 `main`,用 commit 锚定;
- **dsh-vision-toolkit**:已发布 npm(0.1.4),上游真实仓库是 **Anionex**(快照内 package.json 的
  `repository` 字段指向已失效的 dsh-external 地址,勿信);main 已有 0.1.5 未打 tag;
  有手工补丁,迁移/更新后必须重放。

## 一次性迁移(未执行;下次同步前完成)

把当前纯拷贝快照转为 subtree。对每个插件(无补丁的先做,有补丁的最后做):

```sh
# 1. 备份被补丁的文件(现在只有 dsh-vision-toolkit/lib/exposure.js)到临时位置。
#    注意:快照的 git 历史里只有补丁版,没有上游原版,不能用 git diff 生成。
#    补丁文件在步骤 3 之后用「上游新版 vs 备份」diff 生成(可能要适配新版)。

# 2. 移除旧快照(内容已在 git 历史,可回滚)
git rm -r third-party/<name>
git commit -m "chore: 移除 <name> 纯拷贝快照,准备改为 subtree 跟随"

# 3. 以上游为源挂入 subtree(--squash 只保留一条合并历史,仓库不膨胀)
git subtree add --squash --prefix=third-party/<name> <上游URL> <分支>

# 4. 重放补丁
node scripts/reapply-third-party-patches.mjs

# 5. 适配检查(见下)→ profile pnpm install → 重启验证 → 提交
```

> 迁移后 `.gitignore` 中针对快照的忽略规则(demo.mp4、pnpm-lock.yaml 等)继续生效:
> subtree pull 带入的被忽略文件只存在于工作区,不进 commit。

## 例行更新流程(迁移完成后)

```sh
# 1. 跟随上游(逐插件执行;也可一次全部)
git subtree pull --squash --prefix=third-party/dsh-genui https://github.com/omdsh-dev/dsh-genui main
git subtree pull --squash --prefix=third-party/dsh-notification https://github.com/omdsh-dev/dsh-notification main
git subtree pull --squash --prefix=third-party/dsh-vision-toolkit https://github.com/Anionex/dsh-vision-toolkit main

# 2. 重放补丁(上游已吸收则删除对应 .patch;冲突则手动适配)
node scripts/reapply-third-party-patches.mjs

# 3. 适配检查(见下)
# 4. 依赖变化时:cd C:\Users\17740\.dsh\profiles\web && pnpm install
# 5. 重启 dsh web + 硬刷新 + 冒烟验证(见下)
# 6. 更新本登记表(版本/commit 列),提交
```

## 适配检查清单(每次 pull 后必过)

1. **补丁重放**:`scripts/reapply-third-party-patches.mjs` 输出 `ok` 或冲突清单;
   上游已吸收该改动的 → 删除对应 `.patch` 并更新登记;冲突 → 按 `patches/` 内说明手动适配。
2. **peer 版本 vs 当前 dsh**:对比新旧 `package.json` 的 `peerDependencies` 与当前 dsh 版本
   (0.1.0-rc.6)是否相容;不相容 → 暂不升级(参考:genui 精确绑定 `^0.1.0-rc.6`,
   vision-toolkit 0.1.5 已对齐 rc.6,旧快照 0.1.2 反而是 `^0.0.1`)。
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
| 全部 | host 日志无挂载报错(duplicate entry / 缺 service) |

## 回滚

- 例行更新失败 → `git revert <pull 合并 commit>`,profile `pnpm install` 后重启;
- 迁移失败 → 快照旧内容仍在 git 历史,`git revert` 迁移 commit 即可复原。

## 相关文档

- `THIRD-PARTY-SNAPSHOTS.md` — 上游登记表(本文件的表格与它是同一事实源,更新时同步);
- `THIRD-PARTY-PATCHES.md` — 补丁登记与重放规范;
- `scripts/reapply-third-party-patches.mjs` — 补丁重放工具。