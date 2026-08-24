#!/usr/bin/env node
/**
 * 为内置 MemoryCore / MemoryKnowledge 安装 npm 依赖（不入库）。
 * 可单独运行，也可被 sidecar 在首次 spawn 前调用。
 *
 * 只对包内 engines/ 执行 npm install，避免 settings 里的自定义目录变成任意代码执行面。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PLUGIN_ROOT = join(HERE, '..')
export const BUNDLED_GATEWAY_DIR = join(PLUGIN_ROOT, 'engines', 'MemoryCore')
export const BUNDLED_KNOWLEDGE_DIR = join(PLUGIN_ROOT, 'engines', 'MemoryKnowledge')

/** npm / sidecar 子进程允许继承的环境变量（不含 API key）。 */
const INHERIT_ENV_KEYS = [
  'PATH', 'Path', 'PATHEXT',
  'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES',
  'TZ', 'TERM', 'TMPDIR', 'TMP', 'TEMP',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'SystemRoot', 'SYSTEMROOT', 'windir', 'COMSPEC', 'ComSpec',
  'ProgramFiles', 'PROGRAMFILES', 'ProgramFiles(x86)', 'PROGRAMFILES(X86)',
  'ProgramData', 'PROGRAMDATA', 'SystemDrive', 'SYSTEMDRIVE',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'npm_config_cache', 'npm_config_prefix', 'npm_config_userconfig',
  'SSH_AUTH_SOCK', 'GIT_SSH', 'GIT_SSH_COMMAND',
]

function pickInheritedEnv() {
  const env = {}
  for (const key of INHERIT_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  const nodeDir = dirname(process.execPath)
  const pathKey = env.PATH !== undefined ? 'PATH' : (env.Path !== undefined ? 'Path' : 'PATH')
  const current = env[pathKey] ?? ''
  const parts = current.split(delimiter).filter(Boolean)
  if (!parts.includes(nodeDir)) {
    env[pathKey] = parts.length > 0 ? `${nodeDir}${delimiter}${current}` : nodeDir
  }
  if (pathKey !== 'PATH') env.PATH = env[pathKey]
  return env
}

/** sidecar spawn 用的最小环境（不含 LLM key，由调用方再注入）。 */
export function sidecarBaseEnv() {
  return pickInheritedEnv()
}

/** npm install 用的最小环境，故意丢掉 DEEPSEEK_API_KEY 等密钥。 */
export function engineInstallEnv() {
  const env = pickInheritedEnv()
  env.NODE_ENV = 'development'
  env.npm_config_fund = 'false'
  env.npm_config_audit = 'false'
  env.npm_config_update_notifier = 'false'
  env.npm_config_include = 'dev'
  return env
}

/** 跟随当前 DSH 进程的 Node，避免写死 /usr/local/node。 */
export function nodeBin() {
  return process.execPath
}

/** npm 与 node 同目录；优先 npm-cli.js，避免 Windows shell:true。 */
export function npmBin() {
  const dir = dirname(process.execPath)
  const cli = join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (existsSync(cli)) return cli
  if (process.platform === 'win32') {
    const cmd = join(dir, 'npm.cmd')
    if (existsSync(cmd)) return cmd
  }
  const candidate = join(dir, process.platform === 'win32' ? 'npm.cmd' : 'npm')
  return existsSync(candidate) ? candidate : 'npm'
}

function runNpm(args, cwd, log) {
  const bin = npmBin()
  const viaNode = bin.endsWith('npm-cli.js')
  const win = process.platform === 'win32'
  const command = viaNode
    ? process.execPath
    : (win && bin.includes(' ') ? `"${bin}"` : bin)
  const spawnArgs = viaNode ? [bin, ...args] : args
  const result = spawnSync(command, spawnArgs, {
    cwd,
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
    env: engineInstallEnv(),
    shell: !viaNode && win,
    windowsHide: true,
  })
  if (result.error) {
    log(`npm ${args[0]} 失败: ${result.error.message}`)
    return false
  }
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || '').trim().slice(-2000)
    log(`npm ${args[0]} 退出码 ${result.status}${err ? `\n${err}` : ''}`)
    return false
  }
  return true
}

