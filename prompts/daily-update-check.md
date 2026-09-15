# 每日 Dizzy-DSH 更新

合集自 2026-09 起**只收录自己写的插件**(balance / usage-card /
agent-instructions / kimi-webbridge),不再收录任何第三方插件,因此只剩
**一条**本机任务:

| 任务 | 提示词 | 做什么 | 不做什么 |
|---|---|---|---|
| 本机 | [daily-local-pull.md](./daily-local-pull.md) | 快进仓库、删 file: 副本、重装 profile | 不改 profile 其他配置、不 commit/push、不重启 |

> 原「对照上游、更新第三方快照、推 origin」任务(`daily-upstream-repo.md`)
> 已随第三方插件一起删除:没有第三方快照要跟随,仓库内容全部是本仓库自有的。

投喂本机任务:

```
每日本机拉取 Dizzy-DSH 并重装 profile。工作目录 E:\vibecoding\Dizzy-DSH。先读并严格执行仓库里的 prompts/daily-local-pull.md。不要问要不要继续;不要 commit/push;不要重启 dsh web。已对齐且副本正确就不要无谓重装。
```
