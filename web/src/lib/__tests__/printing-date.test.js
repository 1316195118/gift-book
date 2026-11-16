import { describe, it, expect, beforeEach } from 'vitest'
import { state as st } from '../../store.js'
import { buildPrintPages } from '../printing.js'

// 旧账簿可能没有开始日期；页脚必须给出可读兜底，不能出现 Invalid Date。
describe('buildPrintPages 日期兜底', () => {
  beforeEach(() => {
    st.currentEvent = { id: 'e1', name: '测试账簿', startDateTime: '', endDateTime: '', template: '婚宴' }
    st.gifts = [{ id: 'g1', data: { name: '张三', amount: 100, type: '现金', timestamp: '2026-11-16T10:00:00' } }]
    st.homeCategory = 'festive'
  })

  it('没有日期时页脚显示「未设置」', () => {
    const view = buildPrintPages([st.gifts[0]])
    expect(view.textContent).toContain('日期: 未设置')
    expect(view.textContent).not.toContain('Invalid Date')
  })

  it('有日期时正常显示中文日期', () => {
    st.currentEvent.startDateTime = '2026-11-16T10:00:00'
    const view = buildPrintPages([st.gifts[0]])
    expect(view.textContent).toContain('日期: 2026')
    expect(view.textContent).not.toContain('Invalid Date')
  })
})
