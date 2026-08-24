import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BUNDLED_GATEWAY_DIR,
  BUNDLED_KNOWLEDGE_DIR,
  PLUGIN_ROOT,
  engineInstallEnv,
  engineLooksReady,
  ensureEngineDeps,
  isBundledEngineDir,
  isBundledSidecarDir,
  resolveEngineDir,
} from '../scripts/ensure-engine-deps.mjs'

assert.equal(existsSync(join(BUNDLED_GATEWAY_DIR, 'src/gateway/server.ts')), true)
assert.equal(existsSync(join(BUNDLED_GATEWAY_DIR, 'tdai-gateway.standalone.yaml')), true)
assert.equal(existsSync(join(BUNDLED_KNOWLEDGE_DIR, 'src/server.ts')), true)
assert.equal(resolveEngineDir('', BUNDLED_GATEWAY_DIR), BUNDLED_GATEWAY_DIR)
assert.equal(resolveEngineDir('  ', BUNDLED_KNOWLEDGE_DIR), BUNDLED_KNOWLEDGE_DIR)
assert.equal(resolveEngineDir('engines/MemoryCore', BUNDLED_GATEWAY_DIR), BUNDLED_GATEWAY_DIR)
assert.equal(isBundledEngineDir(BUNDLED_GATEWAY_DIR, BUNDLED_GATEWAY_DIR), true)
assert.equal(isBundledEngineDir(join(BUNDLED_GATEWAY_DIR, 'src'), BUNDLED_GATEWAY_DIR), false)
assert.equal(isBundledEngineDir(join(BUNDLED_GATEWAY_DIR, '..'), BUNDLED_GATEWAY_DIR), false)
assert.equal(isBundledSidecarDir(BUNDLED_KNOWLEDGE_DIR), true)
assert.equal(isBundledSidecarDir(PLUGIN_ROOT), false)
assert.equal(isBundledSidecarDir(join(tmpdir(), 'not-an-engine')), false)

{
  const dir = mkdtempSync(join(tmpdir(), 'tdai-eng-'))
  try {
    writeFileSync(join(dir, 'package.json'), '{"name":"x","version":"0.0.0"}\n')
    assert.equal(engineLooksReady(dir), false)
    assert.equal(ensureEngineDeps(dir, { log: () => {}, allowInstall: false }), false)
    assert.equal(isBundledSidecarDir(dir), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

{
  const prevKey = process.env.DEEPSEEK_API_KEY
  const prevNode = process.env.NODE_OPTIONS
  process.env.DEEPSEEK_API_KEY = 'should-not-leak'
  process.env.NODE_OPTIONS = '--require ./evil.js'
  try {
    const env = engineInstallEnv()
    assert.equal(env.DEEPSEEK_API_KEY, undefined)
    assert.equal(env.NODE_OPTIONS, undefined)
    assert.equal(env.npm_config_include, 'dev')
    assert.ok(env.PATH || env.Path)
  } finally {
    if (prevKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = prevKey
    if (prevNode === undefined) delete process.env.NODE_OPTIONS
    else process.env.NODE_OPTIONS = prevNode
  }
}

console.log('ok: bundled MemoryCore + MemoryKnowledge entries')
