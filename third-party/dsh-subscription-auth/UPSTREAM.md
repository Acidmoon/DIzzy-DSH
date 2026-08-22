# dsh-subscription-auth —— 收录的第三方插件

> 本目录是 **dsh-subscription-auth 上游仓库快照**,由 Dizzy-DSH 收录以便
> "克隆即装",并以主插件 `dependencies` 的
> `file:./third-party/dsh-subscription-auth` 依赖随主插件安装。
>
> **本快照含本地补丁**,不是上游原版。功能修改应尽量回馈上游;合集侧的
> 持久载体是 `patches/dsh-subscription-auth-local.patch`,subtree pull 后
> 必须重放。

## 上游信息

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/Khellendros97/dsh-subscription-auth |
| 作者 | [Khellendros97](https://github.com/Khellendros97) |
| 收录版本 | `0.2.1` |
| 上游 commit | `338c02e`(docs: 更新安装指南，新增旧版本迁移指导) |
| License | BSD-3-Clause |
| 功能 | 订阅会员 OAuth 登录:ChatGPT Plus/Pro、Claude Pro/Max、Grok、Kimi Code;设置 → 订阅服务 登录/注销,按登录状态注册提供商 |
| 手工补丁 | 有,见 [docs/THIRD-PARTY-PATCHES.md](../../docs/THIRD-PARTY-PATCHES.md) 的 `dsh-subscription-auth-local.patch` 与 `dsh-subscription-auth-reasoning-effort.patch` |

## 本地补丁摘要

相对上游 `338c02e`:

- usage 写入钳零,全零样本不写(避免负 `inputTokens` 炸掉 `session.history`);
- 读路径投影守卫(`projection-guard`);
- OAuth state 与 PKCE verifier 分离;
- Grok 设备流按 body.error 判断,不再把 HTTP 400 pending 当失败;
- 检测 `HTTPS_PROXY`/`HTTP_PROXY` 时给 Node fetch 装 undici 代理;
- `@deepseek-ai/schemastery` 改 peer,避免 profile 再装一份独立实例;
- 思考档位对齐官方最高档:ChatGPT `xhigh`/`max`,Grok `xhigh`,Claude `output_config.effort`(含 `max`),Kimi `reasoning_effort`(含 `max`)。

## 更新方式

```bash
# 跟随上游(迁移为 subtree 之后)
git subtree pull --squash --prefix=third-party/dsh-subscription-auth https://github.com/Khellendros97/dsh-subscription-auth main
# 重放本地补丁
node scripts/reapply-third-party-patches.mjs dsh-subscription-auth
# 更新本文件与 docs/THIRD-PARTY-SNAPSHOTS.md 的版本 / commit
```

当前仍是纯拷贝快照。未迁 subtree 前,用上游 checkout 覆盖本目录(排除 `.git` /
`node_modules`)后再重放补丁。

## 本地安装

本插件**无需单独安装**:它是主插件 `dizzy-dsh` 的 `package.json`
`dependencies` 声明(`"dsh-subscription-auth": "file:./third-party/dsh-subscription-auth"`),
安装主插件时随依赖自动装入:

```bash
dsh plugin --profile web add file:<仓库绝对路径>
```

重启 `dsh web` 生效;挂载由主插件 `cordis.patch.yml` 的 entry
(id `dsh-subscription-auth`)完成,无需手改 profile。卸载随主插件
`remove dizzy-dsh` 一起移除。

> 不要再单独 junction,也不要往 profile 的 `cordis.patch.yml` 插同 id 行
> (会与合集 patch 撞 `duplicate loader entry id`)。
