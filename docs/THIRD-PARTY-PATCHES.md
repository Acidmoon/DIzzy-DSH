# 第三方插件手工补丁规范

对 `third-party/` 快照的任何本地改动**必须**:
1. 以 `.patch` 文件形式入库到 `patches/`(命名:`<plugin>-<描述>.patch`,如 `dsh-vision-toolkit-exposure.patch`);
2. 在本文件登记;
3. 通过 `node scripts/reapply-third-party-patches.mjs` 重放(更新流程的一步)。

禁止直接改快照内文件而不留补丁——subtree pull 会覆盖快照,补丁文件是唯一持久载体。

## 现有补丁

### `patches/dsh-vision-toolkit-exposure.patch`

**插件**:dsh-vision-toolkit
**目标文件**:`third-party/dsh-vision-toolkit/src/exposure.ts`、`third-party/dsh-vision-toolkit/lib/exposure.js`
**目的**:视觉工具不再全部依赖 vision-skills skill 加载后才注入;高频核心工具常驻,任何会话创建即可直接调用。
**登记日期**:2026-08-22(已对照上游 v0.1.38/`5a33bf6` 重适配:上游把立刻 `restrict` 改成 step/end 再隐藏,合集保留该延迟,只叠加常驻核心工具)

**改动内容**:

1. 新增 `ALWAYS_ON_TOOLS` 集合(4 个常驻工具):
   - `vision_glance`(描述/定向问答/OCR)
   - `vision_ground`(定位)
   - `vision_detect`(检测)
   - `vision_pixel_diff`(像素对比)
2. `attach()`:agent 创建时,历史已加载 skill → 完整激活;否则注册常驻核心子集(`activateCore`),激活工具保持可见。
3. 新增 `activateCore()`:只注册 `ALWAYS_ON_TOOLS` 子集,不隐藏激活工具。
4. `activate()`:幂等;已注册核心子集的 agent 补注册剩余工具。隐藏引导工具沿用上游:live 会话等到 `step/end` 再 `restrict deny`,避免同一步里仍在飞行的激活调用变成 UNKNOWN_TOOL。

**行为**:新会话工具目录直接出现 4 个核心视觉工具 + `vision_toolkit_activate`;加载 vision-skills
skill(或调用激活工具)后剩余工具注入、激活工具在 step/end 消失;历史已加载 skill 的会话直接完整激活。

**重放失败时的处理**:上游若已重构 exposure.js(如版本升级),补丁冲突 → 手动按上面 4 条改动适配新文件,
更新补丁后重新提交。

### `patches/dsh-vision-toolkit-windows-ensurepip.patch`

**插件**:dsh-vision-toolkit
**目标文件**:`third-party/dsh-vision-toolkit/src/runtime-install.ts`、`lib/runtime-install.js`、`tests/runtime-install.spec.ts`
**目的**:Windows 微软商店版 Python 在 `USERPROFILE`/`LOCALAPPDATA` 被指到隔离 home 时,`python -m venv` 调 `ensurepip` 会以 101 退出,设置页显示「运行环境尚未就绪」。Windows 上不再重定向这两项,用户站点隔离仍靠 `PYTHONNOUSERSITE`。
**登记日期**:2026-08-22(已对照上游 v0.1.38/`5a33bf6` 重放)

**重放失败时的处理**:上游若已改隔离环境策略,按当前 Windows Store Python 行为适配后再更新本补丁。

### `patches/dsh-subscription-auth-local.patch`

**插件**:dsh-subscription-auth
**上游**:https://github.com/Khellendros97/dsh-subscription-auth @ `338c02e`(v0.2.1)
**登记日期**:2026-08-15(已应用在快照内)

**改动内容**(相对上游原版):

