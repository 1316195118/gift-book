// 统一构建入口：node scripts/build.mjs [--skip-web]
// 前端产物 → webapp/dist（Go embed 目录）→ 单文件二进制。
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const skipWeb = process.argv.includes('--skip-web')

if (!skipWeb) {
  execSync('npm run build', { cwd: join(root, 'web'), stdio: 'inherit' })
}

const source = join(root, 'web', 'dist')
const target = join(root, 'webapp', 'dist')
if (!existsSync(source)) {
  console.error('缺少前端产物：请先运行 npm run build')
  process.exit(1)
}
if (existsSync(target)) rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
cpSync(source, target, { recursive: true })
// 占位文件要补回来：webapp/dist 的内容不入库，但目录必须在，
// 否则 embed.go 的 //go:embed all:webapp/dist 在新克隆里编译不过。
writeFileSync(join(target, '.gitkeep'), '')

const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const build = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
writeFileSync(join(target, 'build.json'), JSON.stringify({ build, version: '2.1.0' }))
console.log(`前端产物已就绪：${target}（build=${build}，${readdirSync(join(target, 'assets')).length} 个资源）`)

execSync('go build -trimpath -ldflags "-s -w" -o giftbook.exe ./cmd/giftbook', {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CGO_ENABLED: '0' },
})
console.log('构建完成：giftbook.exe')
