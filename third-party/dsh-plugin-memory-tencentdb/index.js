/**
 * dsh-plugin-memory-tencentdb — DSH 适配层插件
 *
 * 架构（路径一：不修改 TencentDB 源码）：
 *
 *   dsh (Cordis host)
 *     └─ 本插件：工具注册 + 系统提示词注入 + session/event 捕获
 *          │ @tencentdb-agent-memory/memory-sdk-ts-v2
 *          ▼ HTTP /v3/*
 *   MemoryCore Gateway :8420（独立运行的 TencentDB Agent Memory 服务）
 *          └─ L0 对话 → 后台提取 → L1 记忆 → L2 场景 → L3 画像
 *
 * 安装：
 *   dsh plugin --profile web add file:/path/to/dsh-plugin-memory-tencentdb
 *
 * 配置：
 *   settings.yaml 的 tdai-memory 命名空间（见 README.md）；
 *   默认连接 http://127.0.0.1:8420，team/agent/user 均为 "default"。
 */
import { Config, SETTINGS_NS } from './src/schema.js'
import { makeClientFactory } from './src/client.js'
import { attachCapture } from './src/capture.js'
import { attachProfileInjection } from './src/profile.js'
import { attachAutoRecall } from './src/auto-recall.js'
import { attachSettingsApi } from './src/settings-api.js'
import { attachSidecars } from './src/sidecars.js'
import { buildTools } from './src/tools.js'
import { makeKnowledgeClient } from './src/knowledge-client.js'
import { buildKnowledgeTools } from './src/knowledge-tools.js'

export const name = 'dsh-plugin-memory-tencentdb'

export default {
  name,
  inject: ['tools', 'systemPrompt', 'credentials', 'timer'],
  Config,
  apply(ctx, config) {
    const settings = ctx.get('settings')
    const scope = settings === undefined
      ? undefined
      : settings.register(SETTINGS_NS, Config, { base: config })
    const current = () => (scope === undefined ? config : scope.get())
    const warn = (message) => console.warn(`[${name}] ${message}`)

    const { getClient } = makeClientFactory(ctx, current, warn)
    const getKnowledgeClient = makeKnowledgeClient(current, warn)
    const disposers = []

    // 1) 模型可调用的记忆工具 + 知识工具（Wiki / CodeGraph）
    for (const tool of buildTools({ current, getClient })) {
      disposers.push(ctx.tools.register(tool))
    }
    if (current()?.knowledge?.enabled !== false) {
      for (const tool of buildKnowledgeTools({ current, getKnowledgeClient })) {
        disposers.push(ctx.tools.register(tool))
      }
    }

    // 2) L3/L2 画像注入（缓存 + 定时刷新）
    if (current()?.recall?.enabled !== false) {
      disposers.push(attachProfileInjection(ctx, { current, getClient, warn }))
      disposers.push(attachAutoRecall(ctx, { current, getClient, warn }))
    }

    // 3) L0 会话自动捕获
    if (current()?.capture?.enabled !== false) {
      disposers.push(attachCapture(ctx, { current, getClient, warn }))
    }

    // 4) 设置页同源 API（Web UI → 本插件 host → Memory/Knowledge）
    disposers.push(attachSettingsApi(ctx, { current, getClient, getKnowledgeClient, warn }))

    // 5) sidecar 托管：DSH 启动拉起 Memory/Knowledge，DSH 退出回收
    if (current()?.runtime?.manageSidecars !== false) {
      disposers.push(attachSidecars(ctx, { current, warn }))
    }

    return () => {
      for (const dispose of disposers.reverse()) {
        try {
          dispose()
        } catch (err) {
          warn(`dispose 失败：${String(err?.message ?? err)}`)
        }
      }
    }
  },
}
