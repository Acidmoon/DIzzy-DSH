#!/usr/bin/env node
/**
 * dsh-genui 视觉 E2E（无需模型 key）：真实 dsh web + link 安装当前插件 →
 * 通过 DOM 通道注入组件画廊围栏 → 真实浏览器渲染 → 截图 + 交互验证。
 * 与 e2e.mjs 互补：e2e.mjs 验证「模型 → fence → action 闭环」的完整链路
 * （需要 DEEPSEEK_API_KEY）；本脚本只验证渲染层（CSS、组件、本地交互），
 * 不需要任何额度，适合每次样式/组件改动后的快速视觉回归。
 *
 * 用法：
 *   npx tsx scripts/e2e-visual.mts [--port 3098] [--keep] [--out <dir>]
 *
 * 产物（默认 .e2e-artifacts/）：
 *   gallery.png       画廊全页渲染
 *   interactions.png   排序/判题等本地交互后的状态
 *   web.log            scratch 实例日志
 * 退出码 0 = PASS，1 = FAIL。
 */
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createServer } from 'node:net'

import { gallerySpec } from '../src/client/gallery.ts'

// tsx 运行下 import.meta.url 不可靠（曾指向 node 二进制），用 argv[1] 定位：
// 脚本约定在 <repo>/scripts/e2e-visual.mts，仓库根 = 上一级。
const SCRIPT_PATH = resolve(process.argv[1] ?? '')
const REPO_ROOT = dirname(SCRIPT_PATH).endsWith('scripts')
  ? resolve(dirname(SCRIPT_PATH), '..')
  : resolve(process.cwd())
// 宿主二进制默认用本机 npm 生产模式 dsh；可用 DSH_BIN 覆盖。
const DSH_BIN = process.env.DSH_BIN ?? resolve(homedir(), 'node_modules/.bin/dsh')
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const PORT = Number(arg('--port') ?? 3098)
const KEEP = process.argv.includes('--keep')
const OUT_DIR = resolve(arg('--out') ?? join(REPO_ROOT, '.e2e-artifacts'))

const fail = (msg: string): never => { console.error(`✗ ${msg}`); process.exit(1) }
const log = (msg: string): void => console.log(`· ${msg}`)

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) fail(`非法端口: ${PORT}`)
await new Promise(res => {
  const probe = createServer()
  probe.once('error', () => fail(`端口 ${PORT} 已被占用，请用 --port 换一个`))
  probe.listen(PORT, '127.0.0.1', () => probe.close(res))
})

// playwright-core 解析顺序：显式 PLAYWRIGHT_PATH → agent-browser 全局依赖 →
// 本仓库 node_modules。chromium 走系统 Chrome（channel: 'chrome'）。
async function loadPlaywright(): Promise<{ chromium: any }> {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    join(homedir(), '.nvm/versions/node', `v${process.versions.node}`, 'lib/node_modules/agent-browser/node_modules/playwright-core/index.mjs'),
    join(REPO_ROOT, 'node_modules/playwright-core/index.mjs'),
    join(REPO_ROOT, 'node_modules/playwright/index.mjs'),
  ].filter((p): p is string => p !== undefined)
  for (const p of candidates) {
    try {
      return await import(p)
    } catch (e) {
      console.error(`· playwright 候选失败 ${p} → ${(e as Error).message}`)
    }
  }
  throw new Error('未找到 playwright-core（可设 PLAYWRIGHT_PATH 指定 index.mjs）')
}

const DSH_HOME = await mkdtemp(join(tmpdir(), 'dsh-visual-'))
const env = { ...process.env, DSH_HOME }
const webLog = join(DSH_HOME, 'web.log')
let webChild: ReturnType<typeof spawn> | null = null
// playwright Browser 实例：失败路径也要 close，避免浏览器子进程孤儿。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let browser: any = null

const killWeb = (): void => {
  if (webChild === null) return
  try { process.kill(-webChild.pid!, 'SIGTERM') } catch { /* gone */ }
  try { process.kill(webChild.pid!, 'SIGTERM') } catch { /* gone */ }
  webChild = null
}
const cleanup = async (): Promise<void> => {
  killWeb()
  if (!KEEP) await rm(DSH_HOME, { recursive: true, force: true })
  else log(`保留临时环境: ${DSH_HOME}`)
}

