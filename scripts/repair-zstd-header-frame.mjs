#!/usr/bin/env node
/**
 * 修复「第一帧不是单独一行 session header」的 DSH 会话日志。
 *
 * 官方 workspace 启动时 listArtifacts() 只读第一帧,要求明文恰好是
 * header + 一个换行。有人把整份 JSONL 解压后再压成单帧写回时,会抛
 *   corrupt Zstandard session log: first frame is not exactly one header line
 * 整棵插件树加载失败。这不是 Dizzy-DSH 插件运行时的逻辑错误。
 *
 * 现成 dsh-session-health 只诊断不改文件;本脚本只修「首帧多行」这一类。
 * 空文件 / 撕坏首帧官方 list() 会跳过,本脚本同样跳过,除非旁边有可用 .bak。
 *
 * 默认 dry-run。真正写盘必须加 --apply。写盘前先备份,失败则从备份拷回。
 *
 * 用法:
 *   node scripts/repair-zstd-header-frame.mjs
 *   node scripts/repair-zstd-header-frame.mjs --apply
 *   node scripts/repair-zstd-header-frame.mjs --root <sessionsDir> --apply
 *   node scripts/repair-zstd-header-frame.mjs --self-test
 */
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = 0xFD2FB528
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
const SESSION_NAME = 'session.jsonl.zstd'

function parseArgs(argv) {
  const out = {
    apply: false,
    selfTest: false,
    root: join(homedir(), '.dsh', 'sessions'),
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--apply') {
      out.apply = true
    } else if (arg === '--self-test') {
      out.selfTest = true
    } else if (arg === '--root') {
      const value = argv[i + 1]
      if (value === undefined) throw new Error('--root 需要目录路径')
      out.root = value
      i += 1
    } else {
      throw new Error(`未知参数: ${arg}`)
    }
  }
  return out
}

/** 复刻官方 scanZstdFrames:按 block 切完整帧,不依赖 Frame_Content_Size。 */
function scanZstdFrames(buffer, maxFrames = Number.POSITIVE_INFINITY) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) {
      throw new Error(`corrupt Zstandard session log: reserved frame-header bit at byte ${offset - 1}`)
    }
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : (1 << contentSizeFlag)
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error(`corrupt Zstandard session log: reserved block type at byte ${offset - 3}`)
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
    if (frames.length === maxFrames) return { frames }
  }
  return { frames }
}

function decodeAllFrames(buffer) {
  const { frames } = scanZstdFrames(buffer)
  const parts = frames.map((frame) => zstdDecompressSync(buffer.subarray(frame.start, frame.end)))
  return { frames, text: Buffer.concat(parts).toString('utf8') }
}

/** 与官方 assertZstdHeaderFrame 同一条件:明文必须恰好一行。 */
function isExactHeaderFrame(plaintext) {
  return plaintext.length > 0 && plaintext.indexOf(0x0A) === plaintext.length - 1
}

function parseSessionHeader(line) {
  const obj = JSON.parse(line)
  if (obj === null || typeof obj !== 'object' || obj.type !== 'session' || typeof obj.id !== 'string' || obj.id === '') {
    throw new Error('第一行不是 session header')
  }
  return obj
}

/**
 * 只解第一帧,对齐官方 list() 的代价。健康文件不再全量解压。
 * 扫描器结构错误转成 reason,交给上层按文件隔离。
 */
function inspectFirstFrame(buffer) {
  if (buffer.length === 0) return { ok: false, reason: 'empty' }
  let frames
  try {
    frames = scanZstdFrames(buffer, 1).frames
  } catch (error) {
    return { ok: false, reason: 'zstd-structure', error: String(error) }
  }
  if (frames.length === 0) return { ok: false, reason: 'no-complete-first-frame' }
  let firstPlain
  try {
    firstPlain = zstdDecompressSync(buffer.subarray(frames[0].start, frames[0].end))
  } catch (error) {
    return { ok: false, reason: 'header-frame-decompress-failed', error: String(error) }
  }
  if (!isExactHeaderFrame(firstPlain)) {
    return { ok: false, reason: 'first-frame-not-one-header-line' }
  }
  try {
    parseSessionHeader(firstPlain.subarray(0, -1).toString('utf8'))
  } catch (error) {
    return { ok: false, reason: 'invalid-session-header', error: String(error) }
  }
  return { ok: true, reason: 'ok' }
}

