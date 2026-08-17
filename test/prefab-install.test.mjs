import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { zstdDecompressSync } from 'node:zlib'

test('one-command prefab install needs no workspace and ships the in-session seeder', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-prefab-mode-install-'))
  try {
    const dshHome = join(root, 'dsh-home')
    const install = spawnSync(process.execPath, [
      resolve('prefab/install.mjs'),
      '--confirm-dsh-closed',
    ], { encoding: 'utf8', env: { ...process.env, DSH_HOME: dshHome } })
    assert.equal(install.status, 0, install.stderr)
    assert.match(install.stdout, /INSTALL READY/)
    assert.match(install.stdout, /select this mode and create a new session/)

    const mode = join(dshHome, '.agent-presets', 'prefab-anchored-standard')
    assert.equal(existsSync(join(mode, 'prefab-session-seed.mjs')), true)
    assert.match(readFileSync(join(mode, 'agent.cordis.yml'), 'utf8'), /name: \.\/prefab-session-seed\.mjs/)
    assert.equal(JSON.parse(readFileSync(join(mode, 'template.jsonl.meta.json'), 'utf8')).templateKind, 'generic')
    assert.equal(existsSync(join(mode, 'generic-candidate.jsonl')), false)
    assert.equal(existsSync(join(dshHome, 'storages', 'workspace.json')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('project2 template is explicit opt-in and gets its own default preset id', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-prefab-project2-install-'))
  try {
    const dshHome = join(root, 'dsh-home')
    const install = spawnSync(process.execPath, [
      resolve('prefab/install.mjs'),
      '--confirm-dsh-closed',
      '--template', 'project2',
    ], { encoding: 'utf8', env: { ...process.env, DSH_HOME: dshHome } })
    assert.equal(install.status, 0, install.stderr)
    assert.match(install.stdout, /mode: prefab-anchored-project2/)
    assert.match(install.stdout, /template: project2/)

    const mode = join(dshHome, '.agent-presets', 'prefab-anchored-project2')
    const meta = JSON.parse(readFileSync(join(mode, 'template.jsonl.meta.json'), 'utf8'))
    assert.equal(meta.templateKind, 'project2-benchmark')
    assert.match(readFileSync(join(mode, 'preset.yml'), 'utf8'), /name: Prefab Anchored Project2/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('one-command prefab install creates a mode, workspace, and ready session from scratch', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-prefab-install-'))
  try {
    const dshHome = join(root, 'dsh-home')
    const workspace = join(root, 'workspace')
    mkdirSync(workspace)
    writeFileSync(join(workspace, 'AGENTS.md'), '# Target rules\nUse this workspace only.\n')

    const install = spawnSync(process.execPath, [
      resolve('prefab/install.mjs'),
      '--cwd', workspace,
      '--confirm-dsh-closed',
    ], { encoding: 'utf8', env: { ...process.env, DSH_HOME: dshHome } })
    assert.equal(install.status, 0, install.stderr)
    assert.match(install.stdout, /INSTALL READY/)

    const mode = join(dshHome, '.agent-presets', 'prefab-anchored-standard')
    assert.equal(existsSync(join(mode, 'agent.cordis.yml')), true)
    assert.equal(existsSync(join(mode, 'template.jsonl')), true)
    assert.equal(existsSync(join(mode, 'instantiate.mjs')), true)

    const registryPath = join(dshHome, 'storages', 'workspace.json')
    const firstRegistry = JSON.parse(readFileSync(registryPath, 'utf8'))
    assert.deepEqual(firstRegistry.unit, { name: 'workspace', version: 2 })
    const firstWorkspace = Object.values(firstRegistry.tables.workspaces)[0]
    assert.equal(firstWorkspace.path, realpathSync.native(workspace))
    assert.equal(firstWorkspace.sessionIds.length, 1)
    const firstSessionId = firstWorkspace.sessionIds[0]

    const groups = readdirSync(join(dshHome, 'sessions'))
    assert.equal(groups.length, 1)
    const firstLog = join(dshHome, 'sessions', groups[0], firstSessionId, 'session.jsonl.zstd')
    const header = JSON.parse(zstdDecompressSync(readFileSync(firstLog)).toString('utf8').split('\n')[0])
    assert.equal(header.id, firstSessionId)
    assert.equal(header.cwd, realpathSync.native(workspace))
    assert.equal(header.agentPreset, 'prefab-anchored-standard')

    const instantiate = spawnSync(process.execPath, [
      join(mode, 'instantiate.mjs'),
      '--cwd', workspace,
    ], { encoding: 'utf8', env: { ...process.env, DSH_HOME: dshHome } })
    assert.equal(instantiate.status, 0, instantiate.stderr)

    const secondRegistry = JSON.parse(readFileSync(registryPath, 'utf8'))
    const secondWorkspace = Object.values(secondRegistry.tables.workspaces)[0]
    assert.equal(secondWorkspace.sessionIds.length, 2)
    assert.notEqual(secondWorkspace.sessionIds[0], firstSessionId)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
