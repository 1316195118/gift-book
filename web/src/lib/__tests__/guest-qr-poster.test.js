import { describe, expect, it } from 'vitest'
import { guestQrPosterInfo } from '../guest-qr-poster.js'

describe('宾客二维码海报信息', () => {
  it('使用自定义事项的标题、时间与地址', () => {
    const info = guestQrPosterInfo({
      name: '秋季活动收款',
      category: 'custom',
      startDateTime: '2026-11-27T18:00',
      location: '测试宴会厅',
    }, 'custom')

    expect(info).toMatchObject({
      eventName: '秋季活动收款',
      timeLabel: '事项日期',
      time: '2026年11月27日 18:00',
      location: '测试宴会厅',
      category: 'custom',
      seal: '记',
    })
  })

  it('红事优先使用正期时间和对应称谓', () => {
    const info = guestQrPosterInfo({
      name: '张府喜宴',
      template: 'wedding',
      ceremonyAt: '2026-12-08T12:08',
      startDateTime: '2026-12-07T08:00',
      location: '芙蓉厅',
    }, 'red')

    expect(info.timeLabel).toBe('婚礼时间')
    expect(info.time).toContain('2026年12月8日 12:08')
    expect(info.seal).toBe('礼')
  })

  it('缺失时间和地址时给出可保存的提示文案', () => {
    const info = guestQrPosterInfo({ name: '宾客登记' }, 'white')
    expect(info.time).toBe('以主家通知为准')
    expect(info.location).toBe('地址以主家通知为准')
    expect(info.seal).toBe('奠')
  })
})
