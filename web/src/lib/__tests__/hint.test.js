import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initHints } from '../hint.js'

const bubble = () => document.getElementById('gb-hint-bubble')

describe('问号提示', () => {
  beforeAll(() => {
    initHints()
  })

  beforeEach(() => {
    document.body.innerHTML = '<span id="tip" class="gb-hint" data-hint="这里填地点" tabindex="0">?</span><button id="outside">外部</button>'
  })

  it('点击图标显示说明，再点一次收起', () => {
    const icon = document.getElementById('tip')
    icon.click()
    expect(bubble()).not.toBeNull()
    expect(bubble().hidden).toBe(false)
    expect(bubble().textContent).toBe('这里填地点')
    expect(icon.getAttribute('aria-expanded')).toBe('true')

    icon.click()
    expect(bubble().hidden).toBe(true)
    expect(icon.hasAttribute('aria-expanded')).toBe(false)
  })

  it('点击空白处和按 Esc 都会收起', () => {
    const icon = document.getElementById('tip')
    icon.click()
    document.getElementById('outside').click()
    expect(bubble().hidden).toBe(true)

    icon.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(bubble().hidden).toBe(true)
  })

  it('键盘回车可以打开说明', () => {
    const icon = document.getElementById('tip')
    icon.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(bubble().hidden).toBe(false)
  })

  it('没有 data-hint 的图标不弹层', () => {
    document.body.innerHTML = '<span id="tip" class="gb-hint">?</span>'
    document.getElementById('tip').click()
    expect(bubble()?.hidden ?? true).toBe(true)
  })
})
