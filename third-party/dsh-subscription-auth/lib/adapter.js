import { LlmAdapter, LlmError, CallId, ReasoningEffortId, attributionHeaders } from "@deepseek-ai/dsh-llm";
function flattenText(blocks) {
  let out = "";
  for (const block of blocks) {
    if (block.type === "text")
      out += block.text;
  }
  return out;
}
function serializeRequest(options, o, reasoning) {
  const input = [];
  let instructions = options.system;
  for (const message of options.messages) {
    if (message.role === "system") {
      const text = flattenText(message.content);
      instructions = instructions !== undefined ? `${instructions}

${text}` : text;
      continue;
    }
    if (message.role === "assistant") {
      const textParts = [];
      const calls = [];
      for (const block of message.content) {
        if (block.type === "text") {
          textParts.push(block.text);
        } else if (block.type === "tool-call") {
          calls.push({
            type: "function_call",
            call_id: block.id,
            name: block.name,
            arguments: block.arguments
          });
        }
      }
      if (textParts.length > 0) {
        input.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: textParts.join("") }]
        });
      }
      input.push(...calls);
      continue;
    }
    const textParts = [];
    for (const block of message.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "tool-result") {
        input.push({
          type: "function_call_output",
          call_id: block.toolCallId,
          output: flattenText(block.content) || "(no output)"
        });
      }
    }
    if (textParts.length > 0) {
      input.push({
        type: "message",
        role: "user",
        content: textParts.map((t) => ({ type: "input_text", text: t }))
      });
    }
  }
  const body = {
    model: options.model,
    input,
    stream: true,
    store: false
  };
  if (instructions !== undefined)
    body.instructions = instructions;
  if (reasoning !== undefined && options.reasoningEffort !== undefined) {
    body.reasoning = { effort: options.reasoningEffort };
  }
  if (options.tools !== undefined && options.tools.length > 0) {
    body.tools = options.tools.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }));
  }
  return body;
}
function httpErrorCode(status) {
  if (status === 401 || status === 403)
    return "AUTH";
  if (status === 429)
    return "RATE_LIMIT";
  if (status === 400)
    return "INVALID_REQUEST";
  if (status >= 500)
    return "SERVER";
  return `HTTP_${status}`;
}
function mapUsage(usage) {
  const cacheRead = usage?.input_tokens_details?.cached_tokens;
  const reasoning = usage?.output_tokens_details?.reasoning_tokens;
  const inputTokens = Math.max(0, (usage?.input_tokens ?? 0) - (cacheRead ?? 0));
  const outputTokens = usage?.output_tokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0 && cacheRead === undefined && reasoning === undefined)
    return;
  return {
    inputTokens,
    outputTokens,
    ...cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {},
    ...reasoning !== undefined ? { reasoningTokens: reasoning } : {}
  };
}
function mapStatus(status) {
  switch (status) {
    case "completed":
      return { kind: "stop" };
    case "incomplete":
      return { kind: "max-tokens" };
    case "cancelled":
      return { kind: "stop" };
    case "failed":
      return { kind: "error", failure: { message: "model response failed", code: "FAILED" } };
    default:
      return { kind: "stop" };
  }
}
async function* translate(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder;
  let buffer = "";
  let nextIndex = 0;
  let textBlock;
  let reasoningBlock;
  const order = [];
  const toolBlocks = new Map;
  const pendingToolMeta = new Map;
  let pendingStatus;
  let pendingUsage;
  const handle = (event, data) => {
    let chunk = {};
    if (data.trim() !== "") {
      try {
        chunk = JSON.parse(data);
      } catch {
        return [];
      }
    }
    const out = [];
    switch (event) {
      case "response.output_item.added": {
        const item = chunk.item;
        if (item?.type === "function_call") {
          const meta = {
            callId: String(item.call_id ?? item.id ?? ""),
            name: String(item.name ?? "")
          };
          const oi = Number(chunk.output_index);
          const b = toolBlocks.get(oi);
          if (b) {
            b.callId = meta.callId;
            b.name = meta.name;
          } else {
            pendingToolMeta.set(oi, meta);
          }
        }
        break;
      }
      case "response.output_text.delta": {
        const text = chunk.delta;
        if (typeof text === "string" && text.length > 0) {
          if (!textBlock) {
            textBlock = { index: nextIndex++, text: "" };
            order.push({ kind: "text", index: textBlock.index });
            out.push({ type: "block-start", index: textBlock.index, blockType: "text" });
          }
          textBlock.text += text;
          out.push({ type: "text-delta", index: textBlock.index, text });
        }
        break;
      }
      case "response.reasoning_summary_text.delta":
      case "response.reasoning_text.delta": {
        const text = chunk.delta;
        if (typeof text === "string" && text.length > 0) {
          if (!reasoningBlock) {
            reasoningBlock = { index: nextIndex++, text: "" };
            order.push({ kind: "reasoning", index: reasoningBlock.index });
            out.push({ type: "block-start", index: reasoningBlock.index, blockType: "reasoning" });
          }
          reasoningBlock.text += text;
          out.push({ type: "reasoning-delta", index: reasoningBlock.index, text });
        }
        break;
      }
      case "response.function_call_arguments.delta": {
        const oi = Number(chunk.output_index);
        let b = toolBlocks.get(oi);
        if (!b) {
          const meta = pendingToolMeta.get(oi) ?? { callId: "", name: "" };
          b = { index: nextIndex++, text: "", callId: meta.callId, name: meta.name };
          toolBlocks.set(oi, b);
          order.push({ kind: "tool-call", index: b.index });
          out.push({ type: "block-start", index: b.index, blockType: "tool-call" });
        }
        const frag = typeof chunk.delta === "string" ? chunk.delta : "";
        b.text += frag;
        out.push({
          type: "tool-call-delta",
          index: b.index,
          id: CallId(b.callId),
          ...b.name !== "" ? { name: b.name } : {},
          argumentsDelta: frag
        });
        break;
      }
      case "response.completed": {
        pendingStatus = chunk.response?.status;
        pendingUsage = chunk.response?.usage;
        break;
      }
      case "response.failed": {
        pendingStatus = "failed";
        break;
      }
      case "error": {
        throw new LlmError(chunk?.message ?? String(chunk?.error ?? "provider stream error"), "PROVIDER");
      }
      default:
        break;
    }
    return out;
  };
  const dispatch = (event, dataLines) => {
    if (dataLines.length === 0)
      return [];
    const data = dataLines.join(`
`);
    dataLines.length = 0;
    return handle(event, data);
  };
  let eventName = "";
  const dataLines = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done)
      break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf(`
`)) >= 0) {
      let line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.endsWith("\r"))
        line = line.slice(0, -1);
      if (line === "") {
        for (const c of dispatch(eventName, dataLines))
          yield c;
        eventName = "";
        continue;
      }
      if (line.startsWith(":"))
        continue;
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
        continue;
      }
    }
  }
  for (const c of dispatch(eventName, dataLines))
    yield c;
  for (const o of order) {
    if (o.kind === "text" && textBlock) {
      yield { type: "block-end", index: o.index, block: { type: "text", text: textBlock.text } };
    } else if (o.kind === "reasoning" && reasoningBlock) {
      yield { type: "block-end", index: o.index, block: { type: "reasoning", text: reasoningBlock.text } };
    } else if (o.kind === "tool-call") {
      const b = [...toolBlocks.values()].find((x) => x.index === o.index);
      if (b) {
        yield {
          type: "block-end",
          index: b.index,
          block: { type: "tool-call", id: CallId(b.callId), name: b.name, arguments: b.text }
        };
      }
    }
  }
  if (pendingUsage !== undefined) {
    const usage = mapUsage(pendingUsage);
    if (usage !== undefined)
      yield { type: "usage", usage };
  }
  const status = mapStatus(pendingStatus);
  let reason;
  if (status.kind === "stop" && order.length === 0) {
    reason = {
      kind: "error",
      failure: { message: "model returned a completed response with no content", code: "EMPTY_RESPONSE" }
    };
  } else if (status.kind === "error") {
    reason = { kind: "error", failure: status.failure };
  } else if (status.kind === "max-tokens") {
    reason = { kind: "max-tokens" };
  } else {
    reason = { kind: "stop" };
  }
  yield { type: "finish", reason };
}

