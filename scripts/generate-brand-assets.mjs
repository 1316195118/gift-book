// 从 SVG 源文件生成社交卡片和 PWA 图标。
// 依赖：playwright-core + 已安装的 Edge/Chrome；ICO/尺寸转换使用 Pillow。
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '../web/node_modules/playwright-core/index.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = join(root, 'web', 'public')
const browserPath = [
  process.env.E2E_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((candidate) => candidate && existsSync(candidate))

if (!browserPath) throw new Error('找不到 Edge/Chrome；请设置 E2E_BROWSER')

const browser = await chromium.launch({ executablePath: browserPath, headless: true })
try {
  const card = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  await card.goto(pathToFileURL(join(publicDir, 'og-cover.svg')).href)
  await card.screenshot({ path: join(publicDir, 'og-cover.png'), type: 'png' })
  await card.close()

  const icon = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 })
  await icon.goto(pathToFileURL(join(publicDir, 'icon.svg')).href)
  await icon.screenshot({ path: join(publicDir, 'icon-512.png'), type: 'png' })
  await icon.close()
} finally {
  await browser.close()
}

const python = String.raw`
from PIL import Image
from pathlib import Path
p = Path(r"${publicDir.replaceAll('\\', '\\\\')}")
src = Image.open(p / "icon-512.png").convert("RGB")
src.resize((192, 192), Image.Resampling.LANCZOS).save(p / "icon-192.png", optimize=True)
src.resize((180, 180), Image.Resampling.LANCZOS).save(p / "apple-touch-icon.png", optimize=True)
src.save(p / "icon-maskable-512.png", optimize=True)
src.save(p / "favicon.ico", format="ICO", sizes=[(16,16), (24,24), (32,32), (48,48)])
print("generated favicon.ico, icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png")
`
execFileSync(process.env.PYTHON || 'python', ['-c', python], { stdio: 'inherit' })
