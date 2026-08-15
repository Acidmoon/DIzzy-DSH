/**
 * ChatGPT codex Responses API 适配器：把 dsh 的消息/工具词汇翻译成
 * OpenAI Responses API（chatgpt.com/backend-api/codex/responses），
 * 再把其 SSE 事件翻译回 dsh 的 StreamChunk 协议。
 *
 * 序列化与 opencode 的 toResponsesInput 一致：
 *   - system → instructions
 *   - user 文本 → { type: 'message', role: 'user', content: [input_text] }
 *   - assistant 文本 → { type: 'message', role: 'assistant', content: [output_text] }
 *   - assistant 工具调用 → { type: 'function_call', call_id, name, arguments }
 *   - tool-result → { type: 'function_call_output', call_id, output }
 * @module dsh-subscription-auth/adapter
 */
import { LlmAdapter, LlmError, CallId, ReasoningEffortId, attributionHeaders } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmResolvedModelInfo,
  LlmProviderInfo,
  StreamChunk,
  ContentBlock,
  TokenUsage,
} from '@deepseek-ai/dsh-llm'
import type { ChannelReasoning } from './channel.js'

export interface AdapterModel {
  id: string
  name: string
  contextWindow?: number
}

export interface AdapterOptions {
  apiBaseURL: string
  maxTokens: number
  models: readonly AdapterModel[]
  defaultContextWindow: number
}

export interface AdapterConfig {
  /** 每次请求前读取最新配置（适配器不缓存配置快照）。 */
  options(): AdapterOptions
  /** 每次请求前解析（必要时刷新）出可用的 access token。 */
  resolveAccessToken(): Promise<{ access: string }>
  /** 思考强度档位（缺省不提供）。effort id 原样作为 reasoning.effort 发送。 */
  reasoning?: ChannelReasoning
  /** 错误信息与 providerInfo 里的标签（默认 'chatgpt' / 'ChatGPT (订阅)'）。 */
  label?: string
  displayName?: string
}

function flattenText(blocks: ContentBlock[]): string {
  let out = ''
  for (const block of blocks) {
    if (block.type === 'text') out += block.text
  }
  return out
}

function serializeRequest(
  options: GenerateOptions,
  o: AdapterOptions,
  reasoning: ChannelReasoning | undefined,
): unknown {
  const input: any[] = []
  let instructions = options.system

  for (const message of options.messages) {
    if (message.role === 'system') {
      const text = flattenText(message.content)
      instructions = instructions !== undefined ? `${instructions}\n\n${text}` : text
      continue
    }
    if (message.role === 'assistant') {
      const textParts: string[] = []
      const calls: any[] = []
      for (const block of message.content) {
        if (block.type === 'text') {
          textParts.push(block.text)
        } else if (block.type === 'tool-call') {
          calls.push({
            type: 'function_call',
            call_id: block.id,
            name: block.name,
            arguments: block.arguments,
          })
        }
        // reasoning 不回填：模型每次自行推理
      }
      // Responses API 规范顺序：先 assistant 文本消息，再 function_call 项
      if (textParts.length > 0) {
        input.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: textParts.join('') }],
        })
      }
      input.push(...calls)
      continue
    }
    // user：文本 → message；tool-result → function_call_output
    const textParts: string[] = []
    for (const block of message.content) {
      if (block.type === 'text') {
        textParts.push(block.text)
      } else if (block.type === 'tool-result') {
        input.push({
          type: 'function_call_output',
          call_id: block.toolCallId,
          output: flattenText(block.content) || '(no output)',
        })
      }
    }
    if (textParts.length > 0) {
      input.push({
        type: 'message',
        role: 'user',
        content: textParts.map((t) => ({ type: 'input_text', text: t })),
      })
    }
  }

  // codex 端点只接受这些字段；temperature / stop / max_output_tokens
  // 实测都会返回 400 "Unsupported parameter"（2026-08 实测），一律不发送。
  const body: any = {
    model: options.model,
    input,
    stream: true,
    store: false,
  }
  if (instructions !== undefined) body.instructions = instructions
  // 思考强度：仅在用户显式选择（或渠道声明默认档位）时发送 reasoning.effort；
  // 不声明 reasoning 的渠道不发送该字段（codex 端点对未知参数会 400）。
  if (reasoning !== undefined && options.reasoningEffort !== undefined) {
    body.reasoning = { effort: options.reasoningEffort }
  }
  if (options.tools !== undefined && options.tools.length > 0) {
    body.tools = options.tools.map((t) => ({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))
  }
  return body
}

function httpErrorCode(status: number): string {
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 429) return 'RATE_LIMIT'
  if (status === 400) return 'INVALID_REQUEST'
  if (status >= 500) return 'SERVER'
  return `HTTP_${status}`
}

