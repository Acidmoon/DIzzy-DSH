/**
 * 多订阅渠道抽象：统一每个订阅提供商的 OAuth 登录、模型发现与适配器，
 * 让 src/index.ts 成为一个薄的通用驱动（遍历渠道定义并接线）。
 * @module dsh-subscription-auth/channel
 */
import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { AdapterModel } from './adapter.js'

/** 思考强度档位（模型选择器「推理等级」菜单的一项）。 */
export interface ReasoningEffort {
  /** 档位 id：原样作为官方 effort 字段发送（OpenAI/xAI 的 reasoning.effort、Claude 的 output_config.effort、Kimi 的 reasoning_effort）。 */
  id: string
  name: string
  description?: string
}

/** 渠道级思考强度配置；缺省表示该渠道不提供思考强度选择。 */
export interface ChannelReasoning {
  efforts: ReasoningEffort[]
  /** 缺省档位；缺省时 UI 提供 "Default"（不发送，用提供商默认行为）。 */
  defaultEffort?: string
}

/** 持久化在 credential 里的令牌（JSON 字符串）。 */
export interface StoredToken {
  refresh: string
  access: string
  /** epoch 毫秒。 */
  expires: number
  accountId?: string
  email?: string
  [key: string]: unknown
}

/** 渠道在 settings 里持久化的配置（`subscription-auth-<id>` 命名空间）。 */
export interface ChannelConfig {
  apiBaseURL?: string
  redirectPort?: number
  /** 用户手动指定的模型列表（优先于登录后自动发现的结果）。 */
  models?: AdapterModel[]
  defaultContextWindow?: number
  maxTokens?: number
  /** 登录后自动发现并持久化的官方模型列表（内部字段，不在配置 UI 展示）。 */
  discoveredModels?: AdapterModel[]
}

export interface ResolvedChannelOptions {
  apiBaseURL: string
  redirectPort: number
  models: AdapterModel[]
  defaultContextWindow: number
  maxTokens: number
}

export interface LoginResult {
  status: 'logged-in' | 'pending'
  url?: string
  userCode?: string
  account?: string
}

export interface AuthStatus {
  provider: string
  status: 'logged-in' | 'pending' | 'not-logged-in'
  account?: string
  expiresAt?: number
  url?: string
  userCode?: string
}

/** 通用驱动注入给每个渠道的依赖。 */
export interface ChannelContext {
  readonly id: string
  readonly tokenRefName: string
  /** 解析后的运行时配置（模型优先级已处理）。 */
  options(): ResolvedChannelOptions
  /** settings 里尚未合并默认值的原始配置。 */
  getConfig(): ChannelConfig
  /** 持久化配置片段（如 discoveredModels）。 */
  updateConfig(patch: ChannelConfig): Promise<void>
  credentials(): CredentialProvider | undefined
  log(message: string): void
  /** 触发 llm/adapters-updated，让模型选择器等 UI 重新拉取列表。 */
  notifyModelsChanged(): void
  /** 读取本渠道的令牌（不存在/损坏返回 undefined）。 */
  readToken(): Promise<StoredToken | undefined>
  /** 写入本渠道令牌（JSON 字符串）。 */
  writeToken(token: StoredToken): Promise<void>
  /** 删除本渠道令牌。 */
  clearToken(): Promise<void>
}

export interface ChannelRuntime {
  adapter: LlmAdapter
  /** 启动登录：立即返回（浏览器流给出 url，设备流给出 url+userCode）。 */
  login(): Promise<LoginResult>
  authStatus(): Promise<AuthStatus>
  logout(): Promise<void>
  /** 拉取官方模型列表；失败返回空数组（调用方回退默认列表）。 */
  discoverModels(): Promise<AdapterModel[]>
}

export interface ChannelDefinition {
  id: string
  /** 注册进 llm 的 provider id 与显示名（模型选择器里显示）。 */
  displayName: string
  /** 配置中心「订阅服务」卡片标题。 */
  name: string
  description: string
  /** credential 服务里存令牌的 key。 */
  tokenRefName: string
  defaultApiBaseURL: string
  defaultRedirectPort: number
  defaultContextWindow: number
  defaultMaxTokens: number
  defaultModels: AdapterModel[]
  /** 思考强度选项（缺省不提供）。登录后发现的模型同样继承渠道级档位。 */
  reasoning?: ChannelReasoning
  create(ctx: ChannelContext): ChannelRuntime
}
