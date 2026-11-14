// 动效档位、喜庆/素净反馈、点击涟漪与数值强调（Vue 3 版）。
// 偏好读取统一在 prefs.js；系统减动效时 CSS 通过 html.motion-full 解除降级。

import { playTap, playCelebrate, playSolemn } from './sound.js'
import {
  motionPreference, setMotionPreference, toggleMotionPreference,
  prefersReducedMotion, applyMotionClass,
} from './prefs.js'

export { motionPreference, setMotionPreference, toggleMotionPreference, prefersReducedMotion }

/** 红事专属：一枚喜字 + 8 个金点向外散开。白事、失败、减动效一律不生成。 */
export function celebrate(glyph = '囍', { host = document.body } = {}) {
  if (prefersReducedMotion()) return
  const layer = document.createElement('div')
  layer.className = 'gb-celebrate'
  layer.setAttribute('aria-hidden', 'true')
  const mark = document.createElement('span')
  mark.className = 'gb-celebrate-mark'
  mark.textContent = glyph
  layer.appendChild(mark)
  for (let i = 0; i < 8; i += 1) {
    const dot = document.createElement('i')
    dot.className = 'gb-celebrate-dot'
    dot.style.setProperty('--gb-angle', `${(360 / 8) * i}deg`)
    dot.style.setProperty('--gb-delay', `${i * 28}ms`)
    layer.appendChild(dot)
  }
  host.appendChild(layer)
  playCelebrate()
  setTimeout(() => layer.remove(), 1300)
}

/** 白事专属：一圈素银淡墨扩散，无红金、无喜字。 */
export function solemnAck({ host = document.body } = {}) {
  if (prefersReducedMotion()) return
  const layer = document.createElement('div')
  layer.className = 'gb-solemn-wave'
  layer.setAttribute('aria-hidden', 'true')
  host.appendChild(layer)
  playSolemn()
  setTimeout(() => layer.remove(), 900)
}

/** 数值变化强调：一次性脉冲，动画结束自动摘 class。 */
export function pulse(el) {
  if (!el || prefersReducedMotion()) return
  el.classList.remove('gb-value-pulse')
  void el.offsetWidth
  el.classList.add('gb-value-pulse')
  const drop = () => el.classList.remove('gb-value-pulse')
  el.addEventListener('animationend', drop, { once: true })
  setTimeout(drop, 700)
}

const RIPPLE_TARGETS = [
  'button', '.btn', '.themed-button-primary', '.themed-button-secondary',
  '.home-create-btn', '.home-side-help', '.choice-card', '.tpl-card',
  '.recent-item', '.cover-style-item', '.export-option', '[role="button"]',
].join(',')

function onPointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return
  const el = event.target.closest && event.target.closest(RIPPLE_TARGETS)
  if (!el || el.disabled || el.classList.contains('gb-no-ripple')) return
  if (el.closest('#qr-float')) return
  playTap()
  if (prefersReducedMotion()) return
  const rect = el.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const size = Math.max(rect.width, rect.height) * 1.25
  const layer = document.createElement('span')
  layer.className = 'gb-ripple-layer'
  const dot = document.createElement('i')
  dot.className = 'gb-ripple-dot'
  dot.style.width = `${size}px`
  dot.style.height = `${size}px`
  // 0 是合法坐标（视口左上角），用 ?? 而不是 ||，否则会误判成缺省并回退到按钮中心。
  dot.style.left = `${(event.clientX ?? rect.left + rect.width / 2) - rect.left - size / 2}px`
  dot.style.top = `${(event.clientY ?? rect.top + rect.height / 2) - rect.top - size / 2}px`
  layer.appendChild(dot)
  el.classList.add('gb-ripple-host')
  el.appendChild(layer)
  const drop = () => layer.remove()
  dot.addEventListener('animationend', drop, { once: true })
  setTimeout(drop, 700)
}

export function initRipple() {
  document.addEventListener('pointerdown', onPointerDown, { passive: true })
}

export function initFeedback() {
  applyMotionClass()
  initRipple()
}
