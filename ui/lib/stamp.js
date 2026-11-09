// 录入成功后的「落印」：一方印落在录入面板上，停一下就淡掉。
//
// 这是全站最有仪式感的一处效果，对应账房先生真实的动作 —— 记一笔，盖一个章。
// 印文取账簿模板字（婚宴是「囍」、寿宴是「寿」、白事是「奠」），颜色取主题色：
// 红事朱砂、白事青黛，绝不串色。
//
// 减动效不等于没有反馈：系统开启「减弱动态效果」时仍显示印章，
// 只是换成纯淡入淡出、不做缩放旋转；金色印光也只有红事 + 完整动效才有。

import { prefersReducedMotion } from './feedback.js'

const DURATION = 1100

export function stampSeal(glyph = '礼') {
  if (typeof document === 'undefined') return

  const host = document.querySelector('.entry-panel')
  if (!host) return

  const festive = document.body.dataset.occasion !== 'white' &&
    !document.body.classList.contains('theme-solemn')

  host.querySelector('.entry-stamp')?.remove()

  const fullMotion = !prefersReducedMotion()
  const seal = document.createElement('div')
  seal.className = 'entry-stamp'
  // 金色印光只属于「红事 + 完整动效」；白事与减动效一律素印。
  if (festive && fullMotion) seal.classList.add('is-festive')
  if (!fullMotion) seal.classList.add('is-static')
  seal.setAttribute('aria-hidden', 'true')
  seal.textContent = glyph
  host.appendChild(seal)

  setTimeout(() => seal.remove(), DURATION)
}
