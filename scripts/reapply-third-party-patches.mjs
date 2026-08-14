#!/usr/bin/env node
/**
 * Reapply local patches to third-party snapshots after a subtree pull.
 *
 * Patch files live in `patches/<plugin>-<description>.patch`; the patch
 * content paths are relative to the repository root (e.g.
 * `third-party/dsh-vision-toolkit/lib/exposure.js`), so `git apply` runs
 * from the repo root. A patch is skipped with a warning when the target
 * file is absent — upstream may have dropped it; the registry
 * (docs/THIRD-PARTY-PATCHES.md) then decides whether the patch is obsolete.
 *
 * Usage:
 *   node scripts/reapply-third-party-patches.mjs            # all patches
 *   node scripts/reapply-third-party-patches.mjs <plugin>   # one plugin
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PATCH_DIR = join(ROOT, 'patches')
const PATCH_RE = /^([a-z0-9-]+)-.+\.patch$/

function git(args) {
  execFileSync('git', args, { cwd: ROOT, stdio: 'pipe' })
}

/** First path line inside a patch (`--- a/<path>`), used for conflict hints. */
function patchTargets(text) {
  return [...text.matchAll(/^--- a\/(.+)$/gm)].map((m) => m[1])
}

const only = process.argv[2]
if (!existsSync(PATCH_DIR)) {
  console.log('patches/ 不存在,无补丁需要重放')
  process.exit(0)
}

const patchFiles = readdirSync(PATCH_DIR)
  .filter((name) => PATCH_RE.test(name) && name.endsWith('.patch'))
  .filter((name) => only === undefined || name.startsWith(`${only}-`))
  .sort()

if (patchFiles.length === 0) {
  console.log(only === undefined ? 'patches/ 为空,无补丁需要重放' : `没有属于 "${only}" 的补丁`)
  process.exit(0)
}

let failed = false
for (const name of patchFiles) {
  const text = readFileSync(join(PATCH_DIR, name), 'utf8')
  const targets = patchTargets(text)
  const missing = targets.filter((target) => !existsSync(join(ROOT, target)))
  if (missing.length > 0) {
    console.log(`[skip] ${name}:目标文件缺失(${missing.join(', ')})——上游可能已删除或吸收,核对 docs/THIRD-PARTY-PATCHES.md 后决定是否删除本补丁`)
    continue
  }
  try {
    git(['apply', '--check', join(PATCH_DIR, name)])
    git(['apply', join(PATCH_DIR, name)])
    console.log(`[ok]   ${name}(${targets.join(', ')})`)
  } catch (error) {
    failed = true
    console.log(`[FAIL] ${name}:应用失败,需手动适配(可能上游已重构目标文件)→ ${targets.join(', ')}`)
    console.log(`       参考 docs/THIRD-PARTY-PATCHES.md 中该补丁的登记;适配后更新补丁文件再重跑。`)
  }
}

process.exit(failed ? 1 : 0)
