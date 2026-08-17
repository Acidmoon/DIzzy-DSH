import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

function toolResult(text) {
  return {
    type: 'tool/result',
    data: {
      message: {
        content: [{ content: [{ type: 'text', text }] }],
      },
    },
  }
}

test('prefab instantiation identifies AGENTS.md by its read call, not text length', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-prefab-'))
  try {
    const templatePath = join(dir, 'template.jsonl')
    const targetAgentsPath = join(dir, 'TARGET_AGENTS.md')
    const longReadme = `# README\n${'documentation\n'.repeat(600)}`
    const sourceAgents = '# AGENTS.md\nOriginal workspace rules.\n'
    const targetAgents = '# AGENTS.md\nTarget workspace rules.\n'
    const events = [
      { type: 'session', version: 0, id: 'session-source', cwd: 'C:/source' },
      { type: 'tool/call', data: { name: 'read', arguments: JSON.stringify({ path: 'C:/source/README.md' }) } },
      toolResult(longReadme),
      { type: 'tool/call', data: { name: 'read', arguments: JSON.stringify({ path: 'C:/source/AGENTS.md' }) } },
      toolResult('Error: temporary read failure'),
      { type: 'tool/call', data: { name: 'read', arguments: JSON.stringify({ path: 'C:/source/AGENTS.md' }) } },
      toolResult(sourceAgents),
    ]
    writeFileSync(templatePath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`)
    writeFileSync(targetAgentsPath, targetAgents)

    const result = spawnSync(process.execPath, [
      resolve('prefab/instantiate.mjs'),
      '--template', templatePath,
      '--cwd', dir,
      '--agents-md', targetAgentsPath,
      '--dry-run',
    ], { encoding: 'utf8' })

    assert.equal(result.status, 0, result.stderr)
    const summary = JSON.parse(result.stdout)
    assert.equal(summary.templateAgentsChars, sourceAgents.length)
    assert.equal(summary.agentsRewrites, 1)
    assert.equal(summary.targetPreset, 'prefab-anchored-standard')
    assert.equal(summary.targetTitle, 'Prefab Anchored Standard - Ready')
    assert.equal(summary.titleRewrites, 0)
    assert.equal(summary.cwdRewrites, 4)
    assert.equal(summary.remainingSourceCwdMatches, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('prefab instantiation rewrites cwd variants in calls and results', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-prefab-paths-'))
  try {
    const templatePath = join(dir, 'template.jsonl')
    const events = [
      { type: 'session', version: 0, id: 'session-source', cwd: 'C:/Source/Workspace', agentPreset: 'anchored-standard' },
      { type: 'tool/call', data: { name: 'read', arguments: JSON.stringify({ path: 'c:\\source\\workspace\\README.md' }) } },
      toolResult('Inspected C:/SOURCE/WORKSPACE/README.md'),
      { type: 'tool/call', data: { name: 'read', arguments: JSON.stringify({ path: 'C:/Source/Workspace/AGENTS.md' }) } },
      toolResult('# AGENTS.md\nSource-only rules.\n'),
    ]
    writeFileSync(templatePath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`)

    const result = spawnSync(process.execPath, [
      resolve('prefab/instantiate.mjs'),
      '--template', templatePath,
      '--cwd', dir,
      '--preset', 'custom-prefab',
      '--dry-run',
    ], { encoding: 'utf8' })

    assert.equal(result.status, 0, result.stderr)
    const summary = JSON.parse(result.stdout)
    assert.equal(summary.targetPreset, 'custom-prefab')
    assert.equal(summary.targetTitle, 'Prefab Anchored Standard - Ready')
    assert.equal(summary.cwdRewrites, 4)
    assert.equal(summary.remainingSourceCwdMatches, 0)
    assert.equal(summary.agentsRewrites, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('prefab instantiation expands the durable work-tool unlock by default', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-prefab-tools-'))
  try {
    const templatePath = join(dir, 'template.jsonl')
    const events = [
      { type: 'session', version: 0, id: 'session-source', cwd: 'C:/source' },
      { type: 'assistant/message', data: { message: { content: [{ type: 'tool-call', id: 'unlock', name: 'dev_tool_search', arguments: '{"query":"web","toolNames":["web_search","todo_write"]}' }] } } },
      { type: 'tool/call', data: { callId: 'unlock', name: 'dev_tool_search', arguments: '{"query":"web","toolNames":["web_search","todo_write"]}' } },
      toolResult('Unlocked for the next request: web_search, todo_write\nMatching tools (1):'),
      { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'Tool errors: retry.' }, { type: 'tool-call', id: 'bad-read', name: 'str_replace_editor', arguments: '{"command":"view","path":"C:/source/AGENTS.md","view_range":null}' }] } } },
      { type: 'tool/call', data: { callId: 'bad-read', name: 'str_replace_editor', arguments: '{"command":"view","path":"C:/source/AGENTS.md","view_range":null}' } },
      { type: 'tool/result', data: { message: { source: { callId: 'bad-read' }, content: [{ type: 'tool-result', toolCallId: 'bad-read', content: [{ type: 'text', text: 'Error: invalid arguments' }], isError: true }] } } },
    ]
    writeFileSync(templatePath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`)

    const result = spawnSync(process.execPath, [
      resolve('prefab/instantiate.mjs'),
      '--template', templatePath,
      '--cwd', dir,
      '--dry-run',
    ], { encoding: 'utf8' })

    assert.equal(result.status, 0, result.stderr)
    const summary = JSON.parse(result.stdout)
    assert.equal(summary.unlockRewrites, 1)
    assert.equal(summary.unlockDrops, 0)
    assert.equal(summary.droppedFailedInstructionReads, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
