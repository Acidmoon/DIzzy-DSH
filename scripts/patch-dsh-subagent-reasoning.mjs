#!/usr/bin/env node
/**
 * 修 DSH 0.1.6-alpha.1 的「子代理完成通知带 reasoning 块」导致的整轮失败。
 *
 * 症状(会话日志里能看到):
 *   turn/end reason.error.message =
 *     "DeepSeek Messages cannot represent user/tool-result content reasoning"
 *     code = UNSUPPORTED_CONTENT
 *
 * 根因链:
 *   1. 后台子代理收尾时,其 output 里带 reasoning 块;
 *   2. 旧版 `@deepseek-ai/dsh-subagent` 的 `createSettlementMessage` 把子代理
 *      output 原样拼进给父会话的 `user/message`(source.kind = subagent-settled);
 *   3. 当前版本的该函数已经修好(只保留 text 块,源码注释写明「Parent providers
 *      receive this notice as a user message and may reject nontext assistant
 *      blocks」),但**已经落盘的那条 user/message 改不回来**;
 *   4. 会话历史不可变,之后每个请求都会重放它 →
 *      `dsh-llm-deepseek` 的 `input()` 对 user/tool-result 只认 text/image,
 *      遇到 reasoning 就 `unsupported()` 抛错 → 该会话永久卡死。
 *
 * 本补丁修的是**读路径**:让适配器在 user/tool-result 里遇到无法在 DeepSeek
 * chat-completions 里表达的块时 <跳过并记一条降级诊断>,而不是让整轮失败。
 * 这样:历史坏消息不再卡死会话,未来若再出现同类块也只是被丢弃,不会炸。
 *
 * 为什么不动 DSH 内核、也不改会话日志:
 *   - 会话日志是不可变历史,改了会破坏「模型可见 ⟺ 日志可重建」;
 *   - 丢一个 reasoning 块不影响叙事(该块只是子代理的思考过程,后面紧跟它的
 *     正文 text 块),但让整轮失败影响很大。
 *
 * 默认 dry-run。真正写盘必须加 --apply;写盘前备份为 *.bak-subagent-reasoning。
 * npm 重装 dsh 后需要重跑本脚本。
 *
 * 用法:
 *   node scripts/patch-dsh-subagent-reasoning.mjs
 *   node scripts/patch-dsh-subagent-reasoning.mjs --apply
 *   node scripts/patch-dsh-subagent-reasoning.mjs --prefix D:/DevTools/npm-global --apply
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

function parseArgs(argv) {
  const out = { apply: false, prefix: undefined }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--apply') out.apply = true
    else if (arg === '--prefix') {
      const value = argv[i + 1]
      if (value === undefined) throw new Error('--prefix 需要目录')
      out.prefix = value
      i += 1
    } else {
      throw new Error(`未知参数: ${arg}`)
    }
  }
  return out
}

function detectPrefix(explicit) {
  if (explicit) return explicit
  const npmCli = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  if (!existsSync(npmCli)) throw new Error('找不到 npm-cli.js,请传 --prefix')
  const printed = execFileSync(process.execPath, [npmCli, 'prefix', '-g'], { encoding: 'utf8' }).trim()
  if (printed === '') throw new Error('npm prefix -g 为空,请传 --prefix')
  return printed
}

/** 在部署里定位某个 @deepseek-ai 子包的 lib/index.js。 */
function resolveLib(prefix, name) {
  const nested = join(prefix, 'node_modules/@deepseek-ai/dsh/node_modules', name, 'lib/index.js')
  if (existsSync(nested)) return nested
  const requireFromDsh = createRequire(join(prefix, 'node_modules/@deepseek-ai/dsh/package.json'))
  return join(requireFromDsh.resolve(`${name}/package.json`), '../lib/index.js')
}

/** 一次替换:命中 from 就改成 to;已经命中 already 视为已打过。 */
function patchFile(path, change, apply) {
  if (!existsSync(path)) throw new Error(`找不到 ${path}`)
  let text = readFileSync(path, 'utf8')
  if (text.includes(change.already)) return { path, state: 'already' }
  if (!text.includes(change.from)) return { path, state: 'nomatch' }
  text = text.replace(change.from, change.to)
  if (apply) {
    copyFileSync(path, `${path}.bak-subagent-reasoning`)
    writeFileSync(path, text)
    return { path, state: 'applied' }
  }
  return { path, state: 'pending' }
}

const args = parseArgs(process.argv.slice(2))
const prefix = detectPrefix(args.prefix)
const target = resolveLib(prefix, '@deepseek-ai/dsh-llm-deepseek')

const result = patchFile(target, {
  already: 'DeepSeek history dropped a content block the chat-completions format cannot represent',
  from: `\tconst input = (blocks) => blocks.flatMap((block) => {
\t\tif (block.type === "text") return block.text ? [{
\t\t\ttype: "text",
\t\t\ttext: block.text
\t\t}] : [];
\t\tif (block.type !== "image") return unsupported(\`user/tool-result content \${block.type}\`);
\t\tconst version = images.get(block.attachment.attachmentId);`,
  to: `\tconst input = (blocks) => blocks.flatMap((block) => {
\t\tif (block.type === "text") return block.text ? [{
\t\t\ttype: "text",
\t\t\ttext: block.text
\t\t}] : [];
\t\t// 上游修了产生端(子代理完成通知不再带非 text 块),但已经落盘的历史
\t\t// 改不回来;丢块而不是让整轮失败,否则老会话会永久卡死。
\t\tif (block.type !== "image") {
\t\t\tonReplayDegrade?.(\`DeepSeek history dropped a content block the chat-completions format cannot represent: \${block.type}\`);
\t\t\treturn [];
\t\t}
\t\tconst version = images.get(block.attachment.attachmentId);`,
}, args.apply)

const report = {
  apply: args.apply,
  prefix,
  target: result.path,
  state: result.state,
  hint: result.state === 'nomatch'
    ? '目标代码与补丁不匹配(上游可能已改) —— 不要强改,先对照源码'
    : (result.state === 'pending' ? 'dry-run:加 --apply 才写盘' : undefined),
}
console.log(JSON.stringify(report, null, 2))

if (result.state === 'nomatch') process.exitCode = 1
