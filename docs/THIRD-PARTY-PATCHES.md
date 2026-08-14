# 第三方插件手工补丁记录

本文件记录对 `third-party/` 快照的手工改动。上游更新快照时,按此清单重新应用。

## dsh-vision-toolkit `lib/exposure.js`(2026-08-14)

**目的**:视觉工具不再全部依赖 vision-tools skill 加载后才注入;高频核心工具常驻,任何会话创建即可直接调用。

**改动**:

1. 新增 `ALWAYS_ON_TOOLS` 集合(4 个常驻工具):
   - `vision_glance`(描述/定向问答/OCR)
   - `vision_ground`(定位)
   - `vision_detect`(检测)
   - `vision_pixel_diff`(像素对比)
2. `attach()`:agent 创建时,历史已加载 skill → 完整激活;否则注册常驻核心子集(`activateCore`),激活工具保持可见。
3. 新增 `activateCore()`:只注册 `ALWAYS_ON_TOOLS` 子集,不隐藏激活工具。
4. `activate()`:幂等;已注册核心子集的 agent 补注册剩余工具,再隐藏激活工具(`restrict deny`)。

**行为**:

- 新会话:工具目录直接出现 4 个核心视觉工具 + `vision_toolkit_activate`;
- 加载 vision-tools skill(或调用激活工具)后:剩余工具(ground/detect 之外的全部,crop/trace/OCR/dominant 等)注入,激活工具消失;
- 历史已加载 skill 的会话:直接完整激活(与上游一致)。

**更新快照时重新应用**:把 `attach` 改回无条件 `activate(agent)` 即还原上游;要保留本补丁,则复制上面的 4 处改动。
