#!/usr/bin/env node
/**
 * 给本机已安装的 @deepseek-ai/dsh 打两处补丁:
 *  1. dsh-token-meter: usage / pressure 折算卡住负数;
 *  2. dsh-host-apiproxy: session.history 投影失败降级,不再整页失败。
 *
 * 默认 dry-run。真正写盘必须加 --apply。写盘前先备份为 *.bak-dsh-history。
 * npm 重装 dsh 后必须再跑一次。
 *
 * 用法:
 *   node scripts/patch-dsh-history-projections.mjs
 *   node scripts/patch-dsh-history-projections.mjs --apply
 *   node scripts/patch-dsh-history-projections.mjs --prefix D:/DevTools/npm-global --apply
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
  if (process.env.npm_config_prefix) return process.env.npm_config_prefix
  const npmCli = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  if (!existsSync(npmCli)) throw new Error('找不到 npm-cli.js,请传 --prefix')
  const printed = execFileSync(process.execPath, [npmCli, 'prefix', '-g'], { encoding: 'utf8' }).trim()
  if (printed === '') throw new Error('npm prefix -g 为空,请传 --prefix')
  return printed
}

function resolveLib(prefix, name) {
  const nested = join(prefix, 'node_modules/@deepseek-ai/dsh/node_modules', name, 'lib/index.js')
  if (existsSync(nested)) return nested
  const requireFromDsh = createRequire(join(prefix, 'node_modules/@deepseek-ai/dsh/package.json'))
  return join(requireFromDsh.resolve(`${name}/package.json`), '../lib/index.js')
}

function patchFile(path, needles, apply) {
  if (!existsSync(path)) throw new Error(`找不到 ${path}`)
  let text = readFileSync(path, 'utf8')
  const done = []
  const pending = []
  for (const needle of needles) {
    if (text.includes(needle.already)) {
      done.push(needle.id)
      continue
    }
    if (!text.includes(needle.from)) {
      throw new Error(`${path} 对不上补丁 ${needle.id},上游可能已改`)
    }
    text = text.replace(needle.from, needle.to)
    pending.push(needle.id)
  }
  if (apply && pending.length > 0) {
    copyFileSync(path, `${path}.bak-dsh-history`)
    writeFileSync(path, text)
  }
  return { path, applied: apply ? pending : [], pending: apply ? [] : pending, done }
}

const args = parseArgs(process.argv.slice(2))
const prefix = detectPrefix(args.prefix)
const tokenMeterFile = resolveLib(prefix, '@deepseek-ai/dsh-token-meter')
const apiProxyFile = resolveLib(prefix, '@deepseek-ai/dsh-host-apiproxy')

const tokenResult = patchFile(tokenMeterFile, [
  {
    id: 'token-meter-nonneg',
    already: 'return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(n)));',
    from: `const bucketsFrom = (usage) => ({
	uncachedInputTokens: usage.inputTokens,
	outputTokens: usage.outputTokens,
	cacheReadTokens: usage.cacheReadTokens ?? 0,
	cacheWriteTokens: usage.cacheWriteTokens ?? 0
});
const bucketsEqual = (left, right) => left.uncachedInputTokens === right.uncachedInputTokens && left.outputTokens === right.outputTokens && left.cacheReadTokens === right.cacheReadTokens && left.cacheWriteTokens === right.cacheWriteTokens;
const addReplacing = (totals, previous, next) => ({
	uncachedInputTokens: totals.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0) + next.uncachedInputTokens,
	outputTokens: totals.outputTokens - (previous?.outputTokens ?? 0) + next.outputTokens,
	cacheReadTokens: totals.cacheReadTokens - (previous?.cacheReadTokens ?? 0) + next.cacheReadTokens,
	cacheWriteTokens: totals.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0) + next.cacheWriteTokens
});`,
    to: `const nonneg = (value) => {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return 0;
	return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(n)));
};
const bucketsFrom = (usage) => ({
	uncachedInputTokens: nonneg(usage.inputTokens),
	outputTokens: nonneg(usage.outputTokens),
	cacheReadTokens: nonneg(usage.cacheReadTokens ?? 0),
	cacheWriteTokens: nonneg(usage.cacheWriteTokens ?? 0)
});
const bucketsEqual = (left, right) => left.uncachedInputTokens === right.uncachedInputTokens && left.outputTokens === right.outputTokens && left.cacheReadTokens === right.cacheReadTokens && left.cacheWriteTokens === right.cacheWriteTokens;
const addReplacing = (totals, previous, next) => ({
	uncachedInputTokens: nonneg(totals.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0) + next.uncachedInputTokens),
	outputTokens: nonneg(totals.outputTokens - (previous?.outputTokens ?? 0) + next.outputTokens),
	cacheReadTokens: nonneg(totals.cacheReadTokens - (previous?.cacheReadTokens ?? 0) + next.cacheReadTokens),
	cacheWriteTokens: nonneg(totals.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0) + next.cacheWriteTokens)
});`,
  },
  {
    id: 'token-meter-pressure',
    already: 'const pressureFrom = (usage) => nonneg(usage.inputTokens) + nonneg(usage.cacheReadTokens ?? 0) + nonneg(usage.cacheWriteTokens ?? 0);',
    from: 'const pressureFrom = (usage) => usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);',
    to: 'const pressureFrom = (usage) => nonneg(usage.inputTokens) + nonneg(usage.cacheReadTokens ?? 0) + nonneg(usage.cacheWriteTokens ?? 0);',
  },
], args.apply)

const historyResult = patchFile(apiProxyFile, [
  {
    id: 'history-fail-soft',
    already: 'session.history: projections failed (serving the page without them)',
    from: `	function historyCutOf(source, includeProjections) {
		if (source.kind === "detached") {
			const projections = includeProjections ? detachedProjectionsFor(ctx, source.events) : void 0;
			return {
				events: source.events,
				...projections === void 0 ? {} : { projections }
			};
		}
		const events = [...source.session.events];
		const projections = includeProjections ? projectionsFor(ctx, source.session) : void 0;
		return {
			events,
			...projections === void 0 ? {} : { projections }
		};
	}`,
    to: `	function historyCutOf(source, includeProjections) {
		const tryProjections = (compute) => {
			if (!includeProjections) return;
			try {
				return compute();
			} catch (error) {
				ctx.logger.warn(\`session.history: projections failed (serving the page without them): \${String(error)}\`);
			}
		};
		if (source.kind === "detached") {
			const projections = tryProjections(() => detachedProjectionsFor(ctx, source.events));
			return {
				events: source.events,
				...projections === void 0 ? {} : { projections }
			};
		}
		const events = [...source.session.events];
		const projections = tryProjections(() => projectionsFor(ctx, source.session));
		return {
			events,
			...projections === void 0 ? {} : { projections }
		};
	}`,
  },
], args.apply)

console.log(JSON.stringify({
  apply: args.apply,
  prefix,
  tokenResult,
  historyResult,
}, null, 2))
