/**
 * instantiate — clone the rolled prefab template into a new, registered DSH
 * session with runtime substitutions.
 *
 * The template is the model's own rolled transcript (we-style, unlock flow,
 * AGENTS.md read, skills surveyed). Cloning replaces:
 *  - the session id (header line + directory name),
 *  - the cwd everywhere it occurs in the durable transcript,
 *  - the session preset binding (defaults to prefab-anchored-standard),
 *  - unlock lists: dev_tool_search `toolNames` arguments and the matching
 *    "Unlocked for the next request: ..." tool results are filtered to the
 *    tools the CURRENT environment actually offers (--allowed-tools),
 *  - tool-name mentions: every restatement of a renamed tool inside
 *    reasoning/text/tool-result content is rewritten per --rename,
 *  - the AGENTS.md body: the tool result that carried the roll-time file is
 *    replaced with the target workspace's current file (--agents-md or
 *    <cwd>/AGENTS.md).
 *
 * Usage:
 *   node prefab/instantiate.mjs --template prefab/template.jsonl \
 *       --cwd "E:/Desktop/mytests/modeltest/workspace" \
 *       [--preset prefab-anchored-standard] \
 *       [--allowed-tools web_search,todo_write] \
 *       [--rename '{"old":"new"}'] [--agents-md <file>] [--dry-run]
 */

import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { zstdCompressSync } from 'node:zlib'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { DEFAULT_DURABLE_TOOLS, loadInstructionBundle } from './prefab-session-seed.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const SESSIONS = join(DSH_HOME, 'sessions')

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  if (hit) return hit.slice(name.length + 3)
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}
const templatePath = opt('template', join(HERE, 'template.jsonl'))
const targetCwdArg = opt('cwd')
const targetCwd = targetCwdArg === undefined || !existsSync(targetCwdArg)
  ? undefined
  : realpathSync.native(targetCwdArg)
const targetPreset = opt('preset', 'prefab-anchored-standard')
const targetTitle = opt('title', 'Prefab Anchored Standard - Ready')
const allowedTools = opt('allowed-tools') === undefined ? undefined : opt('allowed-tools').split(',').map((s) => s.trim()).filter(Boolean)
const durableTools = allowedTools ?? [...DEFAULT_DURABLE_TOOLS]
const renameMap = opt('rename') === undefined ? {} : JSON.parse(opt('rename')
  .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
  .replace(/'/g, '"'))
const dryRun = args.includes('--dry-run')
if (targetCwd === undefined || !existsSync(templatePath)) {
  console.error('usage: node prefab/instantiate.mjs --cwd <existing-dir> [--template f] [--preset id] [--title text] [--allowed-tools a,b] [--rename json] [--agents-md f] [--dry-run]')
  process.exit(2)
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(targetPreset)) {
  console.error(`invalid preset id: ${targetPreset}`)
  process.exit(2)
}
if (targetTitle.trim().length === 0) {
  console.error('session title must not be empty')
  process.exit(2)
}

const explicitAgentsMdPath = opt('agents-md')
if (explicitAgentsMdPath !== undefined && !existsSync(explicitAgentsMdPath)) {
  console.error(`AGENTS.md replacement does not exist: ${explicitAgentsMdPath}`)
  process.exit(2)
}
const agentsMd = explicitAgentsMdPath === undefined
  ? loadInstructionBundle(targetCwd, DSH_HOME)
  : readFileSync(explicitAgentsMdPath, 'utf8')

const lines = readFileSync(templatePath, 'utf8').trim().split('\n')
const rawEvents = lines.map((line) => JSON.parse(line))
if (rawEvents[0]?.type !== 'session' || typeof rawEvents[0].cwd !== 'string' || rawEvents[0].cwd.length === 0) {
  console.error('template must start with a session header containing cwd')
  process.exit(2)
}
const sourceCwd = rawEvents[0].cwd
const newId = `session-${randomUUID()}`

/** Word-boundary string replace for tool names. */
const replaceName = (text, oldName, newName) =>
  text.replace(new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), newName)

let unlockRewrites = 0
let unlockDrops = 0
let renameHits = 0
let agentsRewrites = 0
let cwdRewrites = 0
let titleRewrites = 0

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const sourceUsesWindowsPaths = /^[A-Za-z]:[\\/]/.test(sourceCwd)
const sourceBackslashes = sourceCwd.replace(/\//g, '\\')
const targetBackslashes = targetCwd.replace(/\//g, '\\')
const cwdForms = [
  [sourceCwd.replace(/\\/g, '/'), targetCwd.replace(/\\/g, '/')],
  [sourceBackslashes.replace(/\\/g, '\\\\'), targetBackslashes.replace(/\\/g, '\\\\')],
  [sourceBackslashes, targetBackslashes],
].filter(([source], index, all) => all.findIndex(([candidate]) => candidate === source) === index)

function rewriteCwd(value) {
  if (typeof value === 'string') {
    let rewritten = value
    for (const [source, target] of cwdForms) {
      rewritten = rewritten.replace(
        new RegExp(escapeRegExp(source), sourceUsesWindowsPaths ? 'gi' : 'g'),
        () => {
          cwdRewrites += 1
          return target
        },
      )
    }
    return rewritten
  }
  if (Array.isArray(value)) return value.map(rewriteCwd)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteCwd(item)]))
  }
  return value
}

