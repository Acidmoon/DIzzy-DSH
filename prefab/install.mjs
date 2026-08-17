#!/usr/bin/env node
/**
 * One-command installer for an AI agent: install this self-contained mode.
 * New sessions seed themselves when the user selects the installed preset.
 * Passing --cwd additionally creates a legacy offline Ready session.
 */

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const inline = args.find((argument) => argument.startsWith(`--${name}=`))
  if (inline !== undefined) return inline.slice(name.length + 3)
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}

const cwdArg = opt('cwd')
const templateKind = opt('template', 'generic')
const presetId = opt(
  'preset',
  templateKind === 'project2' ? 'prefab-anchored-project2' : 'prefab-anchored-standard',
)
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const confirmedClosed = args.includes('--confirm-dsh-closed')

if (!confirmedClosed || (cwdArg !== undefined && !existsSync(cwdArg))) {
  console.error('usage: node prefab/install.mjs --confirm-dsh-closed [--template generic|project2] [--preset id] [--cwd <existing-dir>] [--title text] [--allowed-tools a,b] [--rename json] [--agents-md f]')
  console.error('DeepSeek Harness must be fully closed while the preset files are installed.')
  process.exit(2)
}
if (!['generic', 'project2'].includes(templateKind)) {
  console.error(`invalid template: ${templateKind} (expected generic or project2)`)
  process.exit(2)
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(presetId)) {
  console.error(`invalid preset id: ${presetId}`)
  process.exit(2)
}

const presetsRoot = join(dshHome, '.agent-presets')
const targetMode = join(presetsRoot, presetId)
const comparable = (path) => {
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}
let installedHere = false

if (existsSync(targetMode)) {
  if (comparable(realpathSync.native(targetMode)) !== comparable(realpathSync.native(HERE))) {
    console.error(`preset already exists: ${targetMode}`)
    console.error('Refusing to overwrite it. Choose another --preset id or let an expert review the existing installation.')
    process.exit(1)
  }
} else {
  mkdirSync(presetsRoot, { recursive: true })
  const staging = join(presetsRoot, `.${presetId}.installing-${randomUUID()}`)
  try {
    cpSync(HERE, staging, {
      recursive: true,
      filter: (source) => {
        const name = basename(source)
        return name !== 'patch.generated.yml' && !name.startsWith('generic-candidate')
      },
    })
    if (templateKind === 'project2') {
      cpSync(join(staging, 'templates', 'project2-benchmark.jsonl'), join(staging, 'template.jsonl'))
      cpSync(join(staging, 'templates', 'project2-benchmark.jsonl.meta.json'), join(staging, 'template.jsonl.meta.json'))
      const presetPath = join(staging, 'preset.yml')
      writeFileSync(
        presetPath,
        readFileSync(presetPath, 'utf8')
          .replace('name: Prefab Anchored Standard', 'name: Prefab Anchored Project2')
          .replace('description: New sessions are automatically prefilled with the bundled anchored trajectory and ready for the first real task prompt.', 'description: Project2-specific reproduction mode using the bundled anchored benchmark trajectory.'),
      )
    }
    renameSync(staging, targetMode)
    installedHere = true
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

if (cwdArg !== undefined) {
  const instantiateArgs = [
    join(targetMode, 'instantiate.mjs'),
    '--cwd', realpathSync.native(cwdArg),
    '--preset', presetId,
  ]
  for (const name of ['title', 'allowed-tools', 'rename', 'agents-md']) {
    const value = opt(name)
    if (value !== undefined) instantiateArgs.push(`--${name}`, value)
  }

  const result = spawnSync(process.execPath, instantiateArgs, {
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: dshHome },
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) {
    if (installedHere) rmSync(targetMode, { recursive: true, force: true })
    console.error('installation rolled back because legacy session instantiation failed')
    process.exit(result.status ?? 1)
  }
}

console.log('INSTALL READY')
console.log(`  mode: ${presetId}`)
console.log(`  template: ${templateKind}`)
if (cwdArg !== undefined) console.log(`  legacy ready session workspace: ${realpathSync.native(cwdArg)}`)
console.log('Start DSH. In any workspace, select this mode and create a new session; it will be prefilled automatically.')
