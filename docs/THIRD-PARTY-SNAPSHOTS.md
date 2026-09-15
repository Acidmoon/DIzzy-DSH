# 第三方插件上游登记表(事实源)

`third-party/` 快照的上游登记,与 `THIRD-PARTY-UPDATE.md` 中的表格是同一事实源,更新时同步。

> **本合集 2026-09 起只保留一个第三方插件。** 其余曾收录的插件
> (`dsh-better-sidebar`、`dsh-vision-toolkit`、`dsh-genui`、`dsh-notification`、
> `dsh-subscription-auth`、`dsh-gui-customization`)与第三方 agent preset
> (`dsh-anchored-standard`)已连同快照、`patches/` 本地补丁与 `package.json`
> 依赖一并移除 —— 快照跟随上游漂移,上游改 peer 范围或新增运行时依赖就会让
> 合集装不上或起不来,而排查成本落在本仓库。需要那些能力请自行单独安装。
> 下表即当前快照的全集。

| 插件 | 快照目录 | 上游仓库 | 跟随分支 | 收录版本 | 上游 commit | 收录日期 | 手工补丁 |
|---|---|---|---|---|---|---|---|
| dsh-plugin-memory-tencentdb | third-party/dsh-plugin-memory-tencentdb | https://github.com/TencentCloud/TencentDB-Agent-Memory（适配层 + engines/ 稀疏快照） | feat/server_team | 0.1.2 | 97f9465 | 2026-08-25 | 有:personal-sidecar(见 THIRD-PARTY-PATCHES.md) |

## 各上游更新形态(决定更新源)

| 插件 | 更新源 | 备注 |
|---|---|---|
| dsh-plugin-memory-tencentdb | 上游 `feat/server_team` 分支;**不是**整仓快照 | DSH 适配层在本目录 `src/`;引擎是上游的稀疏快照 `engines/MemoryCore` + `engines/MemoryKnowledge`。**禁止 MIR/整仓覆盖**(会删掉适配层 `src/`)。不要拷 MemoryPanel / MemoryProxy / `assets/`。sidecar 默认跑包内 `engines/`,`runtime.gatewayDir` / `knowledgeDir` 留空即换机即用。更新步骤见 `THIRD-PARTY-UPDATE.md`,补丁见 `patches/dsh-plugin-memory-tencentdb-personal-sidecar.patch` |

## 记录格式约定

- 收录版本:快照内 package.json 的 `version` 字段(不是 npm 最新版);
- 上游 commit:收录时跟随分支的 HEAD 短 hash(记忆插件是 `feat/server_team`);
- 手工补丁:该快照是否在 `THIRD-PARTY-PATCHES.md` 登记(有 → 更新后必须重放);
- 更新流程与适配检查:见 `THIRD-PARTY-UPDATE.md`。
