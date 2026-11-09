// 模板选择页（原生 JS，零第三方依赖）。
import { state as st, subscribe } from '../store.js'
import { CATEGORY_TEXT, templatesFor } from '../lib/content.js'
import { renderCoverMarkup } from '../lib/cover.js'
import { showHome, showSetup } from '../bootstrap.js'

function coverFor(key) {
  return renderCoverMarkup(
    { theme: st.homeCategory === 'white' ? 'theme-solemn' : 'theme-festive', template: key },
    true,
    st.homeCategory,
  )
}

const SKELETON = `
<div id="template-screen" class="home-screen-wrap">
  <div class="home-inner">
    <div class="back-link" id="tpl-back">← 返回首页</div>
    <div class="home-hero">
      <div class="hero-copy">
        <div class="eyebrow" id="tpl-eyebrow"></div>
        <h1 id="tpl-title">选择模板</h1>
        <div class="sub" id="tpl-sub">选一个最接近的场景，名称与封面会自动带出，之后仍可随时修改。</div>
      </div>
    </div>
    <div id="template-grid" class="tpl-grid"></div>
  </div>
</div>`

export function mountTemplate(root) {
  root.innerHTML = SKELETON
  const $ = (id) => root.querySelector(id)

  const render = () => {
    const ct = CATEGORY_TEXT[st.homeCategory]
    $('#tpl-eyebrow').textContent = ct.tplEyebrow
    const templates = templatesFor(st.homeCategory)
    $('#template-grid').innerHTML = templates
      .map(
        (t) => `
        <div class="tpl-card" data-tpl="${t.key}" role="button" tabindex="0" aria-label="使用${t.name}模板">
          <div class="tpl-cover">${coverFor(t.key)}</div>
          <div class="tpl-body">
            <div class="tpl-tag">${t.sub}</div>
            <h3>${t.name}</h3>
            <p>${t.desc}</p>
            <div class="use">使用此模板</div>
          </div>
        </div>`,
      )
      .join('')
  }

  $('#tpl-back').addEventListener('click', showHome)
  $('#template-grid').addEventListener('click', (e) => {
    const card = e.target.closest('.tpl-card')
    if (card) showSetup({ template: card.dataset.tpl })
  })
  $('#template-grid').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const card = e.target.closest('.tpl-card')
    if (card) { e.preventDefault(); showSetup({ template: card.dataset.tpl }) }
  })

  render()
  const unsub = subscribe(render)
  return {
    unmount() {
      unsub()
    },
  }
}
