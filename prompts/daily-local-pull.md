# 每日:本机拉取合集并重装 profile

工作目录:`E:\vibecoding\Dizzy-DSH`
本机 profile:`C:\Users\17740\.dsh\profiles\web`
远程:`origin/master` = `https://github.com/Acidmoon/DIzzy-DSH`

这是一条**无人值守、每天触发一次**的本机任务。只负责「快进仓库 → 重装 file: 副本」。
合集只收录自有插件(2026-09 起第三方插件已全部移除),没有上游快照要跟随。

**不要**改 `package.json` / `cordis.patch.yml` / 文档。
**不要** `git commit` / `git push` / `git reset` / stash。
**不要**重启 `dsh web`(由用户自己重启刷新)。
不要问要不要继续;按门禁自己判定「重装 / 已是最新 / 停止并报告」。

## 1. 只快进,不改历史

1. `git fetch origin` + `git status -sb`。
2. 工作区必须干净。有未提交改动 → **停止**,只报告,不要动手。
3. 本地超前 `origin/master` → **停止**(有人本地改了没推),不要 push。
4. 本地落后 → `git pull --ff-only origin master`。不能快进 → **停止**。
5. 已经与 `origin/master` 对齐 → 继续第 2 步,用「仓库 HEAD vs 已装副本」决定要不要重装。

读仓库根 `package.json` 的 `version` 与 4 个子包版本,作为验收基准。不要凭记忆。

## 2. 判断要不要重装

看 profile 安装副本,不要只看 git:

| 检查 | 期望 |
|---|---|
| `~\.dsh\profiles\web\package.json` | `dizzy-dsh` = `file:E:/vibecoding/Dizzy-DSH` |
| `node_modules/dizzy-dsh/package.json` | `version` = 仓库根版本 |
| `node_modules/dizzy-dsh-balance` 等 4 个子包 | 存在,版本 = 仓库 `plugins/<name>/package.json` |
| `node_modules/dsh-better-sidebar` / `dsh-notification` / `dsh-subscription-auth` / `dsh-gui-customization` / `@anionex` / `@omdsh-dev` / `@dsh-external` | **全部不存在**(第三方已移除;还在就是没清干净,走第 3 步) |
| `dsh --profile web --dump-config` 的 `# == dizzy-dsh` | 4 个 entry:balance / usage-card / dizzy-agent-instructions / kimi-webbridge |

> 本机 profile 的 `cordis.patch.yml` 对 `dizzy-agent-instructions` 与
> `kimi-webbridge` 两行保持 `disabled: true`(尚未在 DSH 0.1.5-rc.1 上实测);
> `balance` / `usage-card` 已适配并解除禁用。dump-config 仍应列出全部 4 个
> entry,这是**预期状态**,不要擅自改这些 disable。

仓库刚快进过,或上面任何一项对不上 → 走第 3 步。
仓库没动且副本已对齐 → 跳到第 4 步,报告「本机已是最新」,不要无谓删装。

## 3. 重装 file: 副本

`file:` 依赖只看 `package.json` 变没变,所以仓库里插件代码/patch 变了必须删副本再 add。

先看 `~\.dsh\profiles\web\pnpm-workspace.yaml`:

- `allowBuilds` 里 `node-pty` / `protobufjs` 必须为 `true`(没有就补上)。
- `minimumReleaseAgeExclude` 里若还留着 `dsh-better-sidebar`,删掉该条(第三方已移除)。
  本任务**只允许改这两处 profile 配置**,改完写进报告。

然后:

```powershell
$nm = "$env:USERPROFILE\.dsh\profiles\web\node_modules"
foreach ($n in @(
  'dizzy-dsh','dizzy-dsh-balance','dizzy-dsh-usage-card',
  'dizzy-dsh-agent-instructions','dizzy-dsh-kimi-webbridge',
  # 第三方残留(合集已移除,这里兜底清干净)
  'dsh-better-sidebar','dsh-notification','dsh-subscription-auth',
  'dsh-gui-customization','@anionex','@dsh-external','@omdsh-dev'
)) {
  $p = Join-Path $nm $n
  if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force }
}
dsh plugin --profile web add file:E:\vibecoding\Dizzy-DSH
```

`dsh plugin add` 非零退出 → **停止**并贴日志,不要换 `pnpm install` 凑合(只跑 install 不会同步 file: 快照内容)。

## 4. 验收

缺一项就修,不要只说「应该好了」:

- `dsh plugin --profile web list` 含 `dizzy-dsh@file:E:/vibecoding/Dizzy-DSH`
- `node_modules/dizzy-dsh/package.json` 的 version 等于仓库根版本
- 4 个子包安装副本存在,version 等于仓库 `plugins/<name>/package.json`
- `node_modules` 顶层不再有第三方包(见第 2 步表)
- `dsh --profile web --dump-config` 的 `# == dizzy-dsh` 段出现 4 个 entry

> 注意:profile 的 `cordis.patch.yml` 目前按 id 对合集的 4 个 entry 全部
> `disabled: true`(2026-09-11 排查 DSH 0.1.5-rc.1 时的措施)。这是**预期状态**,
> 不是安装失败;dump-config 仍应列出这 4 个 entry。不要擅自删掉那些 disable。

## 5. 收工报告

写清:

- 拉取前 `HEAD` → 拉取后 `HEAD`(短 SHA + subject);没拉就写「已对齐,未拉取」
- 是否重装了 profile;安装副本的关键版本
- 是否清掉了第三方残留(有就列出)
- 改过的 profile 配置(没有就写无)
- 最后一行:重装过则写「profile 已重装。请重启 dsh web 并硬刷新。」;没重装则不要提重启
