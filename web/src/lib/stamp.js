// 录入成功后的「盖章」：一方印落在录入面板上，停一下就淡掉。
//
// 这是全站唯一一处会自己动起来的效果，对应账房先生真实的动作 —— 记一笔，盖一个章。
// 颜色取主题色，所以红事是朱砂、白事是青黛，不会串色。
// 不挡输入：印章不接收鼠标事件，动画期间照样能继续打字。

const DURATION = 1100

export function stampSeal(glyph = '礼') {
  if (typeof document === 'undefined') return
  // 尊重系统的「减少动态效果」设置
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

  const host = document.querySelector('.entry-panel')
  if (!host) return

  host.querySelector('.entry-stamp')?.remove()

  const seal = document.createElement('div')
  seal.className = 'entry-stamp'
  seal.setAttribute('aria-hidden', 'true')
  seal.textContent = glyph
  host.appendChild(seal)

  setTimeout(() => seal.remove(), DURATION)
}