/**
 * 空字符串 / 空白 = 用内置引擎。
 * 相对路径相对插件根目录解析（不是 process.cwd()）。
 */
export function resolveEngineDir(configured, bundled) {
  const raw = typeof configured === 'string' ? configured.trim() : ''
  if (raw === '') return bundled
  return isAbsolute(raw) ? resolve(raw) : resolve(PLUGIN_ROOT, raw)
}

function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

/** cwd 必须就是 bundled 根目录本身，不含子目录；bundled 根是 symlink 则拒绝。 */
export function isBundledEngineDir(cwd, bundled) {
  const cwdAbs = resolve(cwd)
  const bundledAbs = resolve(bundled)
  if (cwdAbs !== bundledAbs) return false
  if (isSymlink(bundledAbs) || isSymlink(cwdAbs)) return false
  const rel = relative(resolve(PLUGIN_ROOT, 'engines'), bundledAbs)
  return rel === 'MemoryCore' || rel === 'MemoryKnowledge'
}

export function isBundledSidecarDir(cwd) {
  return isBundledEngineDir(cwd, BUNDLED_GATEWAY_DIR)
    || isBundledEngineDir(cwd, BUNDLED_KNOWLEDGE_DIR)
}

/** 依赖是否可用来 `node --import tsx`。Knowledge 启动还要 better-sqlite3。 */
export function engineLooksReady(cwd) {
  if (!existsSync(join(cwd, 'package.json'))) return false
  if (!existsSync(join(cwd, 'node_modules', 'tsx', 'package.json'))) return false
  if (existsSync(join(cwd, 'src', 'db', 'client.ts'))
    && !existsSync(join(cwd, 'node_modules', 'better-sqlite3', 'package.json'))) {
    return false
  }
  return true
}

/**
 * 若 tsx 缺失则 npm install。
 * 默认只对内置 engines 根目录执行 install；--ignore-scripts 跳过上游 OpenClaw bash postinstall。
 * @returns {boolean} 依赖是否可用
 */
export function ensureEngineDeps(cwd, { log = () => {}, allowInstall } = {}) {
  if (!existsSync(join(cwd, 'package.json'))) {
    log(`引擎目录缺少 package.json: ${cwd}`)
    return false
  }
  if (engineLooksReady(cwd)) return true
  const canInstall = allowInstall ?? isBundledSidecarDir(cwd)
  if (!canInstall) {
    log(`自定义引擎目录未安装依赖，且插件不会对其执行 npm install: ${cwd}`)
    return false
  }
  log(`首次安装引擎依赖: ${cwd}`)
  if (!runNpm(['install', '--no-fund', '--no-audit', '--include=dev', '--ignore-scripts'], cwd, log)) {
    return false
  }
  const natives = ['better-sqlite3', 'sqlite-vec', '@node-rs/jieba']
    .filter((name) => existsSync(join(cwd, 'node_modules', name)))
  if (natives.length > 0) {
    log(`重建原生模块: ${natives.join(', ')}`)
    if (!runNpm(['rebuild', ...natives], cwd, log)) return false
  }
  return engineLooksReady(cwd)
}

function isMain() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return fileURLToPath(import.meta.url) === resolve(entry)
  } catch {
    return false
  }
}

if (isMain()) {
  const log = (msg) => console.warn(`[ensure-engine-deps] ${msg}`)
  let ok = true
  for (const dir of [BUNDLED_GATEWAY_DIR, BUNDLED_KNOWLEDGE_DIR]) {
    if (!ensureEngineDeps(dir, { log })) ok = false
  }
  process.exit(ok ? 0 : 1)
}