try {
  await mkdir(OUT_DIR, { recursive: true })

  // ── 安装插件（link 当前工作区 = 测的就是当前代码）───────────────────────
  log('安装插件（link 当前工作区）...')
  const add = spawnSync(DSH_BIN, ['plugin', '--profile', 'web', 'add', `link:${REPO_ROOT}`], { env, stdio: 'inherit' })
  if (add.status !== 0) throw new Error('link 安装失败（见上方输出）')

  // ── 启动 dsh web ─────────────────────────────────────────────────────────
  log(`启动 dsh web (port ${PORT})...`)
  const logStream = createWriteStream(webLog, { flags: 'a' })
  webChild = spawn(DSH_BIN, ['web', '--port', String(PORT)], {
    env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  webChild.stdout!.pipe(logStream)
  webChild.stderr!.pipe(logStream)
  const BASE = `http://127.0.0.1:${PORT}`
  let ready = false
  for (let i = 0; i < 120; i++) {
    if (webChild.exitCode !== null) break
    try { const res = await fetch(BASE); if (res.ok) { ready = true; break } } catch { /* booting */ }
    await new Promise(r => setTimeout(r, 1000))
  }
  if (!ready) {
    const tail = (await import('node:fs/promises')).readFile(webLog, 'utf8').catch(() => '')
    console.error(tail.split('\n').slice(-30).join('\n'))
    throw new Error(`dsh web 120s 内未就绪（日志: ${webLog}）`)
  }
  log('dsh web 就绪')

  const clientRes = await fetch(`${BASE}/plugins/@omdsh-dev/dsh-genui/client.js`)
  if (!clientRes.ok) throw new Error(`client.js 返回 ${clientRes.status}`)
  log(`✓ client.js ${clientRes.status}`)

  // ── 浏览器渲染 ───────────────────────────────────────────────────────────
  const { chromium } = await loadPlaywright()
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 3000 } })
  const pageErrors: string[] = []
  page.on('pageerror', e => pageErrors.push(String(e)))
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(5000)

  // 注入画廊围栏：真实 dsh-ui fence 表面（叶子语言标签 + 单一 <pre> 代码体），
  // DOM 通道应当发现它并以插件自己的 React root 挂载真实组件。
  await page.evaluate((specJson: string) => {
    const host = document.createElement('div')
    host.className = 'md-code-block'
    host.setAttribute('data-visual-inject', '1')
    const label = document.createElement('div')
    label.textContent = 'dsh-ui'
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = specJson
    pre.appendChild(code)
    host.append(label, pre)
    const mount = document.querySelector('[data-chat-flow]') ?? document.body
    mount.appendChild(host)
  }, JSON.stringify(gallerySpec))

  let blocks = 0
  for (let i = 0; i < 30; i++) {
    blocks = await page.evaluate(() => document.querySelectorAll('[data-genui]').length)
    if (blocks > 0) break
    await new Promise(r => setTimeout(r, 1000))
  }
  if (blocks === 0) {
    await page.screenshot({ path: join(OUT_DIR, 'visual-fail.png'), fullPage: true })
    throw new Error(`30s 内画廊未渲染（截图 visual-fail.png；pageerrors: ${pageErrors.slice(0, 3).join(' | ') || '无'}）`)
  }
  log(`✓ 画廊渲染成功（${blocks} 个 data-genui 块）`)

  // 等懒加载引擎：mermaid 渲染、three.js 场景就绪（WebGL 在 headless 走 swiftshader）
  await page.waitForTimeout(6000)
  await page.screenshot({ path: join(OUT_DIR, 'gallery.png'), fullPage: true })
  log(`✓ 截图 gallery.png`)

  // ── 本地交互验证 ─────────────────────────────────────────────────────────
  // 点击在第一个 evaluate 里做；React 18 的状态更新是异步的，断言放到
  // 下一次 evaluate（中间隔一个 timeout），否则必然读到旧 DOM。
  const clicked = await page.evaluate(() => {
    const out: string[] = []
    // 1) 表格排序：点数值列「Q1」表头（数值感知排序的最小行应当是 0.3% 的错误率行）
    const ths = [...document.querySelectorAll('[data-genui] thead th button')]
    const q1 = ths.find(b => b.textContent?.includes('Q1'))
    if (q1) { (q1 as HTMLButtonElement).click(); out.push('sort-clicked=Q1') }
    // 2) 判题：点 quiz 的正确选项「2」（排除解释文本里的“二进制”）
    const quizBtns = [...document.querySelectorAll('[data-genui-quiz] button')]
    const correct = quizBtns.find(b => b.textContent?.includes('2') && !b.textContent?.includes('二进制'))
    if (correct) { (correct as HTMLButtonElement).click(); out.push('quiz-clicked=2') }
    // 3) 目录折叠：点 file-tree 的「src」目录行（第一个 aria-expanded=true
    //    的按钮是 accordion 头，必须按行文本定位到文件树）
    const dirBtn = [...document.querySelectorAll<HTMLElement>('[data-genui] button[aria-expanded="true"]')]
      .find(b => b.textContent?.includes('src'))
    if (dirBtn) { dirBtn.click(); out.push('tree-clicked=src') }
    return out
  })
  await page.waitForTimeout(600)
  const interacted = await page.evaluate(() => {
    const out: string[] = []
    // 1) 排序结果：升序后首行应是最小 Q1（0.3% 的错误率行）；排序标记在 Q1 表头
    const rows = [...document.querySelectorAll('[data-genui] tbody tr')].map(tr => tr.textContent ?? '')
    const firstRow = rows[0] ?? ''
    out.push(`sort-first=${firstRow.includes('错误率') ? '错误率' : '?'}`)
    const q1th = document.querySelectorAll('[data-genui] thead th')[1]
    out.push(`sort-aria=${q1th?.getAttribute('aria-sort') ?? '?'}`)
    // 2) 判题结果
    out.push('quiz-correct=' + String(document.querySelector('[data-genui-quiz]')?.textContent?.includes('回答正确')))
    // 3) 目录折叠结果：按行文本回找同一个按钮
    const srcDir = [...document.querySelectorAll<HTMLElement>('[data-genui] button[aria-expanded]')]
      .find(b => b.textContent?.includes('src'))
    out.push('tree-collapsed=' + String(srcDir?.getAttribute('aria-expanded') === 'false'))
    // 4) 数值列右对齐类名在场
    out.push('tdNum=' + String(document.querySelectorAll('[data-genui] td[class*="tdNum"]').length))
    return out
  })
  log(`交互检查: ${interacted.join(' · ')}`)
  // 防假通过：本地交互是渲染层的核心承诺，任何一项不成立都必须失败。
  const mustPass = [
    ['sort-first=错误率', '数值感知排序'],
    ['sort-aria=ascending', '排序 aria 标记'],
    ['quiz-correct=true', '本地判题'],
    ['tree-collapsed=true', '目录折叠'],
  ]
  for (const [expectation, label] of mustPass) {
    if (!interacted.includes(expectation)) throw new Error(`交互断言失败: ${label}（期望 ${expectation}，实际 ${interacted.join(' · ')}）`)
  }
  if (!interacted.some(s => s.startsWith('tdNum=') && Number(s.slice(6)) > 0)) throw new Error('交互断言失败: 数值列右对齐类名缺失')
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(OUT_DIR, 'interactions.png'), fullPage: true })
  log(`✓ 截图 interactions.png`)

  if (pageErrors.length > 0) throw new Error(`页面异常: ${pageErrors.slice(0, 3).join(' | ')}`)
  await browser.close()
  await cleanup()
  console.log('PASS 视觉 e2e：画廊渲染 + 本地交互 + 无页面异常')
  process.exit(0)
} catch (e) {
  console.error('✗ e2e 异常:', e)
  await browser?.close().catch(() => {}) // playwright 浏览器子进程不留孤儿
  await cleanup()
  process.exit(1)
}
