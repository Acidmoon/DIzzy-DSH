/**
 * 用 bun 把 src 目录下的所有 .ts 递归转译为 lib 目录下的 .js
 * （不需要 dsh 检出仓库 / tsc）。
 *
 * 依赖解析走插件自己的 node_modules（本机可把 node_modules 指到 dsh 的
 * node_modules，见 README「本机快速构建」）；转译只去类型、不改写
 * 相对导入（源里的 './adapter.js' 指向转译后的 lib/adapter.js）。
 *
 * 运行：bun scripts/build-bun.mjs
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { readdir } from 'node:fs/promises'

const root = join(import.meta.dir, '..')
const srcRoot = join(root, 'src')
const libRoot = join(root, 'lib')
const transpiler = new Bun.Transpiler({ loader: 'ts' })

async function listTsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listTsFiles(full)))
    } else if (entry.name.endsWith('.ts')) {
      files.push(full)
    }
  }
  return files
}

const files = await listTsFiles(srcRoot)
for (const f of files) {
  const src = await Bun.file(f).text()
  const result = transpiler.transformSync(src)
  const rel = relative(srcRoot, f).replace(/\.ts$/, '.js')
  const out = join(libRoot, rel)
  await mkdir(dirname(out), { recursive: true })
  await Bun.write(out, result)
  console.log('built lib/' + rel)
}
console.log('done (' + files.length + ' files)')
