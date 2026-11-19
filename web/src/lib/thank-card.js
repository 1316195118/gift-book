// 答谢卡：把一笔礼金生成一张可保存的图片，红事朱砂、白事素青。
// 纯 Canvas 2D 手绘，不依赖截图库，离线可用。
import { openModal, closeModal } from './modal.js'
import { copyOf } from './content.js'
import { formatCurrency } from './crypto.js'
import { state as st } from '../store.js'
import { ceremonyText } from './ceremony.js'

const W = 720
const H = 900

function wrapText(ctx, text, maxWidth) {
  const chars = String(text || '').split('')
  const lines = []
  let line = ''
  for (const ch of chars) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line)
      line = ch
    } else {
      line += ch
    }
  }
  if (line) lines.push(line)
  return lines
}

function drawCard(canvas, gift) {
  const ctx = canvas.getContext('2d')
  const solemn = st.homeCategory === 'white'
  const ink = solemn ? '#1F2E33' : '#4A2C1A'
  const accent = solemn ? '#3A5560' : '#A43A2B'
  const paper = solemn ? '#F3F2EC' : '#FBF7EE'

  ctx.fillStyle = paper
  ctx.fillRect(0, 0, W, H)

  // 外框 + 内框
  ctx.strokeStyle = accent
  ctx.lineWidth = 3
  ctx.strokeRect(28, 28, W - 56, H - 56)
  ctx.lineWidth = 1
  ctx.strokeRect(40, 40, W - 80, H - 80)

  // 顶部：账簿名 / 事由
  const event = st.currentEvent || {}
  const title = String(event.name || copyOf(event, st.homeCategory).bookTitle || '礼簿')
  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.font = '600 40px KaiTi, STKaiti, serif'
  ctx.fillText(title, W / 2, 118)
  ctx.font = '24px KaiTi, STKaiti, serif'
  ctx.fillStyle = solemn ? '#54656B' : '#8A5A3C'
  const ceremony = ceremonyText(event) || ''
  ctx.fillText(ceremony, W / 2, 168)

  // 中间：答谢语
  ctx.fillStyle = ink
  ctx.font = '500 44px KaiTi, STKaiti, serif'
  ctx.fillText(solemn ? '聊表寸心 · 恕不成谢' : '衷心感谢 光临致贺', W / 2, 340)

  // 宾客名
  const name = String(gift?.data?.name || '')
  const nameLines = wrapText(ctx, name, 400)
  ctx.font = '600 64px KaiTi, STKaiti, serif'
  ctx.fillStyle = accent
  nameLines.forEach((line, i) => ctx.fillText(line, W / 2, 470 + i * 80))

  // 礼金
  ctx.fillStyle = ink
  ctx.font = '28px KaiTi, STKaiti, serif'
  ctx.fillText('礼金', W / 2, 560 + nameLines.length * 80 - 30)
  ctx.font = '600 48px KaiTi, STKaiti, serif'
  ctx.fillStyle = accent
  ctx.fillText(formatCurrency(gift?.data?.amount), W / 2, 620 + nameLines.length * 80 - 30)

  // 落款 + 印章
  ctx.fillStyle = solemn ? '#54656B' : '#8A5A3C'
  ctx.font = '26px KaiTi, STKaiti, serif'
  const date = new Date()
  ctx.fillText(`谨记于 ${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`, W / 2, H - 120)

  const sealSize = 92
  const sealX = W - 130
  const sealY = H - 240
  ctx.fillStyle = accent
  ctx.fillRect(sealX, sealY, sealSize, sealSize)
  ctx.strokeStyle = 'rgba(255,255,255,.55)'
  ctx.lineWidth = 2
  ctx.strokeRect(sealX + 5, sealY + 5, sealSize - 10, sealSize - 10)
  ctx.fillStyle = '#FBF7EE'
  ctx.font = '600 56px KaiTi, STKaiti, serif'
  ctx.textAlign = 'center'
  ctx.fillText(solemn ? '奠' : '谢', sealX + sealSize / 2, sealY + sealSize / 2 + 20)
}

export function openThankCard(gift) {
  if (!gift?.data) return
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  drawCard(canvas, gift)
  const html = `
    <div class="thank-card-wrap">
      <canvas id="thank-card-canvas" width="${W}" height="${H}"></canvas>
      <p class="thank-card-hint">长按图片可保存到相册；或点「保存图片」下载。</p>
    </div>`
  openModal('答谢卡', { type: 'html', html }, [
    { text: '关闭', class: 'modal-btn-ghost' },
    {
      text: '保存图片',
      class: 'modal-btn-primary',
      handler: () => {
        const target = document.getElementById('thank-card-canvas')
        if (!target) return
        const targetCtx = target.getContext('2d')
        targetCtx.drawImage(canvas, 0, 0)
        target.toBlob((blob) => {
          if (!blob) return
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = `答谢卡-${gift.data.name || '宾客'}.png`
          link.click()
          setTimeout(() => URL.revokeObjectURL(url), 4000)
        }, 'image/png')
      },
    },
  ], { dismissable: true })
  setTimeout(() => {
    const target = document.getElementById('thank-card-canvas')
    const targetCtx = target?.getContext('2d')
    if (target && targetCtx) targetCtx.drawImage(canvas, 0, 0)
  }, 60)
}