function mapUsage(usage: any): TokenUsage | undefined {
  const cacheRead = usage?.input_tokens_details?.cached_tokens
  const reasoning = usage?.output_tokens_details?.reasoning_tokens
  // input_tokens is the total prompt size including the cached prefix, so the
  // uncached remainder is the difference. Clamp at zero: if a provider ever
  // reports input_tokens as the already-netted increment (smaller than
  // cached_tokens), the raw subtraction would go negative and a negative
  // token count poisons DSH's usage projection (it fails the nonnegative
  // schema and takes the session history down with it).
  const inputTokens = Math.max(0, (usage?.input_tokens ?? 0) - (cacheRead ?? 0))
  const outputTokens = usage?.output_tokens ?? 0
  // No real metering: every counter is zero and no cache/reasoning detail was
  // reported. Emitting a synthetic all-zero usage sample would be folded into
  // the session's token projection as a genuine (0,0,0,0) report, and DSH's
  // last-sample-replacing fold treats it as the step's authoritative value —
  // poisoning the running totals when the real sample later replaces it.
  // Withhold the sample instead of fabricating one.
  if (inputTokens === 0 && outputTokens === 0 && cacheRead === undefined && reasoning === undefined) return undefined
  return {
    inputTokens,
    outputTokens,
    ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
  }
}

function mapStatus(status: string | undefined): { kind: string; failure?: any } {
  switch (status) {
    case 'completed':
      return { kind: 'stop' }
    case 'incomplete':
      return { kind: 'max-tokens' }
    case 'cancelled':
      return { kind: 'stop' }
    case 'failed':
      return { kind: 'error', failure: { message: 'model response failed', code: 'FAILED' } }
    default:
      return { kind: 'stop' }
  }
}

/**
 * 手工解析 Responses API 的 SSE 流并翻译为 StreamChunk。
 * 关注的事件：response.output_text.delta、response.function_call_arguments.delta、
 * response.output_item.added（记录 function_call 的 call_id/name）、
 * response.reasoning_*_text.delta、response.completed、response.failed、error。
 */
async function* translate(body: ReadableStream<Uint8Array>): AsyncIterable<StreamChunk> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let nextIndex = 0

  let textBlock: { index: number; text: string } | undefined
  let reasoningBlock: { index: number; text: string } | undefined
  const order: { kind: 'text' | 'reasoning' | 'tool-call'; index: number }[] = []
  const toolBlocks = new Map<number, { index: number; text: string; callId: string; name: string }>()
  const pendingToolMeta = new Map<number, { callId: string; name: string }>()

  let pendingStatus: string | undefined
  let pendingUsage: any | undefined

  const handle = (event: string, data: string) => {
    let chunk: any = {}
    if (data.trim() !== '') {
      try {
        chunk = JSON.parse(data)
      } catch {
        return []
      }
    }

    const out: StreamChunk[] = []
    switch (event) {
      case 'response.output_item.added': {
        const item = chunk.item
        if (item?.type === 'function_call') {
          const meta = {
            callId: String(item.call_id ?? item.id ?? ''),
            name: String(item.name ?? ''),
          }
          const oi = Number(chunk.output_index)
          const b = toolBlocks.get(oi)
          if (b) {
            b.callId = meta.callId
            b.name = meta.name
          } else {
            pendingToolMeta.set(oi, meta)
          }
        }
        break
      }
      case 'response.output_text.delta': {
        const text = chunk.delta
        if (typeof text === 'string' && text.length > 0) {
          if (!textBlock) {
            textBlock = { index: nextIndex++, text: '' }
            order.push({ kind: 'text', index: textBlock.index })
            out.push({ type: 'block-start', index: textBlock.index, blockType: 'text' })
          }
          textBlock.text += text
          out.push({ type: 'text-delta', index: textBlock.index, text })
        }
        break
      }
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta': {
        const text = chunk.delta
        if (typeof text === 'string' && text.length > 0) {
          if (!reasoningBlock) {
            reasoningBlock = { index: nextIndex++, text: '' }
            order.push({ kind: 'reasoning', index: reasoningBlock.index })
            out.push({ type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' })
          }
          reasoningBlock.text += text
          out.push({ type: 'reasoning-delta', index: reasoningBlock.index, text })
        }
        break
      }
      case 'response.function_call_arguments.delta': {
        const oi = Number(chunk.output_index)
        let b = toolBlocks.get(oi)
        if (!b) {
          const meta = pendingToolMeta.get(oi) ?? { callId: '', name: '' }
          b = { index: nextIndex++, text: '', callId: meta.callId, name: meta.name }
          toolBlocks.set(oi, b)
          order.push({ kind: 'tool-call', index: b.index })
          out.push({ type: 'block-start', index: b.index, blockType: 'tool-call' })
        }
        const frag = typeof chunk.delta === 'string' ? chunk.delta : ''
        b.text += frag
        out.push({
          type: 'tool-call-delta',
          index: b.index,
          id: CallId(b.callId),
          ...(b.name !== '' ? { name: b.name } : {}),
          argumentsDelta: frag,
        })
        break
      }
      case 'response.completed': {
        pendingStatus = chunk.response?.status
        pendingUsage = chunk.response?.usage
        break
      }
      case 'response.failed': {
        pendingStatus = 'failed'
        break
      }
      case 'error': {
        throw new LlmError(
          chunk?.message ?? String(chunk?.error ?? 'provider stream error'),
          'PROVIDER',
        )
      }
      default:
        break
    }
    return out
  }

  const dispatch = (event: string, dataLines: string[]): StreamChunk[] => {
    if (dataLines.length === 0) return []
    const data = dataLines.join('\n')
    dataLines.length = 0
    return handle(event, data)
  }

  let eventName = ''
  const dataLines: string[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n')) >= 0) {
      let line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (line === '') {
        for (const c of dispatch(eventName, dataLines)) yield c
        eventName = ''
        continue
      }
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim()
        continue
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''))
        continue
      }
    }
  }
  for (const c of dispatch(eventName, dataLines)) yield c

  // 收尾：关闭所有已打开的块，emit usage + finish。
  for (const o of order) {
    if (o.kind === 'text' && textBlock) {
      yield { type: 'block-end', index: o.index, block: { type: 'text', text: textBlock.text } }
    } else if (o.kind === 'reasoning' && reasoningBlock) {
      yield { type: 'block-end', index: o.index, block: { type: 'reasoning', text: reasoningBlock.text } }
    } else if (o.kind === 'tool-call') {
      const b = [...toolBlocks.values()].find((x) => x.index === o.index)
      if (b) {
        yield {
          type: 'block-end',
          index: b.index,
          block: { type: 'tool-call', id: CallId(b.callId), name: b.name, arguments: b.text },
        }
      }
    }
  }
  if (pendingUsage !== undefined) {
    const usage = mapUsage(pendingUsage)
    if (usage !== undefined) yield { type: 'usage', usage }
  }
  const status = mapStatus(pendingStatus)
  let reason: any
  if (status.kind === 'stop' && order.length === 0) {
    reason = {
      kind: 'error',
      failure: { message: 'model returned a completed response with no content', code: 'EMPTY_RESPONSE' },
    }
  } else if (status.kind === 'error') {
    reason = { kind: 'error', failure: status.failure }
  } else if (status.kind === 'max-tokens') {
    reason = { kind: 'max-tokens' }
  } else {
    reason = { kind: 'stop' }
  }
  yield { type: 'finish', reason }
}

