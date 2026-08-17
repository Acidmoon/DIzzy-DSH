#!/usr/bin/env node
/**
 * analyze-template — offline prefab template quality report. No API calls.
 *
 * A seeded session inherits EXACTLY the reasoning of the template's
 * tool-calling assistant messages: the harness replay rule (llm-deepseek
 * serialize) carries `reasoning_content` on assistant messages that contain
 * tool calls and drops it on pure-text messages. That replayed slice is the
 * template's ANCHOR MASS — everything else (the dropped pure-text reasoning,
 * the chunk streams) never reaches a cloned session's next request.
 *
 * This tool recomputes, from the exact pipeline the seeder will run
 * (loadPrefabTemplate → buildSeedPlan), what a cloned session would inherit:
 *
 *  1. REPLAY REPORT — per assistant message: blocks, reasoning chars, whether
 *     the replay rule keeps its reasoning, and the running replayed total.
 *     Metrics (we / let me / I density, first lines) are computed on the
 *     REPLAYED slice, because style numbers over all reasoning overstate the
 *     anchor a clone actually receives.
 *  2. GENERALITY LINT — the substituted seed plan is scanned for content a
 *     generic clone must not carry: source-cwd remnants after rewriting, any
 *     drive-letter paths, workspace/user identifiers, project names, and
 *     tool-name restatements outside the supported rewrite surface.
 *  3. THRESHOLD GATE — --min-replayed-chars / --min-effective-turns exit 1
 *     when the template is below the roll spec, so a template swap can be
 *     gated in review the same way `npm run check` gates code.
 *
 * Usage:
 *   node prefab/analyze-template.mjs [template.jsonl] [--json]
 *        [--min-replayed-chars N] [--min-effective-turns N]
 *        [--target-cwd /fake/target] [--agents-md <file>]
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSeedPlan, loadPrefabTemplate, DEFAULT_DURABLE_TOOLS } from './prefab-session-seed.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Tool names a generic clone may legitimately carry. */
const SUPPORTED_TOOLS = new Set([
  'bash', 'str_replace_editor',
  'dev_tool_search', 'skill_search', 'skill_load',
  ...DEFAULT_DURABLE_TOOLS,
])

/** Substring identifiers that would tie a clone to this machine's projects. */
const PROJECT_MARKERS = [
  'project2', 'v4.1b', 'modeltest', 'dsh-anchored-standard',
  'deepseekcotexplorations', 'minimal-trigger-probe', 'prefab-generic-roll-workspace',
]

/** Machine-local identifiers (usernames, well-known local checkouts). */
const MACHINE_MARKERS = ['y2278', 'users\\y2278', 'users/y2278']

const count = (text, regex) => [...text.matchAll(regex)].length

/** All textual content of one retained event, tagged by where it lives. */
function eventTexts(event) {
  const out = []
  if (event.type === 'tool/call') {
    out.push(['tool-args', event.data?.name === 'dev_tool_search' ? '' : String(event.data?.arguments ?? '')])
    return out
  }
  const message = event.data?.message
  if (message === undefined) return out
  for (const block of message.content ?? []) {
    if (block?.type === 'reasoning' || block?.type === 'text') {
      out.push([`assistant:${block.type}`, typeof block.text === 'string' ? block.text : ''])
    }
    if (block?.type === 'tool-call') {
      out.push(['assistant:tool-args', String(block.arguments ?? '')])
    }
    if (Array.isArray(block?.content)) {
      for (const part of block.content) {
        if (typeof part?.text === 'string') out.push(['tool-result', part.text])
      }
    }
  }
  return out
}

