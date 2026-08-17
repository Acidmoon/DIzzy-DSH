/**
 * anchored-context-gate — reusable unified injection control for ANY preset.
 *
 * Mount this one plugin to keep a session's first model request free of
 * auto-injected context, whatever its source, and to have every injection
 * return on the second round. It intercepts the harness's two unified
 * injection paths — not a per-source denylist — so it covers sources that do
 * not exist yet:
 *
 *  a. RUNTIME CONTEXT (system-prompt/assemble): while the session is
 *     unpromoted, the assembly's `contexts` are blanked. That covers the
 *     WHOLE `SystemPrompt.context()` family — the sandbox and approval
 *     policy snapshots and any third-party context provider — without
 *     enumerating them. The loop's own snapshot projection then emits no
 *     message during the gate (no snapshot ever existed), and at the first
 *     promoted request it emits exactly ONE fresh snapshot: "minimal first
 *     round, inject on the second round" falls out of the projection's
 *     diffing, with no reinjection logic here.
 *
 *  b. STEP MESSAGES (agent/pre-step): the waterfall payload carries the
 *     CLAIMED message batch (the inbox messages this step owns). While
 *     unpromoted, the gate keeps exactly the claimed messages plus a small
 *     kind allowlist, and strips everything any listener appended — skill
 *     catalog, AGENTS.md digest, time/tmux context, hooks, unknown
 *     third-party plugins — by DEFAULT, regardless of source identity. The
 *     default allowlist is `['skill-invocation']`: a user-initiated skill
 *     gesture is not an automatic injection, and stripping it would lose the
 *     skill content once the gesture scrolls out of the per-step claim.
 *     Durable history (compaction summaries included) never passes through
 *     this gate: it enters the request via the session surface, not the
 *     pre-step waterfall.
 *
 * The phase is the same epoch-aware promotion machine the anchored presets
 * use (see compaction-epoch.mjs): a durable `tool/call` and/or
 * `assistant/message` (per `promoteOn`, default `either`) promotes, and a
 * `compaction/end` boundary demotes again — the first post-compaction request
 * is a "second first request" and is gated the same way. Derived from durable
 * events, so resume and reload preserve it.
 *
 * SUBAGENTS: by default subagents (delegationDepth > 0) skip the gate (their
 * first request already sees full context). `includeSubagents: true` gates
 * them too — their first request is clean and their own first reply or tool
 * call opens the gate — so a delegation cannot reintroduce an uncontrolled
 * first request. Keep this flag in sync with any companion phase plugin
 * (e.g. the tool-bootstrap row).
 *
 * CONFIG:
 *  - `promoteOn`: 'either' (default) | 'tool-call' | 'assistant-message'.
 *  - `includeSubagents`: boolean, default false.
 *  - `enabled`: boolean, default true. `false` disables both interception
 *    paths (A/B testing without touching the row set).
 *  - `allowKinds`: message `source.kind` names allowed beyond the claimed
 *    batch, default ['skill-invocation']. An explicitly empty array keeps
 *    ONLY the claimed batch.
 *
 * ROW ORDER: mount this row FIRST in the composition. Waterfall after-next
 * transforms apply in reverse registration order, so registering first (plus
 * the pre-step listener's `prepend: true`) makes the gate the outermost
 * transform — nothing registered later re-injects past it.
 *
 * Robustness: both filters degrade to "keep everything" on their own
 * failures — a gate bug must never eat the user's context — and invalid
 * config fails at apply time, i.e. at preset mount, where it is visible.
 */

import { createEpochPromotion } from './compaction-epoch.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'anchored-context-gate'

/**
 * Deliberately NO inject list: the listeners only touch services at event
 * time, and applying without an inject lets this row register before the
 * context-injecting plugins (dsh-agent-instructions, dsh-tool-skill, host
 * plane policy projections) when it sits first in the composition.
 */
export const inject = []

/** Durable session event types that count as a promotion signal per mode. */
const PROMOTE_EVENTS = {
  'tool-call': ['tool/call'],
  'assistant-message': ['assistant/message'],
  either: ['tool/call', 'assistant/message'],
}

/** Every config key this plugin accepts — anything else is a typo. */
const ALLOWED_KEYS = new Set(['promoteOn', 'includeSubagents', 'enabled', 'allowKinds'])

/**
 * Message kinds allowed through the pre-step gate beyond the claimed batch.
 * A user-initiated skill gesture is the only default entry: it is not an
 * automatic injection (see the header note).
 */