1. **usage 钳零 + 全零样本不写**:`src/adapter.ts` 与 `src/adapters/anthropic.ts` 的 `mapUsage` 把 `input_tokens - cache` 钳到 ≥0;若全部计数为 0 且无 cache/reasoning 细节则返回 `undefined`,不向会话投影写入合成的全零 usage。
2. **读路径投影守卫**:新增 `src/projection-guard.ts`,包装 `tokenUsage` / `contextPressure` 的 view,旧日志里的负计数读出来也钳成非负,避免 `session.history` 整页失败。
3. **独立 OAuth state**:`src/oauth.ts` 新增 `generateState()`;`chatgpt` / `claude` 不再把 PKCE verifier 当 state(授权 URL 里的 state 会进浏览器历史)。
4. **Grok 设备流**:`src/channels/grok.ts` 先解析 body 再判断,不再把 HTTP 400 的 `authorization_pending` 当成失败。
5. **代理感知**:`src/index.ts` 在检测到 `HTTPS_PROXY`/`HTTP_PROXY` 时给 Node fetch 装 `undici` 的 `EnvHttpProxyAgent`。
6. **合集依赖适配**:`package.json` 把 `@deepseek-ai/schemastery` 改成 peer(走 DSH heal 层同实例),运行时依赖只留 `undici@8.10.0`。
7. **测试**:`tests/smoke.mjs` 增加 Kimi 净增量 usage 钳零用例。

`lib/` 产物与 `src/` 同步入库,重放后不必再构建。

**重放失败时的处理**:上游若已吸收对应修复,删除本补丁并更新登记;冲突则按上面 7 条适配新文件后再提交。

### `patches/dsh-subscription-auth-reasoning-effort.patch`

**插件**:dsh-subscription-auth
**上游**:叠在 `dsh-subscription-auth-local.patch` 之后
**登记日期**:2026-08-15

**改动内容**:

1. ChatGPT 思考档位加 `xhigh` / `max`(默认仍 `medium`)。
2. Grok 加 `xhigh`(不设默认;不支持的旧模型会按 high 处理)。
3. Claude 发 `output_config.effort`,档位含 `xhigh` / `max`,默认 `high`。
4. Kimi 发顶层 `reasoning_effort`,档位 `low` / `high` / `max`,默认 `max`。
5. 未声明 `wireEffort` 时才回退旧的 `thinking.budget_tokens`(测试兼容)。

**重放失败时的处理**:上游若已改官方字段,按各渠道当前 API 适配后再更新本补丁。

### `patches/dsh-notification-peer-ranges.patch`

**插件**:dsh-notification
**目标文件**:`third-party/dsh-notification/package.json`
**目的**:修复合集安装必现的 `ERR_PNPM_NO_MATCHING_VERSION`。该快照的全部 `@deepseek-ai/*` peer 依赖为 `*`,与合集内其它插件(better-sidebar / vision-toolkit / genui)的 rc 范围合并解析时,会被 pnpm 解析为 `>=0.1.0 <0.2.0` 一类区间;而 `@deepseek-ai/dsh-*` 只发布了 `0.1.0-rc.*` / `0.1.1-rc.*`,导致 `dsh plugin add file:<仓库>` 找不到版本。把 peer 范围显式收敛为:`cordis@^4.0.1`,其余 DSH 子包 `^0.1.0-rc.6 || >=0.1.1-rc.0 <0.2.0`(覆盖 rc.6~rc.8 与整个 0.1.1-rc 列车)。
**登记日期**:2026-08-22(对照上游 v0.1.3/`ddec603`;上游仍用 `*`)

**重放失败时的处理**:上游若已收敛 peer 范围,删除本补丁并更新登记;冲突则按当前框架版本重写对应 peer 范围后再提交。

> `dsh-gui-customization-keyed-slot.patch` 已删除:上游 v0.6.3 对 `settings.plugin.item` 做了 `id` + `key` 双协议,合集不再需要本地补丁。

## 重放工具

```sh
# 全部补丁重放(不传参数 = 全部)
node scripts/reapply-third-party-patches.mjs
# 只重放某个插件的补丁
node scripts/reapply-third-party-patches.mjs dsh-vision-toolkit
```

脚本对每个补丁先 `git apply --check`;全部通过才应用;任一失败即停止并列出冲突文件,提示手动适配。
