# 第三方插件手工补丁规范

对 `third-party/` 快照的任何本地改动**必须**:
1. 以 `.patch` 文件形式入库到 `patches/`(命名:`<plugin>-<描述>.patch`,如 `dsh-vision-toolkit-exposure.patch`);
2. 在本文件登记;
3. 通过 `node scripts/reapply-third-party-patches.mjs` 重放(更新流程的一步)。

禁止直接改快照内文件而不留补丁——subtree pull 会覆盖快照,补丁文件是唯一持久载体。

## 现有补丁

### `patches/dsh-vision-toolkit-exposure.patch`(尚未生成,迁移时生成)

**插件**:dsh-vision-toolkit
**目标文件**:`third-party/dsh-vision-toolkit/lib/exposure.js`
**目的**:视觉工具不再全部依赖 vision-tools skill 加载后才注入;高频核心工具常驻,任何会话创建即可直接调用。
**登记日期**:2026-08-14(已应用在快照内,补丁文件待「一次性迁移」步骤 1 生成)

**改动内容**:

1. 新增 `ALWAYS_ON_TOOLS` 集合(4 个常驻工具):
   - `vision_glance`(描述/定向问答/OCR)
   - `vision_ground`(定位)
   - `vision_detect`(检测)
   - `vision_pixel_diff`(像素对比)
2. `attach()`:agent 创建时,历史已加载 skill → 完整激活;否则注册常驻核心子集(`activateCore`),激活工具保持可见。
3. 新增 `activateCore()`:只注册 `ALWAYS_ON_TOOLS` 子集,不隐藏激活工具。
4. `activate()`:幂等;已注册核心子集的 agent 补注册剩余工具,再隐藏激活工具(`restrict deny`)。

**行为**:新会话工具目录直接出现 4 个核心视觉工具 + `vision_toolkit_activate`;加载 vision-tools
skill(或调用激活工具)后剩余工具注入、激活工具消失;历史已加载 skill 的会话直接完整激活。

**重放失败时的处理**:上游若已重构 exposure.js(如版本升级),补丁冲突 → 手动按上面 4 条改动适配新文件,
更新补丁后重新提交。

## 重放工具

```sh
# 全部补丁重放(不传参数 = 全部)
node scripts/reapply-third-party-patches.mjs
# 只重放某个插件的补丁
node scripts/reapply-third-party-patches.mjs dsh-vision-toolkit
```

脚本对每个补丁先 `git apply --check`;全部通过才应用;任一失败即停止并列出冲突文件,提示手动适配。