const DEFAULT_ALLOW_KINDS = ['skill-invocation']

function parsePromoteOn(value) {
  if (value === undefined || value === 'either') return PROMOTE_EVENTS.either
  if (value === 'tool-call' || value === 'assistant-message') return PROMOTE_EVENTS[value]
  throw new TypeError(`${name}: promoteOn must be one of "tool-call", "assistant-message", "either"; got ${JSON.stringify(value)}`)
}

/**
 * Validate the kind allowlist. An explicitly empty array is meaningful: keep
 * ONLY the claimed batch, stripping even user skill gestures.
 */
function allowKindList(value, field) {
  if (value === undefined) return new Set(DEFAULT_ALLOW_KINDS)
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${name}: ${field} must be an array of non-empty strings`)
  }
  return new Set(value)
}

/** Validate an optional boolean flag with a default. */
function booleanOption(value, field, fallback) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') {
    throw new TypeError(`${name}: ${field} must be a boolean`)
  }
  return value
}

/** Register the unified context gate. */
export function apply(ctx, config) {
  const source = config === undefined ? {} : config
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    throw new TypeError(`${name}: config must be an object`)
  }
  const unknown = Object.keys(source).filter((key) => !ALLOWED_KEYS.has(key))
  if (unknown.length > 0) {
    throw new TypeError(
      `${name}: unknown config key(s) ${unknown.join(', ')} — allowed keys: ${[...ALLOWED_KEYS].sort().join(', ')}`,
    )
  }
  const promoteEvents = parsePromoteOn(source.promoteOn)
  const includeSubagents = booleanOption(source.includeSubagents, 'includeSubagents', false)
  const enabled = booleanOption(source.enabled, 'enabled', true)
  const allowKinds = allowKindList(source.allowKinds, 'allowKinds')

  const promotion = createEpochPromotion(promoteEvents, { includeSubagents })
  ctx.on('session/event', (session, event) => promotion.observe(session, event))

  let warned = false
  const warnOnce = (message) => {
    if (warned) return
    warned = true
    try {
      ctx.logger.warn(message)
    } catch {
      // Logger unavailable — the guard exists only to avoid spamming.
    }
  }

  // Path (a): blank the dynamic runtime-context contributions while the
  // session is unpromoted. Covers the whole SystemPrompt.context() family
  // without enumerating it; the loop's snapshot projection then stays silent
  // and diffs exactly ONE fresh snapshot in at the first promoted request.
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    // Downstream errors propagate untouched; only this filter's own logic is guarded.
    const assembled = await next()
    if (enabled === false) return assembled
    try {
      if (promotion.status(context.agent).promoted) return assembled
      if (!Array.isArray(assembled.contexts) || assembled.contexts.length === 0) return assembled
      return { ...assembled, contexts: [] }
    } catch (error) {
      // A gate bug must never break assembly: degrade to the assembled value.
      warnOnce(`${name}: runtime-context suppression failed, keeping contexts: ${String((error && error.message) || error)}`)
      return assembled
    }
  })

  // Path (b): claimed-baseline deny on the pre-step waterfall. The payload's
  // `messages` is the batch this step CLAIMED from the inbox — the baseline
  // every injection appends to. Keep that baseline plus the kind allowlist,
  // strip every appended message regardless of its source identity.
  ctx.on('agent/pre-step', async ({ agent, messages: claimed }, next) => {
    // Downstream errors propagate untouched; only this filter's own logic is guarded.
    const decision = await next()
    if (decision.kind === 'reject') return decision
    if (enabled === false) return decision
    try {
      if (promotion.status(agent).promoted) return decision
      if (!Array.isArray(decision.messages)) return decision
      if (!Array.isArray(claimed)) return decision
      const baseline = new Set(claimed)
      const baselineIds = new Set(claimed
        .map((message) => message?.id)
        .filter((id) => id !== undefined && id !== null))
      const kept = decision.messages.filter((message) =>
        baseline.has(message)
        || (message?.id !== undefined && message?.id !== null && baselineIds.has(message.id))
        || allowKinds.has(message?.source?.kind),
      )
      return kept.length === decision.messages.length ? decision : { ...decision, messages: kept }
    } catch (error) {
      // A gate bug must never eat context: degrade to keeping every message.
      warnOnce(`${name}: pre-step gate failed, keeping injected context: ${String((error && error.message) || error)}`)
      return decision
    }
  }, { prepend: true })
}
