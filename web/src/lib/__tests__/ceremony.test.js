import { describe, expect, it } from 'vitest'
import { ceremonyLabel, ceremonyText, ceremonyInputs } from '../ceremony.js'

describe('正期用词与显示', () => {
  it('按模板称呼，白事不用直白说法', () => {
    expect(ceremonyLabel({ template: 'wedding' }, 'red')).toBe('婚礼时间')
    expect(ceremonyLabel({ template: 'birthday' }, 'red')).toBe('寿宴时间')
    expect(ceremonyLabel({ template: 'funeral' }, 'white')).toBe('殡期')
    expect(ceremonyLabel({ template: 'memorial' }, 'white')).toBe('追思时间')
    expect(ceremonyLabel({}, 'white')).toBe('仪式时间')
    expect(ceremonyLabel({}, 'red')).toBe('婚礼时间')
  })

  it('卡片文案同一年省略年份，并带时间', () => {
    const now = new Date('2026-11-17T10:00:00')
    expect(ceremonyText({ ceremonyAt: '2026-11-18T12:00' }, now)).toBe('11月18日 12:00')
    expect(ceremonyText({ ceremonyAt: '2025-11-18T09:05' }, now)).toBe('2025年11月18日 09:05')
    expect(ceremonyText({}, now)).toBe('')
  })

  it('拆成日期与时间输入', () => {
    expect(ceremonyInputs('2026-11-18T12:00')).toEqual({ date: '2026-11-18', time: '12:00' })
    expect(ceremonyInputs('')).toEqual({ date: '', time: '' })
  })
})
