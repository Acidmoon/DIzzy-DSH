# 第三方插件更新方案

**状态(2026-09):**本合集只保留**一个**第三方插件
(`dsh-plugin-memory-tencentdb`)。其余曾收录的插件与其快照、本地补丁已全部
移除,原因见 `THIRD-PARTY-SNAPSHOTS.md` 的说明 —— 快照跟随上游漂移,上游改
peer 范围或新增运行时依赖就会让合集装不上或起不来,而排查成本落在本仓库。

因此本文件只覆盖这唯一一个插件的更新流程。**禁止直接改快照内上游文件**而不
留 `patches/`;本地对上游的改动必须文件化为
`patches/<plugin>-<描述>.patch`。

## 上游登记(事实源)

与 `THIRD-PARTY-SNAPSHOTS.md` 是同一事实源,更新时同步。

| 插件 | 快照目录 | 上游仓库 | 跟随分支 | 收录版本 | 上游 commit | 手工补丁 |
|---|---|---|---|---|---|---|
| dsh-plugin-memory-tencentdb | third-party/dsh-plugin-memory-tencentdb | https://github.com/TencentCloud/TencentDB-Agent-Memory（适配层 + engines/ 稀疏快照） | feat/server_team | 0.1.2 | 97f9465 | 有:personal-sidecar |

形态备注:

- **dsh-plugin-memory-tencentdb**:DSH 适配层在本目录 `src/` /
  `index.js` / `client.js`(本仓库自有);引擎是上游
  [TencentCloud/TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)
  的稀疏快照 `engines/MemoryCore` + `engines/MemoryKnowledge`(commit 见登记表)。
  **不要**拷 MemoryPanel / MemoryProxy / `assets/`。sidecar 默认用包内
  `engines/`;`runtime.gatewayDir` / `knowledgeDir` 留空即换机即用。
  `node_modules` 不入库。

## 例行更新流程

```sh
# 1. 只稀疏覆盖引擎,不要整仓覆盖(见下)
# 2. 从合集根重放该插件的补丁
node scripts/reapply-third-party-patches.mjs dsh-plugin-memory-tencentdb

# 3. 适配检查(见下)
# 4. 依赖变化时:本机拉取任务再 dsh plugin add(本仓库任务不改 profile)
# 5. 更新本登记表(版本/commit 列)与 UPSTREAM.md,提交
```

### dsh-plugin-memory-tencentdb 更新(适配层 + engines 稀疏快照,禁止 MIR)

**不要**对 `third-party/dsh-plugin-memory-tencentdb` 做 `robocopy /MIR` 或整仓
覆盖:上游是 TencentDB-Agent-Memory 仓库根,会冲掉 DSH 适配层 `src/` /
`index.js` / `client.js`。只按
`third-party/dsh-plugin-memory-tencentdb/UPSTREAM.md` 稀疏覆盖
`engines/MemoryCore` 与 `engines/MemoryKnowledge`,然后重放补丁:

```sh
node scripts/reapply-third-party-patches.mjs dsh-plugin-memory-tencentdb
```

rsync 额外排除:`node_modules` `dist` `.git` `hermes-plugin` `openclaw-plugin`
`docker` `Dockerfile` `docker-compose.yml`。

覆盖后若漏放补丁,Knowledge 会回到绑全网卡,且 `tsx` 仍在 devDependencies。

## 适配检查清单(每次更新后必过)

1. **补丁重放**:`node scripts/reapply-third-party-patches.mjs <plugin>` 输出
   `ok` 或冲突清单。目标文件缺失会打印 `[skip]` 并跳过 —— 那是「上游已删除或
   吸收」的提示,核对 `docs/THIRD-PARTY-PATCHES.md` 后决定是否删掉该 `.patch`;
   冲突 → 按补丁内说明手动适配后再更新补丁文件。
2. **peer 版本 vs 当前 dsh**:对比新旧 `package.json` 的 `peerDependencies` 与
   当前 dsh 版本(本机 Windows 侧实测 `0.1.5-rc.1`)是否相容;不相容 → 暂不升级。
3. **依赖增删**:`dependencies` 有变化 → profile `pnpm install`;新增 file:
   依赖路径要受 `.gitignore` 覆盖。
4. **sidecar 边界**:Knowledge 必须绑 `127.0.0.1`(个人模式不暴露到局域网);
   `tsx` 必须在 `dependencies` 而不是 `devDependencies`。
5. **新扩展点**:上游新增的 host 能力(fence-registry、新 slot、新 service、
   client inject 列表)→ 确认当前 dsh 已提供;缺则行为降级或挂载失败。
6. **客户端 bundle**:client 半区有变化 → 重启 dsh web 后**硬刷新**
   (Ctrl+Shift+R)。
7. **体积/忽略规则**:新增大二进制或上游锁文件 → 按 `.gitignore` 现有模式补排除。

## 生效验证(重启 dsh web 后)

| 插件 | 冒烟项 |
|---|---|
| dsh-plugin-memory-tencentdb | `GET http://127.0.0.1:8420/health` 与 `GET http://127.0.0.1:8421/health` 返回 200;两个端口绑在 127.0.0.1 而不是 `*` |
| 全部 | host 日志无挂载报错(duplicate entry / 缺 service) |

## 回滚

- 更新失败 → `git revert <更新 commit>`,profile `pnpm install` 后重启;
- 快照旧内容仍在 git 历史,`git revert` 即可复原。

## 相关文档

- `THIRD-PARTY-SNAPSHOTS.md` — 上游登记表(本文件的表格与它是同一事实源,更新时同步);
- `THIRD-PARTY-PATCHES.md` — 补丁登记与重放规范;
- `scripts/reapply-third-party-patches.mjs` — 补丁重放工具(支持按插件过滤,
  目标缺失自动跳过)。
