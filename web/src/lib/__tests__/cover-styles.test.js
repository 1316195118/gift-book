import { describe, expect, it } from 'vitest'
import {
  COVER_MOTIFS,
  COVER_STYLES,
  RED_TEMPLATES,
  TEMPLATE_DEFAULT_STYLE,
  WHITE_TEMPLATES,
} from '../content.js'
import { renderCoverMarkup } from '../cover.js'
import { COVER_STYLE_ARTWORK, coverArtworkFor } from '../cover-art.js'

describe('封面款式目录', () => {
  it('红事和白事款式完整且编号唯一', () => {
    expect(COVER_STYLES.filter((style) => style.theme === 'red')).toHaveLength(16)
    expect(COVER_STYLES.filter((style) => style.theme === 'white')).toHaveLength(12)
    expect(new Set(COVER_STYLES.map((style) => style.id)).size).toBe(COVER_STYLES.length)
  })

  it('每个模板都有匹配主题且互不重复的默认封面', () => {
    for (const [category, templates, theme] of [
      ['red', RED_TEMPLATES, 'red'],
      ['white', WHITE_TEMPLATES, 'white'],
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

  it('每款封面都使用已登记的原创绘画底图且保留可替换的书名', () => {
    for (const style of COVER_STYLES) {
      expect(COVER_STYLE_ARTWORK[style.id], style.id).toBeTruthy()
      const artwork = coverArtworkFor(style)
      expect(artwork.src, style.id).toMatch(/\.(?:webp|png)(?:\?|$)/)
      const html = renderCoverMarkup({ template: style.theme === 'white' ? 'baishi' : 'wedding', coverStyle: style.id }, true, style.theme)
      expect(html, style.id).toContain('class="cover-art"')
      expect(html, style.id).toContain('data-cover-src=')
      expect(html, style.id).toContain('cover-title-panel')
      expect(html, style.id).toContain('alt=""')
      expect(html, style.id).not.toContain('<script')
    }
  })
})
