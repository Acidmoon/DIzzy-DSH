# 第三方插件手工补丁规范

对 `third-party/` 快照的任何本地改动**必须**:
1. 以 `.patch` 文件形式入库到 `patches/`(命名:`<plugin>-<描述>.patch`,如 `dsh-plugin-memory-tencentdb-personal-sidecar.patch`);
2. 在本文件登记;
3. 通过 `node scripts/reapply-third-party-patches.mjs <plugin>` 重放(更新流程的一步)。

禁止直接改快照内文件而不留补丁——覆盖快照会冲掉改动,补丁文件是唯一持久载体。

> 本合集 2026-09 起只保留一个第三方插件(`dsh-plugin-memory-tencentdb`),
> 其余曾收录插件与其补丁已一并移除。当前 `patches/` 下只有它一个补丁。

## 现有补丁

### `patches/dsh-plugin-memory-tencentdb-personal-sidecar.patch`

**插件**:dsh-plugin-memory-tencentdb
**目标文件**:
- `third-party/dsh-plugin-memory-tencentdb/engines/MemoryKnowledge/src/config.ts`
- `third-party/dsh-plugin-memory-tencentdb/engines/MemoryKnowledge/src/server.ts`
- `third-party/dsh-plugin-memory-tencentdb/engines/MemoryKnowledge/package.json`
**目的**:个人模式 sidecar 不把 Knowledge 暴露到局域网;`tsx` 必须是生产依赖,否则 `NODE_ENV=production` 的 `npm install` 装不出 `--import tsx`。
**登记日期**:2026-08-25(对照上游 `feat/server_team` @ `97f9465`)

**改动内容**:

1. `ServiceConfig.host` 从环境变量 `HOST` 读取,默认 `127.0.0.1`。
2. `@hono/node-server` 的 `serve()` 传入 `hostname: config.host`(上游只传 `port`,默认绑全网卡)。
3. 把 `tsx` 从 `devDependencies` 挪到 `dependencies`。
4. `server.ts` 用 `pathToFileURL(process.argv[1])` 判断主模块,相对路径和 Windows 盘符都能启动。

**重放失败时的处理**:上游若已支持 `HOST` / 默认 loopback,或已把 `tsx` 列为生产依赖,删除本补丁并更新登记;冲突则按上面 3 条适配后再更新补丁文件。

## 重放工具

```sh
# 全部补丁重放(不传参数 = 全部)
node scripts/reapply-third-party-patches.mjs
# 只重放某个插件的补丁
node scripts/reapply-third-party-patches.mjs dsh-vision-toolkit
```

脚本对每个补丁先 `git apply --check`;全部通过才应用;任一失败即停止并列出冲突文件,提示手动适配。
