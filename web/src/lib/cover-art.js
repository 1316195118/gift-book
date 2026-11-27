import redWeddingPhoenix from '../assets/covers/red-wedding-phoenix-warm.webp'
import redLongevityPine from '../assets/covers/red-longevity-pine.webp'
import redHouseLattice from '../assets/covers/red-house-lattice-warm.webp'
import redPeonyBrocade from '../assets/covers/red-peony-brocade.webp'
import whiteChrysanthemum from '../assets/covers/white-chrysanthemum-v2.webp'
import whitePineMist from '../assets/covers/white-pine-mist.webp'

// 底图只负责绸缎、漆面、花鸟和山水的质感；标题、场景文字、印章仍由程序实时绘制。
// 这样既保留原创绘画的层次，也不会把生成式图片里的错字带进账簿或 PDF。
export const COVER_ARTWORK = {
  phoenix: {
    src: redWeddingPhoenix,
    focus: '50% 45%',
    tone: 'vermilion',
  },
  longevity: {
    src: redLongevityPine,
    focus: '50% 43%',
    tone: 'cinnabar',
  },
  lattice: {
    src: redHouseLattice,
    focus: '50% 48%',
    tone: 'lacquer',
  },
  peony: {
    src: redPeonyBrocade,
    focus: '50% 46%',
    tone: 'rouge',
  },
  chrysanthemum: {
    src: whiteChrysanthemum,
    focus: '50% 46%',
    tone: 'ivory',
  },
  mist: {
    src: whitePineMist,
    focus: '50% 45%',
    tone: 'moon',
  },
}

// 旧账簿只保存样式 ID。底图映射集中在这里，新增封面不改变既有数据格式。
export const COVER_STYLE_ARTWORK = {
  shuangxi: { art: 'phoenix', panel: 'gold', ornament: 'union' },
  lihe: { art: 'peony', panel: 'brocade', ornament: 'ribbon' },
  wujia: { art: 'lattice', panel: 'vertical', ornament: 'cloud' },
  manyue: { art: 'peony', panel: 'vertical', ornament: 'fullmoon' },
  duanmian: { art: 'peony', panel: 'plain', ornament: 'silk' },
  chanzhi: { art: 'peony', panel: 'vine', ornament: 'vine' },
  longfeng: { art: 'phoenix', panel: 'gold', ornament: 'phoenix' },
  huakai: { art: 'peony', panel: 'blossom', ornament: 'blossom' },
  bairi: { art: 'peony', panel: 'vertical', ornament: 'baby' },
  huimen: { art: 'phoenix', panel: 'ribbon', ornament: 'ribbon' },
  xieshi: { art: 'lattice', panel: 'vertical', ornament: 'scholar' },
  wufu: { art: 'longevity', panel: 'gold', ornament: 'cloud' },
  jinyu: { art: 'phoenix', panel: 'brocade', ornament: 'union' },
  mantang: { art: 'peony', panel: 'vertical', ornament: 'blossom' },
  tongxin: { art: 'phoenix', panel: 'plain', ornament: 'knot' },
  qianxi: { art: 'lattice', panel: 'plain', ornament: 'door' },
  sujuan: { art: 'chrysanthemum', panel: 'plain', ornament: 'silk' },
  baiju: { art: 'chrysanthemum', panel: 'gold', ornament: 'chrysanthemum' },
  liantai: { art: 'mist', panel: 'vertical', ornament: 'lotus' },
  suju: { art: 'chrysanthemum', panel: 'brocade', ornament: 'chrysanthemum' },
  songbai: { art: 'mist', panel: 'vertical', ornament: 'pine' },
  qingyan: { art: 'mist', panel: 'plain', ornament: 'smoke' },
  changsi: { art: 'mist', panel: 'gold', ornament: 'moon' },
  yuanshan: { art: 'mist', panel: 'brocade', ornament: 'mountain' },
  qingzhu: { art: 'mist', panel: 'plain', ornament: 'bamboo' },
  qiulu: { art: 'chrysanthemum', panel: 'blossom', ornament: 'dew' },
  qiusheng: { art: 'chrysanthemum', panel: 'vertical', ornament: 'wind' },
  huaien: { art: 'mist', panel: 'ribbon', ornament: 'moon' },
  'custom-paper': { art: 'mist', panel: 'plain', ornament: 'paper' },
  'custom-bamboo': { art: 'mist', panel: 'vertical', ornament: 'bamboo' },
  'custom-cloud': { art: 'lattice', panel: 'gold', ornament: 'cloud' },
  'custom-silk': { art: 'mist', panel: 'ribbon', ornament: 'silk' },
}

export function coverArtworkFor(style = {}) {
  const selected = COVER_STYLE_ARTWORK[style.id] || COVER_STYLE_ARTWORK.shuangxi
  return {
    ...COVER_ARTWORK[selected.art],
    ...selected,
  }
}
