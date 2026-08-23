import Schema from 'schemastery'

/** settings.yaml 中本插件的命名空间。 */
export const SETTINGS_NS = 'tdai-memory'

export const Config = Schema.object({
  server: Schema.object({
    /** MemoryCore Gateway 地址（standalone 默认 127.0.0.1:8420）。 */
    url: Schema.string().default('http://127.0.0.1:8420'),
    /** 直接填 Gateway 的 Bearer token；本地零配置部署默认用 "local"。 */
    apiKey: Schema.string().default('local'),
    /** 可选：引用 dsh 凭证（credentials）中的名字；非空时优先于 apiKey。 */
    credentialName: Schema.string().default(''),
    /** memory instance id。 */
    instanceId: Schema.string().default('default'),
    /** v3 严格隔离必填：team / agent / user。个人模式默认 personal 系列。 */
    teamId: Schema.string().default('personal'),
    agentId: Schema.string().default('personal-agent'),
    userId: Schema.string().default('personal-user'),
    /** true 时用 DSH 匿名用户 id 派生稳定的个人身份，无需手工配置。 */
    autoIdentity: Schema.boolean().default(true),
    /** 单次 HTTP 请求超时（毫秒）。 */
    timeoutMs: Schema.number().min(1000).max(120000).default(30000),
    /** 是否校验 TLS 证书。本地自签部署保持 false。 */
    rejectUnauthorized: Schema.boolean().default(true),
  }),

  recall: Schema.object({
    /** 是否启用记忆注入（L3/L2 缓存注入 + 每轮 L1 自动召回）。 */
    enabled: Schema.boolean().default(true),
    /** 每个 agent 步骤前自动召回 L1 记忆并注入模型历史。 */
    autoInject: Schema.boolean().default(true),
    /** 自动召回的最大 L1 条数。 */
    maxResults: Schema.number().min(1).max(20).default(5),
    /** 画像/场景缓存刷新间隔（毫秒）。 */
    refreshIntervalMs: Schema.number().min(15000).max(3600000).default(60000),
  }),

  runtime: Schema.object({
    /** true 时插件以子进程方式托管 MemoryCore / MemoryKnowledge。 */
    manageSidecars: Schema.boolean().default(true),
    gatewayDir: Schema.string().default('/home/Acidmoon/Coding/TencentDB-Agent-Memory/MemoryCore'),
    knowledgeDir: Schema.string().default('/home/Acidmoon/Coding/TencentDB-Agent-Memory/MemoryKnowledge'),
    gatewayPort: Schema.number().default(8420),
    knowledgePort: Schema.number().default(8421),
    llmBaseUrl: Schema.string().default('https://api.deepseek.com/v1'),
    llmModel: Schema.string().default('deepseek-chat'),
    llmMaxTokens: Schema.number().default(8192),
  }),

  knowledge: Schema.object({
    /** 是否启用 Wiki / CodeGraph 知识能力。 */
    enabled: Schema.boolean().default(true),
    /** MemoryKnowledge 服务地址（默认 127.0.0.1:8421）。 */
    url: Schema.string().default('http://127.0.0.1:8421'),
    /** memory instance id（x-tdai-service-id）。 */
    serviceId: Schema.string().default('default'),
    /** 单次 HTTP 超时（毫秒）。 */
    timeoutMs: Schema.number().min(1000).max(120000).default(30000),
  }),

  capture: Schema.object({
    /** 是否监听 dsh 会话事件，把 user/assistant 文本写入 MemoryCore L0。 */
    enabled: Schema.boolean().default(true),
    /** true 时只捕获真实用户消息（source.kind === 'user'），忽略插件注入的上下文。 */
    onlyUserSource: Schema.boolean().default(true),
    /** 同一会话内 L0 批量提交前的静默窗口（毫秒）。 */
    flushIntervalMs: Schema.number().min(500).max(30000).default(2000),
    /** turn 以 error 结束时跳过该 turn 的 L0 捕获。 */
    skipFailedTurns: Schema.boolean().default(true),
  }),
})
