/**
 * roll-prefab — outer roller: drive real headless sessions until one is
 * perfect, then export its durable log as the prefab template.
 *
 * Usage:
 *   node prefab/roll-prefab.mjs --cwd "E:/Desktop/mytests/modeltest/workspace" \
 *       [--attempts 6] [--out prefab/template.jsonl]
 *
 * Requires DSH_HARNESS_ROOT (a harness checkout with apps/cli/lib/bin.js).
 * Each attempt boots the headless profile with the roll-runner plugin, sends
 * the anchor task then the loading task, and parses the PREFAB_RESULT line.
 * On success the session's session.jsonl.zstd is located by scanning the
 * store for the reported session id, decompressed (zstd multi-frame), and
 * saved as the plaintext template.
 */

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { analyzeTemplate } from './analyze-template.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const HARNESS = process.env.DSH_HARNESS_ROOT
const LAUNCHER = HARNESS && join(HARNESS, 'apps', 'cli', 'lib', 'bin.js')
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const PROFILE_DIR = join(DSH_HOME, 'profiles', 'headless')

const ANCHOR_TASK = 'Read the workspace-root AGENTS.md completely before any future maintenance work. Use bash with exactly this command: cat ./AGENTS.md. Do not inspect or list anything else, and do not quote, summarize, or discuss the file contents. When the complete file has been read, reply only: Instructions loaded.'
const LOAD_TASK = [
  'Prepare the maintenance tool surface in sequential steps — exactly one tool call per assistant response, and wait for each result before continuing.',
  'Step 1: dev_tool_search with toolNames exactly read, write, edit, glob, grep, ask_user_question, todo_write, web_search.',
  'Step 2: skill_search with a query of your choosing that targets coding or review work.',
  'Step 3: skill_search with a query of your choosing that targets document or writing work.',
  'Step 4: skill_search with a query of your choosing that targets data or testing work.',
  'Before each call, briefly reason about what the step contributes to the preparation.',
  'Do not call any other tool, do not read AGENTS.md or any file again, and do not inspect or mention workspace content.',
  'When step 4 is done, reply with the single word: Ready.',
].join(' ')

/**
 * Post-clean acceptance: the roll runner's verdict sees the RAW session, but
 * the seeder's template cleaning (failed-read removal) can drop replayable
 * turns afterwards. The gate below re-measures the EXPORTED template through
 * the exact seed pipeline, so a template only ships when a clone would
 * actually inherit the spec'd anchor mass.
 */
function templateQualityGate(file, cwd) {
  const report = analyzeTemplate(file, {
    targetCwd: cwd,
    agentsMd: '(instruction file contents are substituted per destination)',
  })
  const errors = report.findings.filter((finding) => finding.severity === 'error')
  // Evidence-driven spec (2026-08-17): five replayable tool-reasoning turns,
  // at least 1000 replayed chars, zero let-me, clean lint, and the first
  // replayed line in the collaborative voice. Higher we-mass is aspirational
  // — today's follow-up turns narrate ("Step 2 …") — and is recorded in the
  // meta rather than gated; the clone probe measures whether it matters.
  const anchorWeFirst = /^we\b/i.test(report.style.firstLines[0] ?? '')
  const ok = report.effectiveToolReasoningTurns >= 5
    && report.replayedReasoningChars >= 1000
    && report.style.letMe === 0
    && anchorWeFirst
    && errors.length === 0
  return { ok, report, errors }
}

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  if (hit) return hit.slice(name.length + 3)
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}
const cwd = opt('cwd')
const attempts = Number(opt('attempts', '6'))
const out = opt('out', join(HERE, 'template.jsonl'))
const anchorTask = opt('anchor-task', ANCHOR_TASK)
const loadTask = opt('load-task', LOAD_TASK)
if (cwd === undefined || !existsSync(LAUNCHER)) {
  console.error('usage: node prefab/roll-prefab.mjs --cwd <dir> [--attempts N] [--out file]  (DSH_HARNESS_ROOT required)')
  process.exit(2)
}