/** 把整份 JSONL 拆成 header 帧 + 事件帧,只为让 list() 的第一帧合法。 */
function reframeHeaderAndBody(text) {
  const nl = text.indexOf('\n')
  if (nl === -1) throw new Error('日志没有换行,无法拆出 header')
  const header = text.slice(0, nl + 1)
  parseSessionHeader(header.slice(0, -1))
  let body = text.slice(nl + 1)
  if (body.length > 0 && !body.endsWith('\n')) body += '\n'
  const parts = [zstdCompressSync(header, CHECKSUM_OPTIONS)]
  if (body.length > 0) parts.push(zstdCompressSync(body, CHECKSUM_OPTIONS))
  return Buffer.concat(parts)
}

function isRealDir(path) {
  try {
    const info = lstatSync(path)
    return info.isDirectory() && !info.isSymbolicLink()
  } catch {
    return false
  }
}

function isRealFile(path) {
  try {
    const info = lstatSync(path)
    return info.isFile() && !info.isSymbolicLink()
  } catch {
    return false
  }
}

/** 官方布局只有 project/session 两级,不跟目录链接,避免扫飞。 */
function walkSessionLogs(root) {
  const found = []
  if (!isRealDir(root)) return found
  for (const project of readdirSync(root, { withFileTypes: true })) {
    const projectPath = join(root, project.name)
    if (project.isSymbolicLink() || !isRealDir(projectPath)) continue
    for (const session of readdirSync(projectPath, { withFileTypes: true })) {
      const sessionPath = join(projectPath, session.name)
      if (session.isSymbolicLink() || !isRealDir(sessionPath)) continue
      const path = join(sessionPath, SESSION_NAME)
      if (isRealFile(path)) found.push(path)
    }
  }
  return found
}

function assertInsideRoot(root, path) {
  const rootAbs = resolve(root) + sep
  const pathAbs = resolve(path)
  if (pathAbs !== resolve(root) && !pathAbs.startsWith(rootAbs)) {
    throw new Error(`拒绝处理根目录之外的路径: ${path}`)
  }
}

function readValidBak(path) {
  const bak = `${path}.bak`
  if (!isRealFile(bak)) return undefined
  try {
    const bytes = readFileSync(bak)
    if (!inspectFirstFrame(bytes).ok) return undefined
    return bytes
  } catch {
    return undefined
  }
}

function siblingPlaintext(path) {
  return isRealFile(join(dirname(path), 'session.jsonl'))
}

function planRepair(path) {
  const buffer = readFileSync(path)
  const first = inspectFirstFrame(buffer)
  const warnings = []
  if (siblingPlaintext(path)) {
    warnings.push('same-dir-session.jsonl')
  }
  if (first.ok) {
    return { path, action: 'skip', reason: first.reason, warnings }
  }
  const bakBytes = readValidBak(path)
  if (first.reason === 'first-frame-not-one-header-line') {
    const currentText = decodeAllFrames(buffer).text
    if (bakBytes !== undefined && decodeAllFrames(bakBytes).text === currentText) {
      return { path, action: 'restore-bak', reason: first.reason, warnings, next: bakBytes }
    }
    return { path, action: 'reframe', reason: first.reason, warnings, next: reframeHeaderAndBody(currentText) }
  }
  // 空/撕坏:官方 list() 会跳过。只有旁边有可用 bak 才还原,绝不对空内容硬拆。
  if (bakBytes !== undefined && (first.reason === 'empty' || first.reason === 'no-complete-first-frame')) {
    return { path, action: 'restore-bak', reason: first.reason, warnings, next: bakBytes }
  }
  return { path, action: 'leave', reason: first.reason, error: first.error, warnings }
}

function applyRepair(plan) {
  if (plan.next === undefined) return undefined
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '')
  const backup = `${plan.path}.singleframe-${stamp}`
  copyFileSync(plan.path, backup)
  try {
    writeFileSync(plan.path, plan.next)
    const after = inspectFirstFrame(readFileSync(plan.path))
    if (!after.ok) throw new Error(`写回后仍未通过 header 校验: ${plan.path}`)
  } catch (error) {
    try {
      copyFileSync(backup, plan.path)
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], `写回失败且回滚失败: ${plan.path}`)
    }
    throw error
  }
  return { backup }
}

function writeFileTree(path, bytes) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
}

function runSelfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-zstd-header-'))
  const failures = []
  const check = (name, cond) => {
    if (!cond) failures.push(name)
  }
  try {
    const header = `${JSON.stringify({
      type: 'session',
      version: 0,
      id: 'session-self-test',
      createdAt: 1,
      cwd: dir,
    })}\n`
    const events = `${[
      JSON.stringify({ type: 'permission/preset', seq: 0, time: 1, data: { preset: 'danger-full-access' } }),
      JSON.stringify({ type: 'session/end-seed', seq: 1, time: 2, data: {} }),
    ].join('\n')}\n`
    const plaintext = header + events
    const good = Buffer.concat([
      zstdCompressSync(header, CHECKSUM_OPTIONS),
      zstdCompressSync(events, CHECKSUM_OPTIONS),
    ])
    const bad = zstdCompressSync(plaintext, CHECKSUM_OPTIONS)
    const goodPath = join(dir, 'good', 'session-self-test', SESSION_NAME)
    const badPath = join(dir, 'bad', 'session-self-test', SESSION_NAME)
    const lonePath = join(dir, 'lone', 'session-self-test', SESSION_NAME)
    const emptyPath = join(dir, 'empty', 'session-self-test', SESSION_NAME)
    const tornPath = join(dir, 'torn', 'session-self-test', SESSION_NAME)
    const junkBakPath = join(dir, 'junkbak', 'session-self-test', SESSION_NAME)
    const emptyBakPath = join(dir, 'emptybak', 'session-self-test', SESSION_NAME)
    writeFileTree(goodPath, good)
    writeFileTree(badPath, bad)
    writeFileSync(`${badPath}.bak`, good)
    writeFileTree(lonePath, bad)
    writeFileTree(emptyPath, Buffer.alloc(0))
    writeFileTree(tornPath, Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))
    writeFileTree(junkBakPath, bad)
    writeFileSync(`${junkBakPath}.bak`, Buffer.from('junk'))
    writeFileTree(emptyBakPath, Buffer.alloc(0))
    writeFileSync(`${emptyBakPath}.bak`, good)

    check('good-skip', planRepair(goodPath).action === 'skip')
    check('bad-restore-bak', planRepair(badPath).action === 'restore-bak')
    check('bad-reframe', planRepair(lonePath).action === 'reframe')
    check('empty-leave', planRepair(emptyPath).action === 'leave')
    check('torn-leave', planRepair(tornPath).action === 'leave')
    check('junk-bak-reframe', planRepair(junkBakPath).action === 'reframe')
    check('empty-plus-bak', planRepair(emptyBakPath).action === 'restore-bak')

    const applied = applyRepair(planRepair(lonePath))
    const after = inspectFirstFrame(readFileSync(lonePath))
    const afterText = decodeAllFrames(readFileSync(lonePath)).text
    check('reframe-ok', after.ok === true)
    check('reframe-preserves-text', afterText === plaintext)
    check('reframe-backup', applied !== undefined && statSync(applied.backup).isFile())
    check('already-fixed', planRepair(lonePath).action === 'skip')

    // 扫描隔离:空文件不得让整棵树中止
    const scan = walkSessionLogs(dir).map((path) => {
      try {
        return planRepair(path)
      } catch (error) {
        return { path, action: 'error', error: String(error) }
      }
    })
    check('scan-isolated', scan.every((item) => item.action !== 'error') && scan.length >= 6)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  if (failures.length > 0) {
    console.error(JSON.stringify({ ok: false, failures }, null, 2))
    process.exit(1)
  }
  console.log(JSON.stringify({ ok: true, selfTest: true }, null, 2))
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.selfTest) {
    runSelfTest()
    return
  }
  const root = resolve(args.root)
  const plans = []
  for (const path of walkSessionLogs(root)) {
    try {
      assertInsideRoot(root, path)
      plans.push(planRepair(path))
    } catch (error) {
      plans.push({ path, action: 'error', reason: 'exception', error: String(error), warnings: [] })
    }
  }
  const actionable = plans.filter((plan) => plan.action === 'restore-bak' || plan.action === 'reframe')
  const applied = []
  if (args.apply) {
    for (const plan of actionable) {
      try {
        const result = applyRepair(plan)
        applied.push({ path: plan.path, action: plan.action, ok: true, ...result })
      } catch (error) {
        applied.push({ path: plan.path, action: plan.action, ok: false, error: String(error) })
      }
    }
  }
  console.log(JSON.stringify({
    root,
    apply: args.apply,
    scanned: plans.length,
    skipped: plans.filter((plan) => plan.action === 'skip').length,
    left: plans.filter((plan) => plan.action === 'leave' || plan.action === 'error'),
    actionable: actionable.map((plan) => ({
      path: plan.path,
      action: plan.action,
      reason: plan.reason,
      warnings: plan.warnings,
    })),
    applied,
  }, null, 2))
}

main()
