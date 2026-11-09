// 统一构建入口：node scripts/build.mjs
// 前端 ui/ 是零第三方依赖的原生 JS/CSS，直接由 embed.go 的 //go:embed all:ui 嵌入，
// 不需要 npm / Vite / 打包步骤。这里只做两件事：写构建号、编译 Go 单文件二进制。
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const build = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`

// 构建号写进 ui/build.json：前端 fetch('build.json') 与后端 /api/build 都读它。
writeFileSync(join(root, 'ui', 'build.json'), JSON.stringify({ build, version: '2.0.0' }) + '\n')
console.log(`前端已就绪：ui/（自研原生 JS/CSS，build=${build}）`)

const out = process.platform === 'win32' ? 'giftbook.exe' : 'giftbook'
execSync(`go build -trimpath -ldflags "-s -w" -o ${out} ./cmd/giftbook`, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CGO_ENABLED: '0' },
})
console.log(`构建完成：${out}`)
