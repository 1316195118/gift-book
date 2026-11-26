// 扫描仓库内的 Markdown、HTML、Vue 与 JS 链接，检查路由、静态文件和外部可达性。
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'

const ROOT = resolve('.')
const TEXT_EXT = new Set(['.md', '.html', '.vue', '.js', '.mjs'])
const SKIP_DIRS = ['node_modules', 'dist', '.git', 'coverage', '.agents', '.codex']
const PUBLIC_ROUTES = new Set(['/', '/index.html', '/terms', '/privacy', '/404.html'])
const checkExternal = !process.argv.includes('--offline')

const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => TEXT_EXT.has(extname(file)))
  .filter((file) => !SKIP_DIRS.some((dir) => file.split('/').includes(dir)))

const records = []
const seen = new Set()

for (const file of tracked) {
  // 检查器自身包含链接识别正则，其中的字符片段不是页面链接。
  if (file === 'scripts/check-links.mjs') continue
  let text
  try {
    text = readFileSync(join(ROOT, file), 'utf8')
  } catch {
    continue
  }
  const patterns = [
    /!?\[[^\]]*\]\((?:<([^>]+)>|([^)\s]+))(?:\s+["'][^"']*["'])?\)/g,
    /(?:^|\s)(?:href|src)\s*=\s*["']([^"']+)["']/g,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const target = (match[1] || match[2] || '').trim()
      if (!target || /^(?:javascript:|data:|mailto:|tel:)/i.test(target)) continue
      const key = `${file}\0${target}`
      if (seen.has(key)) continue
      seen.add(key)
      records.push({ file, target })
    }
  }
}

function slugifyHeading(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function anchorsIn(text, file) {
  const anchors = new Set()
  for (const match of text.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)) {
    anchors.add(decodeURIComponent(match[1]))
  }
  if (extname(file) === '.md') {
    const seen = new Map()
    for (const match of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
      const base = slugifyHeading(match[1])
      if (!base) continue
      const count = seen.get(base) || 0
      seen.set(base, count + 1)
      anchors.add(count ? `${base}-${count}` : base)
    }
  }
  return anchors
}

function hasAnchor(file, rawHash) {
  if (!rawHash) return true
  let decoded
  try {
    decoded = decodeURIComponent(rawHash.replace(/^#/, ''))
  } catch {
    return false
  }
  if (!decoded || decoded === 'top') return true
  return anchorsIn(readFileSync(file, 'utf8'), file).has(decoded)
}

function staticTarget(pathname) {
  const clean = pathname.replace(/^\/+/, '')
  const candidates = [
    join(ROOT, clean),
    join(ROOT, 'web', clean),
    join(ROOT, 'web', 'public', clean),
  ]
  return candidates.find((candidate) => existsSync(candidate))
}

async function externalStatus(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 9000)
  try {
    let response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'GiftBookLinkCheck/1.0' },
    })
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': 'GiftBookLinkCheck/1.0', range: 'bytes=0-1024' },
      })
    }
    return { ok: response.status < 400, status: response.status, finalUrl: response.url }
  } catch (error) {
    return { ok: false, status: 0, error: error.name === 'AbortError' ? 'timeout' : error.message }
  } finally {
    clearTimeout(timer)
  }
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length)
  let cursor = 0
  async function run() {
    while (cursor < items.length) {
      const index = cursor++
      output[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return output
}

const results = []
const externalRecords = []
for (const record of records) {
  const { file, target } = record
  if (target.includes('${') || /^(?:state|coverPreview)$/.test(target)) {
    results.push({ ...record, state: 'runtime', detail: '动态绑定资源' })
    continue
  }
  if (/^https?:\/\//i.test(target)) {
    if (target.includes('<') || target.includes('[网站')) {
      results.push({ ...record, state: 'sample', detail: '文档占位 URL，跳过网络检查' })
      continue
    }
    if (!checkExternal) {
      results.push({ ...record, state: 'external', detail: '未联网检查' })
      continue
    }
    externalRecords.push(record)
    continue
  }
  if (target.startsWith('/')) {
    const url = new URL(target, 'https://giftbook.local')
    if (url.pathname.startsWith('/api/')) {
      results.push({ ...record, state: 'runtime', detail: '应用 API 路由' })
      continue
    }
    if (PUBLIC_ROUTES.has(url.pathname)) {
      const routeFile = {
        '/': 'web/src/views/HomeScreen.vue',
        '/terms': 'web/src/views/PolicyScreen.vue',
        '/privacy': 'web/src/views/PolicyScreen.vue',
        '/404.html': 'web/public/404.html',
        '/index.html': 'web/index.html',
      }[url.pathname]
      const anchorOk = url.hash && routeFile ? hasAnchor(join(ROOT, routeFile), url.hash) : true
      results.push({ ...record, state: anchorOk ? 'ok' : 'broken', detail: anchorOk ? '应用路由' : '应用路由锚点不存在' })
      continue
    }
    const found = staticTarget(decodeURIComponent(url.pathname))
    const anchorOk = found && url.hash ? hasAnchor(found, url.hash) : true
    results.push({ ...record, state: found && anchorOk ? 'ok' : 'broken', detail: found ? (anchorOk ? '静态文件' : '文件锚点不存在') : '路由或文件不存在' })
    continue
  }
  if (target.startsWith('#')) {
    const ok = hasAnchor(join(ROOT, file), target)
    results.push({ ...record, state: ok ? 'ok' : 'broken', detail: ok ? '页内锚点' : '页内锚点不存在' })
    continue
  }
  const hash = target.includes('#') ? `#${target.split('#').slice(1).join('#')}` : ''
  const withoutHash = target.split('#')[0].split('?')[0]
  const found = resolve(dirname(join(ROOT, file)), withoutHash)
  const ok = existsSync(found) && (!hash || hasAnchor(found, hash))
  results.push({ ...record, state: ok ? 'ok' : 'broken', detail: ok ? found : (existsSync(found) ? '文件锚点不存在' : '文件不存在') })
}

if (externalRecords.length) {
  const uniqueUrls = [...new Set(externalRecords.map((record) => record.target))]
  const statuses = new Map()
  await mapLimit(uniqueUrls, 6, async (url) => {
    statuses.set(url, await externalStatus(url))
  })
  for (const record of externalRecords) {
    const status = statuses.get(record.target)
    results.push({ ...record, state: status.ok ? 'ok' : 'broken', detail: status.status || status.error })
  }
}

for (const item of results.filter((entry) => entry.state === 'broken')) {
  console.error(`BROKEN ${item.file} -> ${item.target} (${item.detail})`)
}
const counts = Object.fromEntries(['ok', 'broken', 'runtime', 'external', 'sample'].map((kind) => [
  kind,
  results.filter((item) => item.state === kind).length,
]))
console.log(`链接检查：${JSON.stringify(counts)}`)
if (counts.broken) process.exit(1)