export class ChatGptAdapter extends LlmAdapter {
  cfg;
  constructor(cfg) {
    super();
    this.cfg = cfg;
  }
  providerInfo(provider) {
    return { id: provider, name: this.cfg.displayName ?? "ChatGPT (订阅)" };
  }
  listModels(provider) {
    const o = this.cfg.options();
    return Promise.resolve(o.models.map((m) => ({
      provider,
      id: m.id,
      name: m.name,
      inputModalities: ["text"]
    })));
  }
  resolveModel(provider, model, _signal) {
    const o = this.cfg.options();
    const m = o.models.find((x) => x.id === model);
    const reasoning = this.cfg.reasoning;
    return Promise.resolve({
      provider,
      id: model,
      name: m?.name ?? model,
      inputModalities: ["text"],
      context: { contextWindow: m?.contextWindow ?? o.defaultContextWindow },
      defaultMaxTokens: o.maxTokens,
      ...reasoning !== undefined ? {
        reasoning: {
          efforts: reasoning.efforts.map((e) => ({
            id: ReasoningEffortId(e.id),
            name: e.name,
            ...e.description !== undefined ? { description: e.description } : {}
          })),
          ...reasoning.defaultEffort !== undefined ? { defaultEffort: ReasoningEffortId(reasoning.defaultEffort) } : {}
        }
      } : {}
    });
  }
  async* stream(options) {
    const o = this.cfg.options();
    const label = this.cfg.label ?? "chatgpt";
    const token = await this.cfg.resolveAccessToken();
    const body = serializeRequest(options, o, this.cfg.reasoning);
    const headers = {
      authorization: `Bearer ${token.access}`,
      "content-type": "application/json",
      accept: "text/event-stream",
      ...attributionHeaders()
    };
    let response;
    try {
      response = await fetch(o.apiBaseURL, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: options.signal
      });
    } catch (error) {
      if (options.signal?.aborted) {
        throw new LlmError(`${label} request aborted by caller`, "ABORTED", { cause: error });
      }
      throw new LlmError(`${label} request to ${o.apiBaseURL} failed`, "TRANSPORT", {
        cause: error
      });
    }
    if (!response.ok) {
      let message = `${label} API error (HTTP ${response.status})`;
      try {
        const err = await response.json();
        if (err?.error?.message)
          message = err.error.message;
      } catch {}
      throw new LlmError(message, httpErrorCode(response.status), { status: response.status });
    }
    if (!response.body) {
      throw new LlmError(`${label} API returned no response body`, "EMPTY_RESPONSE");
    }
    yield* translate(response.body);
  }
}