/** The roll-time AGENTS.md body, captured from the template's tool results. */
let templateAgentsMd = undefined
let previousToolCall = undefined

function toolCallReadsInstructionFile(event) {
  const name = event.data?.name
  if (name !== 'bash' && name !== 'str_replace_editor' && name !== 'read') return false
  const raw = event.data?.arguments
  let text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')
  try {
    text = JSON.stringify(JSON.parse(text))
  } catch {
    // Older exports may store an unparsed shell command; search the raw text.
  }
  return /(?:^|[\\/])(?:AGENTS|CLAUDE)(?:\.local)?\.md\b/i.test(text)
}

function toolResultCallId(event) {
  return event.data?.message?.source?.callId
    ?? event.data?.message?.content?.find((block) => block?.type === 'tool-result')?.toolCallId
}

const templateCalls = new Map(rawEvents
  .filter((event) => event.type === 'tool/call')
  .map((event) => [event.data?.callId, event]))
const failedInstructionReadIds = new Set()
for (const event of rawEvents) {
  if (event.type !== 'tool/result') continue
  const callId = toolResultCallId(event)
  const call = templateCalls.get(callId)
  if (call === undefined || !toolCallReadsInstructionFile(call)) continue
  const block = event.data?.message?.content?.find((item) => item?.type === 'tool-result')
  const failed = block?.isError === true || (Array.isArray(block?.content)
    && block.content.some((part) => typeof part?.text === 'string' && /^\s*Error:/i.test(part.text)))
  if (failed) failedInstructionReadIds.add(callId)
}

const events = rawEvents.flatMap((event) => {
  if (event.type === 'tool/call' && failedInstructionReadIds.has(event.data?.callId)) return []
  if (event.type === 'tool/result' && failedInstructionReadIds.has(toolResultCallId(event))) return []
  if (event.type !== 'assistant/message' || failedInstructionReadIds.size === 0) return [event]
  const content = event.data?.message?.content?.flatMap((block) => {
    if (block?.type === 'tool-call' && failedInstructionReadIds.has(block.id)) return []
    if (block?.type !== 'reasoning') return [block]
    let text = block.text
    if (text.startsWith('Tool errors:')) {
      text = 'We should survey the available skills with narrower queries, then read AGENTS.md in full in the next step.'
    } else if (text.startsWith('We need read AGENTS full.')) {
      text = 'Now read AGENTS.md in full with the editor\'s explicit full-file range.'
    } else if (text.includes('Could also cat via bash but native tools preferred')) {
      text = text.replace(/Also read AGENTS\.md\.[\s\S]*$/, 'Then read AGENTS.md in full with the editor\'s explicit full-file range.')
    }
    return [{ ...block, text }]
  })
  return [{ ...event, data: { ...event.data, message: { ...event.data.message, content } } }]
})