function findSessionFile(sessionId) {
  const root = join(DSH_HOME, 'sessions')
  if (!existsSync(root)) return undefined
  for (const group of readdirSync(root, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    for (const entry of readdirSync(join(root, group.name), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name !== sessionId) continue
      const file = join(root, group.name, entry.name, 'session.jsonl.zstd')
      return existsSync(file) ? file : undefined
    }
  }
  return undefined
}

/** Decode a multi-frame zstd session log via Python (Node's one-shot API stops at frame 1). */
function decodeZstd(file) {
  const result = spawnSync('python', ['-c', 'import sys; from compression import zstd; sys.stdout.buffer.write(zstd.decompress(open(sys.argv[1],"rb").read()))', file], {
    encoding: 'buffer', maxBuffer: 512 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(`zstd decode failed: ${result.stderr?.toString().slice(0, 300)}`)
  return result.stdout.toString('utf8')
}

mkdirSync(PROFILE_DIR, { recursive: true })
const runToken = randomUUID()
const runnerName = `prefab-roll-runner-${runToken}.mjs`
const runnerFile = join(PROFILE_DIR, runnerName)
const patchFile = join(PROFILE_DIR, `prefab-roll-${runToken}.yml`)
copyFileSync(join(HERE, 'roll-runner.mjs'), runnerFile)

let template = null
try {
  for (let attempt = 1; attempt <= attempts && template === null; attempt += 1) {
    const patch = `# Generated by prefab/roll-prefab.mjs (attempt ${attempt})
- id: headless-startup
  disabled: true

- id: headless-runner
  disabled: true

- insert:
    - id: agent-presets
      name: '@deepseek-ai/dsh-agent-presets'
      config:
        default: standard

    - id: roll-runner
      name: ./${runnerName}
      config:
        anchorTask: ${JSON.stringify(anchorTask)}
        loadTask: ${JSON.stringify(loadTask)}
        preset: anchored-standard
        cwd: ${JSON.stringify(cwd)}
`
    writeFileSync(patchFile, patch)
    console.log(`— attempt ${attempt}/${attempts}`)
    const result = spawnSync(process.execPath, [LAUNCHER, '--profile', 'headless', '--patch', patchFile], {
      cwd: HARNESS, encoding: 'utf8', timeout: 600_000, env: process.env,
    })
    rmSync(patchFile, { force: true })
    const line = (result.stdout ?? '').split('\n').find((l) => l.startsWith('PREFAB_RESULT: '))
    if (line === undefined) {
      console.error(`  no verdict (exit ${result.status}); stderr: ${(result.stderr ?? '').slice(-400)}`)
      continue
    }
    const verdict = JSON.parse(line.slice('PREFAB_RESULT: '.length))
    console.log(`  styleOk=${verdict.styleOk} flowOk=${verdict.flowOk} rich=${verdict.effectiveReasoningCount ?? 0} letMeHits=${verdict.letMeHits} unlocked=[${(verdict.unlockedNames ?? []).join(',')}] agentsMd=${verdict.readAgentsMd} skills=${verdict.skillSearched}`)
    console.log(`  first: ${(verdict.firstLines ?? [])[0] ?? '(none)'}`)
    if (verdict.ok !== true) continue
    const file = findSessionFile(verdict.sessionId)
    if (file === undefined) {
      console.error(`  verdict ok but session file not found for ${verdict.sessionId}`)
      continue
    }
    const text = decodeZstd(file)
    // Gate the EXPORTED template through the seed pipeline: cleaning may have
    // dropped replayable turns the raw-session verdict counted.
    const candidate = `${out}.candidate.jsonl`
    writeFileSync(candidate, text)
    const gate = templateQualityGate(candidate, cwd)
    console.log(`  post-clean gate: turns=${gate.report.effectiveToolReasoningTurns} replayedChars=${gate.report.replayedReasoningChars} we=${gate.report.style.we} letMe=${gate.report.style.letMe} lintErrors=${gate.errors.length}`)
    if (gate.ok !== true) {
      console.error('  post-clean gate FAILED — attempt rejected')
      rmSync(candidate, { force: true })
      continue
    }
    template = { verdict, file, text, report: gate.report }
  }
} finally {
  rmSync(patchFile, { force: true })
  rmSync(runnerFile, { force: true })
}

if (template === null) {
  console.error(`no perfect roll in ${attempts} attempts`)
  process.exit(1)
}
writeFileSync(out, template.text)
writeFileSync(`${out}.meta.json`, JSON.stringify({
  rolledAt: new Date().toISOString(),
  cwd,
  sessionId: template.verdict.sessionId,
  unlockedNames: template.verdict.unlockedNames,
  firstLines: template.verdict.firstLines,
  anchorMass: {
    effectiveToolReasoningTurns: template.report.effectiveToolReasoningTurns,
    replayedReasoningChars: template.report.replayedReasoningChars,
    droppedReasoningChars: template.report.droppedReasoningChars,
    replayRatio: Number(template.report.replayRatio.toFixed(3)),
    style: {
      we: template.report.style.we,
      letMe: template.report.style.letMe,
      i: template.report.style.i,
    },
  },
}, null, 2))
console.log(`template saved: ${out} (${template.text.length} chars, turns=${template.report.effectiveToolReasoningTurns}, replayedChars=${template.report.replayedReasoningChars}, source ${template.verdict.sessionId})`)