export class ChatGptAdapter extends LlmAdapter {
  private readonly cfg: AdapterConfig

  constructor(cfg: AdapterConfig) {
    super()
    this.cfg = cfg
  }

  providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.cfg.displayName ?? 'ChatGPT (订阅)' }
  }

  listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const o = this.cfg.options()
    return Promise.resolve(
      o.models.map((m) => ({
        provider,
        id: m.id,
        name: m.name,
        inputModalities: ['text'] as const,
      })),
    )
  }

  resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const o = this.cfg.options()
    const m = o.models.find((x) => x.id === model)
    const reasoning = this.cfg.reasoning
    return Promise.resolve({
      provider,
      id: model,
      name: m?.name ?? model,
      inputModalities: ['text'],
      context: { contextWindow: m?.contextWindow ?? o.defaultContextWindow },
      defaultMaxTokens: o.maxTokens,
      // 声明思考强度档位 → 模型选择器显示「推理等级」菜单。
      ...(reasoning !== undefined
        ? {
            reasoning: {
              efforts: reasoning.efforts.map((e) => ({
                id: ReasoningEffortId(e.id),
                name: e.name,
                ...(e.description !== undefined ? { description: e.description } : {}),
              })),
              ...(reasoning.defaultEffort !== undefined
                ? { defaultEffort: ReasoningEffortId(reasoning.defaultEffort) }
                : {}),
            },
          }
        : {}),
    })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const o = this.cfg.options()
    const label = this.cfg.label ?? 'chatgpt'
    const token = await this.cfg.resolveAccessToken()
    const body = serializeRequest(options, o, this.cfg.reasoning)
    const headers: Record<string, string> = {
      authorization: `Bearer ${token.access}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...attributionHeaders(),
    }

    let response: Response
    try {
      response = await fetch(o.apiBaseURL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options.signal,
      })
    } catch (error) {
      if (options.signal?.aborted) {
        throw new LlmError(`${label} request aborted by caller`, 'ABORTED', { cause: error as Error })
      }
      throw new LlmError(`${label} request to ${o.apiBaseURL} failed`, 'TRANSPORT', {
        cause: error as Error,
      })
    }

    if (!response.ok) {
      let message = `${label} API error (HTTP ${response.status})`
      try {
        const err = (await response.json()) as any
        if (err?.error?.message) message = err.error.message
      } catch {
        /* keep status-only message */
      }
      throw new LlmError(message, httpErrorCode(response.status), { status: response.status })
    }
    if (!response.body) {
      throw new LlmError(`${label} API returned no response body`, 'EMPTY_RESPONSE')
    }
    yield* translate(response.body)
  }
}
