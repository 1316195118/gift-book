// 宾客登记二维码海报：把标题、时间、地点和二维码合成一张可直接保存的图片。
// 只用 Canvas 和本地字体，不把账簿信息交给第三方图片服务。
import { ceremonyLabel } from './ceremony.js'

const POSTER_WIDTH = 1200
const POSTER_HEIGHT = 1800

const PALETTES = {
  red: {
    paper: '#fff9ef', paperEdge: '#f9ead9', ink: '#31221a', muted: '#756052',
    accent: '#a52d24', gold: '#bd8b4b', tint: '#f4e1d2', qr: '#fffaf1',
  },
  white: {
    paper: '#f7f8f8', paperEdge: '#e8ecec', ink: '#263036', muted: '#667177',
    accent: '#53636b', gold: '#9ba5a5', tint: '#e6ebeb', qr: '#fafbfb',
  },
  custom: {
    paper: '#fcf5ed', paperEdge: '#f0e1d2', ink: '#3d2b24', muted: '#786357',
    accent: '#83503d', gold: '#b38d63', tint: '#eddfd2', qr: '#fffaf5',
  },
}

export function guestQrPosterInfo(event, category = 'red') {
  const eventName = String(event?.name || '宾客登记').trim() || '宾客登记'
  const rawTime = String(event?.ceremonyAt || event?.startDateTime || '').trim()
  const parsed = rawTime ? new Date(rawTime) : null
  const time = parsed && Number.isFinite(parsed.getTime())
    ? `${parsed.getFullYear()}年${parsed.getMonth() + 1}月${parsed.getDate()}日 ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
    : '以主家通知为准'
  const location = String(event?.location || '').trim() || '地址以主家通知为准'
  return {
    eventName,
    timeLabel: ceremonyLabel(event, category),
    time,
    location,
    category: category === 'white' || category === 'custom' ? category : 'red',
    seal: category === 'white' ? '奠' : category === 'custom' ? '记' : '礼',
  }
}

export async function renderGuestQrPoster({ qrDataUrl, info, expiryText }) {
  const qrImage = await loadImage(qrDataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = POSTER_WIDTH
  canvas.height = POSTER_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器无法生成二维码海报')
  const palette = PALETTES[info.category] || PALETTES.red

  drawBackground(ctx, palette)
  drawFrame(ctx, palette, info)
  drawHeading(ctx, palette, info)
  drawDetails(ctx, palette, info)
  drawQrPanel(ctx, palette, qrImage)
  drawFooter(ctx, palette, expiryText)
  return canvas.toDataURL('image/png')
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function drawBackground(ctx, palette) {
  const gradient = ctx.createLinearGradient(0, 0, 0, POSTER_HEIGHT)
  gradient.addColorStop(0, palette.paper)
  gradient.addColorStop(0.48, '#fffdf9')
  gradient.addColorStop(1, palette.paperEdge)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT)

  // 极浅的横纹让纸面不像一块纯色，但不会干扰二维码识别。
  ctx.strokeStyle = palette.tint
  ctx.lineWidth = 1
  ctx.globalAlpha = 0.38
  for (let y = 24; y < POSTER_HEIGHT; y += 22) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(POSTER_WIDTH, y)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

function drawFrame(ctx, palette, info) {
  roundedRect(ctx, 38, 38, POSTER_WIDTH - 76, POSTER_HEIGHT - 76, 38)
  ctx.strokeStyle = palette.accent
  ctx.lineWidth = 4
  ctx.stroke()
  roundedRect(ctx, 58, 58, POSTER_WIDTH - 116, POSTER_HEIGHT - 116, 30)
  ctx.strokeStyle = palette.gold
  ctx.lineWidth = 2
  ctx.stroke()

  // 四角短线和中心小菱形把边框收成印章式构图。
  ctx.strokeStyle = palette.accent
  ctx.lineWidth = 3
  for (const [x, y, sx, sy] of [
    [88, 88, 1, 1], [1112, 88, -1, 1], [88, 1712, 1, -1], [1112, 1712, -1, -1],
  ]) {
    ctx.beginPath()
    ctx.moveTo(x, y + 50 * sy)
    ctx.lineTo(x, y)
    ctx.lineTo(x + 50 * sx, y)
    ctx.stroke()
    diamond(ctx, x + 10 * sx, y + 10 * sy, 5, palette.gold)
  }

  ctx.fillStyle = palette.accent
  ctx.font = '600 44px "KaiTi", "STKaiti", "Songti SC", serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  roundedRect(ctx, 1015, 104, 82, 82, 8)
  ctx.fill()
  ctx.strokeStyle = palette.gold
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.fillStyle = '#fffaf0'
  ctx.fillText(info.seal, 1056, 147)
}

function drawHeading(ctx, palette, info) {
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = palette.accent
  ctx.font = '600 28px "Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.letterSpacing = '6px'
  ctx.fillText('扫 码 登 记', POSTER_WIDTH / 2, 138)
  ctx.letterSpacing = '0px'

  const fontSize = [...info.eventName].length <= 14 ? 70 : 58
  ctx.font = `600 ${fontSize}px "KaiTi", "STKaiti", "Songti SC", serif`
  const lines = wrapText(ctx, info.eventName, 870, 2)
  const startY = lines.length > 1 ? 232 : 252
  lines.forEach((line, index) => {
    ctx.fillStyle = palette.ink
    ctx.fillText(line, POSTER_WIDTH / 2, startY + index * (fontSize + 18))
  })
  ctx.fillStyle = palette.gold
  ctx.fillRect(POSTER_WIDTH / 2 - 52, startY + lines.length * (fontSize + 18) - 2, 104, 2)
}

function drawDetails(ctx, palette, info) {
  const top = 446
  const rows = [
    [info.timeLabel, info.time, 86, 31],
    ['地点', info.location, 112, 29],
  ]
  rows.forEach(([label, value, height, valueSize], index) => {
    const y = top + index * 106
    roundedRect(ctx, 155, y, 890, height, 14)
    ctx.fillStyle = index === 0 ? palette.tint : '#fffdf9'
    ctx.fill()
    ctx.strokeStyle = palette.gold
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = palette.accent
    ctx.font = '600 25px "Microsoft YaHei", "PingFang SC", sans-serif'
    ctx.fillText(label, 190, y + 43)
    ctx.fillStyle = palette.ink
    ctx.font = `500 ${valueSize}px "Microsoft YaHei", "PingFang SC", sans-serif`
    const lines = wrapText(ctx, value, 620, index === 0 ? 1 : 2)
    const firstY = lines.length > 1 ? y + 36 : y + 43
    lines.forEach((line, lineIndex) => ctx.fillText(line, 365, firstY + lineIndex * 37))
  })
}

function drawQrPanel(ctx, palette, qrImage) {
  roundedRect(ctx, 202, 692, 796, 816, 26)
  ctx.fillStyle = '#fffefb'
  ctx.fill()
  ctx.strokeStyle = palette.gold
  ctx.lineWidth = 3
  ctx.stroke()
  roundedRect(ctx, 220, 710, 760, 760, 18)
  ctx.strokeStyle = palette.accent
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.drawImage(qrImage, 220, 710, 760, 760)

  ctx.fillStyle = palette.gold
  for (const [x, y] of [[202, 692], [998, 692], [202, 1508], [998, 1508]]) {
    diamond(ctx, x, y, 9, palette.gold)
  }
}

function drawFooter(ctx, palette, expiryText) {
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = palette.ink
  ctx.font = '600 32px "Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.fillText('长按保存 · 扫码填写登记', POSTER_WIDTH / 2, 1548)

  ctx.fillStyle = palette.muted
  ctx.font = '400 23px "Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.fillText(ellipsize(ctx, String(expiryText || '有效期跟随账簿结束时间'), 950), POSTER_WIDTH / 2, 1596)
  ctx.fillText('提交后需主家确认，信息仅用于本次登记核对', POSTER_WIDTH / 2, 1654)
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

function diamond(ctx, x, y, size, color) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x, y - size)
  ctx.lineTo(x + size, y)
  ctx.lineTo(x, y + size)
  ctx.lineTo(x - size, y)
  ctx.closePath()
  ctx.fill()
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const chars = [...String(text)]
  const lines = []
  let line = ''
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]
    const next = line + char
    if (line && ctx.measureText(next).width > maxWidth) {
      if (lines.length === maxLines - 1) {
        lines.push(ellipsize(ctx, line + chars.slice(index).join(''), maxWidth))
        return lines
      }
      lines.push(line)
      line = char
    } else {
      line = next
    }
  }
  if (line) lines.push(ellipsize(ctx, line, maxWidth))
  return lines
}

function ellipsize(ctx, text, maxWidth) {
  const value = String(text)
  if (ctx.measureText(value).width <= maxWidth) return value
  let prefix = ''
  for (const char of [...value]) {
    if (ctx.measureText(prefix + char + '…').width > maxWidth) break
    prefix += char
  }
  return prefix + '…'
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('二维码图片加载失败'))
    image.src = src
  })
}