const rewritten = events.map((rawEvent) => {
  let event = rewriteCwd(rawEvent)

  if (event.type === 'session') {
    return JSON.stringify({ ...event, id: newId, cwd: targetCwd, agentPreset: targetPreset })
  }

  if (event.type === 'session/title') {
    titleRewrites += 1
    return JSON.stringify({ ...event, data: { ...event.data, title: targetTitle } })
  }

  if (event.type === 'tool/call') previousToolCall = event

  if (event.type === 'tool/call' && event.data.name === 'dev_tool_search') {
    let parsed
    try { parsed = JSON.parse(event.data.arguments) } catch { return JSON.stringify(event) }
    if (Array.isArray(parsed.toolNames)) {
      const before = parsed.toolNames.length
      parsed.query = 'filesystem, search, task tracking, and user interaction tools'
      parsed.toolNames = [...durableTools]
      unlockDrops += Math.max(0, before - parsed.toolNames.length)
      unlockRewrites += 1
      event = { ...event, data: { ...event.data, arguments: JSON.stringify(parsed) } }
    }
  }

  if (event.type === 'tool/result') {
    const instructionRead = previousToolCall !== undefined && toolCallReadsInstructionFile(previousToolCall)
    previousToolCall = undefined
    const block = event.data.message?.content?.[0]
    const parts = block?.content
    if (Array.isArray(parts)) {
      let changed = false
      const newParts = parts.map((part) => {
        if (typeof part.text !== 'string') return part
        let text = part.text
        if (templateAgentsMd === undefined
          && instructionRead
          && text.trim().length > 0
          && !/^\s*(?:error|toolerror)\s*:/i.test(text)) {
          templateAgentsMd = text
        }
        if (/^Unlocked for the next request: /.test(text)) {
          text = text.replace(
            /^Unlocked for the next request: [^\r\n]*/,
            `Unlocked for the next request: ${durableTools.join(', ')}`,
          )
          changed = true
        }
        if (agentsMd !== undefined && templateAgentsMd !== undefined && text === templateAgentsMd) {
          text = agentsMd
          agentsRewrites += 1
          changed = true
        }
        for (const [oldName, newName] of Object.entries(renameMap)) {
          if (oldName !== newName && text.includes(oldName)) {
            text = replaceName(text, oldName, newName)
            renameHits += 1
            changed = true
          }
        }
        return changed ? { ...part, text } : part
      })
      if (changed) event = { ...event, data: { ...event.data, message: { ...event.data.message, content: [{ ...block, content: newParts }] } } }
    }
    return JSON.stringify(event)
  }

  if (event.type === 'assistant/message') {
    let changed = false
    const content = (event.data.message.content ?? []).map((block) => {
      if (block.type === 'tool-call' && block.name === 'dev_tool_search') {
        let parsed
        try { parsed = JSON.parse(block.arguments) } catch { return block }
        if (!Array.isArray(parsed.toolNames)) return block
        parsed.query = 'filesystem, search, task tracking, and user interaction tools'
        parsed.toolNames = [...durableTools]
        changed = true
        return { ...block, arguments: JSON.stringify(parsed) }
      }
      if (typeof block.text !== 'string') return block
      let text = block.text
      text = text.replace(
        /I unlocked `web_search` and `todo_write` via `dev_tool_search`/,
        `I unlocked ${durableTools.map((tool) => `\`${tool}\``).join(', ')} via \`dev_tool_search\``,
      )
      if (text !== block.text) changed = true
      for (const [oldName, newName] of Object.entries(renameMap)) {
        if (oldName !== newName && text.includes(oldName)) {
          text = replaceName(text, oldName, newName)
          renameHits += 1
          changed = true
        }
      }
      if (agentsMd !== undefined && templateAgentsMd !== undefined && text.includes(templateAgentsMd.slice(0, 200))) {
        text = text.replace(templateAgentsMd.slice(0, 200), agentsMd.slice(0, 200))
        agentsRewrites += 1
        changed = true
      }
      return changed ? { ...block, text } : block
    })
    if (changed) event = { ...event, data: { ...event.data, message: { ...event.data.message, content } } }
    return JSON.stringify(event)
  }

  return JSON.stringify(event)
})