function lintPlan(plan, sourceCwd, targetCwd) {
  const findings = []
  const note = (severity, kind, where, detail) => findings.push({ severity, kind, where, detail })
  const cwdForms = [sourceCwd, sourceCwd.replace(/\\/g, '/'), sourceCwd.replace(/\//g, '\\')]
  for (const event of plan) {
    for (const [where, text] of eventTexts(event)) {
      if (text === '') continue
      for (const form of cwdForms) {
        if (form.length > 3 && text.toLowerCase().includes(form.toLowerCase())) {
          note('error', 'source-cwd-remnant', where, form)
        }
      }
      const drives = text.match(/[A-Za-z]:[\\/][\w\\/.-]{3,}/g) ?? []
      for (const drive of drives) {
        if (drive.toLowerCase().startsWith(targetCwd.slice(0, 3).toLowerCase())) continue
        note('error', 'absolute-path', where, drive)
      }
      for (const marker of PROJECT_MARKERS) {
        if (text.toLowerCase().includes(marker)) note('error', 'project-marker', where, marker)
      }
      for (const marker of MACHINE_MARKERS) {
        if (text.toLowerCase().includes(marker)) note('error', 'machine-marker', where, marker)
      }
      for (const name of text.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? []) {
        if (!SUPPORTED_TOOLS.has(name)) {
          note('warn', 'unsupported-tool-mention', where, name)
        }
      }
    }
  }
  const seen = new Set()
  return findings.filter((finding) => {
    const key = `${finding.kind}:${String(finding.detail).toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Compute the anchor-mass report of one template file through the exact seed
 * pipeline (loadPrefabTemplate → buildSeedPlan). Exported for roll-prefab's
 * post-clean acceptance gate: the roll runner's own counts see the RAW session,
 * while this sees what a clone actually inherits after template cleaning.
 */
export function analyzeTemplate(templatePath, { targetCwd, agentsMd }) {
  const template = loadPrefabTemplate(templatePath)
  const plan = buildSeedPlan(template, targetCwd, agentsMd)

  const messages = plan.filter((event) => event.type === 'assistant/message')
  let replayedChars = 0
  let effectiveTurns = 0
  let droppedChars = 0
  const rows = []
  const replayedTexts = []
  for (const event of messages) {
    const blocks = event.data?.message?.content ?? []
    const reasoning = blocks.filter((block) => block?.type === 'reasoning')
    const toolCalls = blocks.filter((block) => block?.type === 'tool-call')
    const chars = reasoning.reduce((sum, block) => sum + (block.text?.length ?? 0), 0)
    const replays = toolCalls.length > 0 && chars > 0
    if (replays) {
      replayedChars += chars
      effectiveTurns += 1
      replayedTexts.push(...reasoning.map((block) => block.text ?? ''))
    } else {
      droppedChars += chars
    }
    rows.push({
      seq: event.seq,
      turn: event.data?.turn,
      reasoningBlocks: reasoning.length,
      toolCalls: toolCalls.length,
      textBlocks: blocks.filter((block) => block?.type === 'text').length,
      reasoningChars: chars,
      replays,
    })
  }

  const replayed = replayedTexts.join('\n')
  const style = {
    we: count(replayed, /\bwe\b/gi),
    letMe: count(replayed, /\blet me\b/gi),
    i: count(replayed, /\bi\b/gi),
    firstLines: replayedTexts.map((text) => text.split(/\r?\n/, 1)[0].slice(0, 80)),
  }

  const unlocks = [...new Set(plan
    .filter((event) => event.type === 'tool/call' && event.data?.name === 'dev_tool_search')
    .flatMap((event) => {
      try { return JSON.parse(event.data.arguments).toolNames ?? [] } catch { return [] }
    }))]

  return {
    templatePath,
    sourceCwd: template.sourceCwd,
    assistantMessages: messages.length,
    effectiveToolReasoningTurns: effectiveTurns,
    replayedReasoningChars: replayedChars,
    droppedReasoningChars: droppedChars,
    replayRatio: replayedChars / Math.max(1, replayedChars + droppedChars),
    style,
    declaredUnlocks: unlocks,
    findings: lintPlan(plan, template.sourceCwd, targetCwd),
    rows,
  }
}

// CLI entry — guarded so roll-prefab can import analyzeTemplate without
// triggering an analysis run.
if (process.argv[1] !== undefined && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href) {
const args = process.argv.slice(2)
const positional = []
const opts = {
  json: false,
  minReplayedChars: 0,
  minEffectiveTurns: 0,
  targetCwd: 'D:\\clone\\workspace',
  agentsMd: 'No AGENTS.md instruction file is present; continue without additional file-based instructions.',
}
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--json') opts.json = true
  else if (args[i] === '--min-replayed-chars') opts.minReplayedChars = Number(args[++i])
  else if (args[i] === '--min-effective-turns') opts.minEffectiveTurns = Number(args[++i])
  else if (args[i] === '--target-cwd') opts.targetCwd = args[++i]
  else if (args[i] === '--agents-md') { opts.agentsMd = readFileSync(args[++i], 'utf8') }
  else if (args[i] === '--help' || args[i] === '-h') {
    console.log('usage: node prefab/analyze-template.mjs [template.jsonl] [--json] [--min-replayed-chars N] [--min-effective-turns N] [--target-cwd DIR] [--agents-md FILE]')
    process.exit(0)
  } else positional.push(args[i])
}
const templatePath = resolve(positional[0] ?? `${HERE}/template.jsonl`)
const { agentsMd } = opts

const report = analyzeTemplate(templatePath, { targetCwd: opts.targetCwd, agentsMd })

if (opts.json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`template: ${report.templatePath}`)
  console.log(`rolled cwd: ${report.sourceCwd}`)
  console.log(`assistant messages: ${report.assistantMessages}`)
  console.log(`effective tool-reasoning turns (replay): ${report.effectiveToolReasoningTurns}`)
  console.log(`replayed reasoning chars: ${report.replayedReasoningChars}`)
  console.log(`dropped reasoning chars (pure-text turns): ${report.droppedReasoningChars}`)
  console.log(`replay ratio: ${(report.replayRatio * 100).toFixed(1)}%`)
  console.log(`declared unlocks: ${report.declaredUnlocks.join(', ') || '(none)'}`)
  console.log(`replayed-slice style: we=${report.style.we} letMe=${report.style.letMe} i=${report.style.i}`)
  for (const line of report.style.firstLines) console.log(`  first line: ${line}`)
  console.log('per-message breakdown:')
  for (const row of report.rows) {
    console.log(`  seq=${row.seq} turn=${row.turn} reasoning=${row.reasoningChars}ch toolCalls=${row.toolCalls} text=${row.textBlocks} -> ${row.replays ? 'REPLAYS' : 'DROPS'}`)
  }
  console.log(`generality findings: ${report.findings.length}`)
  for (const finding of report.findings) {
    console.log(`  [${finding.severity}] ${finding.kind} (${finding.where}): ${finding.detail}`)
  }
}

const errors = report.findings.filter((finding) => finding.severity === 'error')
const belowChars = report.replayedReasoningChars < opts.minReplayedChars
const belowTurns = report.effectiveToolReasoningTurns < opts.minEffectiveTurns
if (errors.length > 0 || belowChars || belowTurns) {
  console.error(`analyze-template: FAIL (${errors.length} lint errors${belowChars ? ', replayed chars below threshold' : ''}${belowTurns ? ', effective turns below threshold' : ''})`)
  process.exit(1)
}
console.log('analyze-template: OK')
}
