import { describe, expect, it } from 'vitest'
import {
  COVER_MOTIFS,
  COVER_STYLES,
  CUSTOM_TEMPLATES,
  RED_TEMPLATES,
  TEMPLATE_DEFAULT_STYLE,
  WHITE_TEMPLATES,
  categoryForEvent,
  getCoverStyle,
  isHumanLedgerEvent,
} from '../content.js'
import { renderCoverMarkup } from '../cover.js'
import { COVER_STYLE_ARTWORK, coverArtworkFor } from '../cover-art.js'

describe('封面款式目录', () => {
  it('红事和白事款式完整且编号唯一', () => {
    expect(COVER_STYLES.filter((style) => style.theme === 'red')).toHaveLength(16)
    expect(COVER_STYLES.filter((style) => style.theme === 'white')).toHaveLength(12)
    expect(COVER_STYLES.filter((style) => style.theme === 'custom')).toHaveLength(4)
    expect(new Set(COVER_STYLES.map((style) => style.id)).size).toBe(COVER_STYLES.length)
  })

  it('每个模板都有匹配主题且互不重复的默认封面', () => {
    for (const [category, templates, theme] of [
      ['red', RED_TEMPLATES, 'red'],
      ['white', WHITE_TEMPLATES, 'white'],
      ['custom', CUSTOM_TEMPLATES, 'custom'],
    ]) {
      const styleIds = templates.map((template) => TEMPLATE_DEFAULT_STYLE[template.key])
      expect(new Set(styleIds).size).toBe(templates.length)
      for (const styleId of styleIds) {
        expect(COVER_STYLES.some((style) => style.id === styleId && style.theme === theme), styleId).toBe(true)
      }
      for (const template of templates) {
        expect(COVER_MOTIFS[template.key], template.key).toContain('cover-motif')
        const html = renderCoverMarkup({ template: template.key }, true, category)
        expect(html).toContain(`data-style="${TEMPLATE_DEFAULT_STYLE[template.key]}"`)
        expect(html).toContain(`data-template="${template.key}"`)
        expect(html).toContain('cover-motif')
      }
    }
  })

  it('自定义模板预览直接显示业务名称，不追加礼簿', () => {
    const html = renderCoverMarkup({ template: '活动收款' }, true, 'custom')
    expect(html).toContain('data-theme="custom"')
    expect(html).toContain('data-style="custom-paper"')
    expect(html).toContain('活动收款')
    expect(html).not.toContain('活动收款礼簿')
  })

  it('已保存账簿按自身数据归属，不继承首页当前分类', () => {
    const red = { id: 'red-ledger', name: '婚宴', template: '婚宴', coverStyle: 'shuangxi' }
    const white = { id: 'white-ledger', name: '追思会', coverStyle: 'sujuan' }
    const custom = { id: 'custom-ledger', name: '活动收款', template: '活动收款', coverStyle: 'custom-paper' }

    expect(categoryForEvent(red, 'custom')).toBe('red')
    expect(categoryForEvent(white, 'custom')).toBe('white')
    expect(categoryForEvent(custom, 'red')).toBe('custom')
    expect(categoryForEvent({ id: 'legacy-custom', coverStyle: 'custom-bamboo' }, 'red')).toBe('custom')
    expect(categoryForEvent({ id: 'legacy-white', coverStyle: 'baiju' }, 'red')).toBe('white')
  })

  it('只有未保存的新建预览才使用首页当前分类兜底', () => {
    expect(categoryForEvent({ name: '正在编辑' }, 'custom')).toBe('custom')
    expect(categoryForEvent({ name: '正在编辑' }, 'white')).toBe('white')
  })

  it('自定义账簿不进入人情往来统计', () => {
    expect(isHumanLedgerEvent({ id: 'custom', category: 'custom' })).toBe(false)
    expect(isHumanLedgerEvent({ id: 'red', category: 'red' })).toBe(true)
    expect(isHumanLedgerEvent({ id: 'white', category: 'white' })).toBe(true)
  })

  it('旧白事账簿即使缺少分类也保留肃穆封面语义', () => {
    const html = renderCoverMarkup({ id: 'legacy-white', coverStyle: 'sujuan' }, true)
    expect(html).toContain('data-theme="white"')
    expect(html).toContain('ledger-cover solemn')
  })

  it('每款封面都使用已登记的原创绘画底图且保留可替换的书名', () => {
    for (const style of COVER_STYLES) {
      expect(COVER_STYLE_ARTWORK[style.id], style.id).toBeTruthy()
      const artwork = coverArtworkFor(style)
      expect(artwork.src, style.id).toMatch(/\.(?:webp|png)(?:\?|$)/)
      const template = style.theme === 'white' ? 'baishi' : style.theme === 'custom' ? '活动收款' : 'wedding'
      const html = renderCoverMarkup({ template, coverStyle: style.id }, true, style.theme)
      expect(html, style.id).toContain('class="cover-art"')
      expect(html, style.id).toContain('data-cover-src=')
      expect(html, style.id).toContain('cover-title-panel')
      expect(html, style.id).toContain('alt=""')
      expect(html, style.id).not.toContain('<script')
    }
  })

  it('需要暖色修正的底图使用无纯黑暗部的生产版本', () => {
    expect(coverArtworkFor(getCoverStyle({ template: 'wedding' })).src).toContain('red-wedding-phoenix-warm')
    expect(coverArtworkFor(getCoverStyle({ template: 'housewarming' })).src).toContain('red-house-lattice-warm')
  })
})