// Byte-for-byte equivalent of Harness session-persistence-jsonl projectKey().
// Keeping it here lets a closed-DSH installer create a workspace's first
// session without importing the Harness source tree or requiring Python.
function projectKey(cwd) {
  let readable = ''
  let separatorRun = false
  for (let index = 0; index < cwd.length; index += 1) {
    const code = cwd.charCodeAt(index)
    const character = String.fromCharCode(code)
    if (character === '/' || character === '\\' || character === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (character !== '~' && /^[A-Za-z0-9._-]$/.test(character)) {
      readable += character
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

function atomicWriteJson(path, value) {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function registerWorkspaceSession(sessionId) {
  const storages = join(DSH_HOME, 'storages')
  const registryPath = join(storages, 'workspace.json')
  mkdirSync(storages, { recursive: true })
  const registry = existsSync(registryPath)
    ? JSON.parse(readFileSync(registryPath, 'utf8'))
    : {
        unit: { name: 'workspace', version: 2 },
        global: { initialized: true, workspaceIds: [], archivedSessionIds: [] },
        tables: { workspaces: {} },
      }

  if (registry.unit?.name !== 'workspace' || registry.unit?.version !== 2
      || !Array.isArray(registry.global?.workspaceIds)
      || registry.tables?.workspaces === undefined) {
    throw new Error(`unsupported or malformed workspace registry: ${registryPath}`)
  }
  if (registry.global.pendingMutation !== undefined) {
    throw new Error('workspace registry has a pending mutation; start and stop DSH once, then retry')
  }

  const comparable = (value) => process.platform === 'win32'
    ? String(value).toLowerCase()
    : String(value)
  let pair = Object.entries(registry.tables.workspaces)
    .find(([, workspace]) => comparable(workspace.path) === comparable(targetCwd))
  const now = new Date().toISOString()
  if (pair === undefined) {
    const workspaceId = randomUUID()
    const workspace = {
      path: targetCwd,
      title: basename(targetCwd),
      sessionIds: [],
      createdAt: now,
      updatedAt: now,
    }
    registry.tables.workspaces[workspaceId] = workspace
    registry.global.workspaceIds = [workspaceId, ...registry.global.workspaceIds]
    pair = [workspaceId, workspace]
  } else if (!registry.global.workspaceIds.includes(pair[0])) {
    throw new Error(`workspace registry order omits existing workspace '${pair[0]}'`)
  }

  const [workspaceId, workspace] = pair
  if (!Array.isArray(workspace.sessionIds)) {
    throw new Error(`workspace '${workspaceId}' has malformed sessionIds`)
  }
  workspace.sessionIds = [sessionId, ...workspace.sessionIds.filter((id) => id !== sessionId)]
  workspace.updatedAt = now
  registry.global.initialized = true
  registry.global.archivedSessionIds ??= []
  atomicWriteJson(registryPath, registry)
  return { registryPath, workspaceId }
}

const header = rewritten[0]
const rest = rewritten.slice(1)
const zstd = Buffer.concat([zstdCompressSync(Buffer.from(header + '\n')), zstdCompressSync(Buffer.from(rest.join('\n') + '\n'))])
const rewrittenText = rewritten.join('\n')
const normalizeCwd = (value) => {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
  return sourceUsesWindowsPaths ? normalized.toLowerCase() : normalized
}
const remainingSourceCwdMatches = normalizeCwd(sourceCwd) === normalizeCwd(targetCwd)
  ? 'n/a (source and target cwd are equivalent)'
  : cwdForms.reduce((total, [source]) => {
      const matches = rewrittenText.match(new RegExp(escapeRegExp(source), sourceUsesWindowsPaths ? 'gi' : 'g'))
      return total + (matches?.length ?? 0)
    }, 0)

if (dryRun) {
  console.log(JSON.stringify({ newId, sourceCwd, targetCwd, targetPreset, targetTitle, titleRewrites, cwdRewrites, remainingSourceCwdMatches, unlockRewrites, unlockDrops, droppedFailedInstructionReads: failedInstructionReadIds.size, renameHits, agentsRewrites: agentsRewrites || (agentsMd !== undefined ? 0 : 'n/a'), lines: rewritten.length, templateAgentsChars: templateAgentsMd?.length ?? 0 }, null, 2))
  process.exit(0)
}

const installedComposition = join(DSH_HOME, '.agent-presets', targetPreset, 'agent.cordis.yml')
if (!existsSync(installedComposition)) {
  console.error(`preset '${targetPreset}' is not installed under ${join(DSH_HOME, '.agent-presets')}`)
  process.exit(1)
}
const group = projectKey(targetCwd)
const targetDir = join(SESSIONS, group, newId)
mkdirSync(targetDir, { recursive: true })
writeFileSync(join(targetDir, 'session.jsonl.zstd'), zstd)
let registration
try {
  registration = registerWorkspaceSession(newId)
} catch (error) {
  rmSync(targetDir, { recursive: true, force: true })
  throw error
}

console.log(`instantiated: ${newId}`)
console.log(`  group: ${group}`)
console.log(`  workspace: ${registration.workspaceId}`)
console.log(`  preset: ${targetPreset}`)
console.log(`  title: ${targetTitle}`)
console.log(`  substitutions: cwd=${cwdRewrites}, title=${titleRewrites}, unlock rewrites=${unlockRewrites} drops=${unlockDrops}, rename hits=${renameHits}, agents.md rewrites=${agentsRewrites}`)
console.log('READY: start DSH, open the workspace, and select the Ready session at the top.')
