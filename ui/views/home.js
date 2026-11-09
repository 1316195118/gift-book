// 首页（原生 JS，零第三方依赖）。
import { state as st, subscribe } from '../store.js'
import { CATEGORY_TEXT, RED_TEMPLATES, WHITE_TEMPLATES, copyOf, isSolemnEvent } from '../lib/content.js'
import { escapeHtml } from '../lib/crypto.js'
import { info } from '../lib/feedback.js'
import {
  showTemplates, showSetup, showHelpDialog, openEvent, versionLabel, showChangelog,
  showAccessModal, showAutoBackupModal, logout, showNetworkDetails, switchCategory, toggleLargeText,
} from '../lib/actions.js'
import { netState as net } from '../lib/network.js'
import { queueFor } from '../lib/offline.js'

const masked = new Set()

const TRUST_SVGS = {
  local: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="4" width="16" height="6" rx="2" /><rect x="4" y="14" width="16" height="6" rx="2" /><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6" stroke-linecap="round" /></svg>',
  crypto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" stroke-linecap="round" /></svg>',
  export: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" stroke-linecap="round" stroke-linejoin="round" /></svg>',
}

function recentEvents() {
  const wantSolemn = st.homeCategory === 'white'
  return Object.values(st.cachedEvents || {})
    .filter((ev) => isSolemnEvent(ev, st.homeCategory) === wantSolemn)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 12)
}

function pendingFor(eventId) {
  return queueFor(eventId).length
}

function displayIdOf(ev) {
  return String(ev.displayId || '').padStart(3, '0').slice(-3)
}

function createdText(ev) {
  return ev.createdAt ? String(ev.createdAt).slice(0, 10).replace(/-/g, '/') : ''
}

function templateLabel(ev) {
  const raw = String(ev.template || '').trim()
  if (!raw) return isSolemnEvent(ev, st.homeCategory) ? '白事' : '红事'
  const hit = [...RED_TEMPLATES, ...WHITE_TEMPLATES].find((t) => t.key === raw || t.name === raw)
  return hit ? hit.name : raw
}

function homeCount() {
  const wantSolemn = st.homeCategory === 'white'
  return Object.values(st.cachedEvents || {}).filter((ev) => isSolemnEvent(ev, st.homeCategory) === wantSolemn).length
}

function recentMarkup() {
  const list = recentEvents()
  const isSolemn = st.homeCategory === 'white'
  if (!list.length) {
    return `<div class="recent-empty">还没有${isSolemn ? '白事' : '红事'}账簿，点击「创建新账簿」开始第一本。</div>`
  }
  return list
    .map((ev) => {
      const pending = pendingFor(ev.id)
      const maskedOn = masked.has(ev.id)
      // 账簿名、地点、模板都来自用户输入；原生模板字符串不会像 Vue 那样自动转义。
      const id = escapeHtml(ev.id)
      const name = escapeHtml(ev.name || '未命名账簿')
      const tmpl = escapeHtml(ev.template || '')
      const loc = escapeHtml(ev.location || '')
      return `
      <div class="recent-item ${isSolemnEvent(ev, st.homeCategory) ? 'white' : 'red'}" role="button" tabindex="0" data-event="${id}">
        <div class="recent-body">
          <div class="recent-top">
            <div class="rn">${name}</div>
            <div class="recent-meta">
              ${pending ? `<span class="recent-pending-badge">待同步 ${pending}</span>` : ''}
              ${ev.displayId ? `<span class="ledger-no">No.${escapeHtml(displayIdOf(ev))}</span>` : ''}
            </div>
          </div>
          <div class="rd">
            <span class="rd-date">${escapeHtml(createdText(ev))}</span>
            ${tmpl ? `<span class="rd-dot">·</span><span>${tmpl}</span>` : ''}
            ${loc ? `<span class="rd-dot">·</span><span class="rd-loc">${loc}</span>` : ''}
          </div>
          <div class="rfoot">
            <span class="rtag">${escapeHtml(templateLabel(ev))}</span>
            <div class="recent-money">
              <span class="rm-value ${maskedOn ? 'hidden' : ''}"><span class="rm-count">${countText(ev)}</span><span class="rm-amount">${amountText(ev)}</span></span>
              <span class="rm-mask ${maskedOn ? '' : 'hidden'}"><span>••• 人</span><span>¥••••</span></span>
              <button type="button" class="eye-btn" aria-pressed="${maskedOn}" aria-label="${maskedOn ? '显示金额与人数' : '隐藏金额与人数'}" data-eye="${id}">
                ${maskedOn
                  ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 3l18 18" /><path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.3 6.9A16.6 16.6 0 0 0 2 12s3.5 6 10 6a10.7 10.7 0 0 0 5.4-1.4" /></svg>'
                  : '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.6" /></svg>'}
              </button>
            </div>
          </div>
        </div>
      </div>`
    })
    .join('')
}

function countText(ev) {
  const value = Number(ev.giftCount ?? ev.totalGivers)
  return Number.isFinite(value) ? `${value.toLocaleString('zh-CN')} 人` : '— 人'
}

function amountText(ev) {
  const total = Number(ev.totalAmount)
  if (ev.totalAmount === undefined || ev.totalAmount === null || isNaN(total)) return '¥0.00'
  return `¥${total.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const SKELETON = `
<div id="home-screen" class="home-screen-wrap">
  <div class="home-inner">
    <header class="home-topbar">
      <div class="home-brand"><span class="seal">礼</span><span>电子礼簿</span></div>
      <div class="cat-switch" id="cat-switch" role="tablist" aria-label="事项分类">
        <button type="button" class="cat-btn" data-cat="red" role="tab">红事</button>
        <button type="button" class="cat-btn" data-cat="white" role="tab">白事</button>
      </div>
      <div class="home-top-actions">
        <button type="button" class="net-chip" id="net-chip"><span class="net-dot" aria-hidden="true"></span><span class="net-text"></span><span class="net-label" aria-hidden="true">存储</span></button>
        <button type="button" class="version-chip" id="version-chip" title="查看更新说明">v--</button>
        <button type="button" class="home-help-btn large-text-toggle" id="large-text-btn">大字</button>
        <button type="button" class="home-help-btn" id="autobackup-btn">备份</button>
        <button type="button" class="home-help-btn" id="access-btn">访问保护</button>
        <button type="button" class="home-help-btn" id="logout-btn" style="display:none">退出</button>
      </div>
    </header>

    <section class="home-hero">
      <div class="hero-copy">
        <div class="eyebrow" id="home-eyebrow"></div>
        <h1 id="home-title"></h1>
        <div class="sub" id="home-sub"></div>
      </div>
      <div class="home-trust" aria-label="本地部署、加密存储、便捷导出">
        <span>${TRUST_SVGS.local}本地部署</span>
        <span>${TRUST_SVGS.crypto}加密存储</span>
        <span>${TRUST_SVGS.export}便捷导出</span>
      </div>
    </section>

    <div class="choice-grid">
      <div class="choice-card" id="home-main-card" role="button" tabindex="0" aria-label="选择礼簿模板">
        <div class="hero-book-art" aria-hidden="true">
          <div class="book">
            <div class="book-pages"></div>
            <div class="book-cover">
              <div class="book-stitch"></div>
              <div class="book-frame">
                <span class="book-edition" id="book-edition"></span>
                <span class="book-seal" id="book-seal"></span>
                <span class="book-title">礼簿</span>
                <span class="book-rule"></span>
                <span class="book-sub" id="book-sub"></span>
              </div>
            </div>
          </div>
        </div>
        <div>
          <div class="choice-kicker" id="choice-kicker"></div>
          <div class="choice-title" id="choice-title"></div>
          <div class="choice-desc" id="choice-desc"></div>
          <div class="choice-count" id="choice-count"></div>
        </div>
        <div class="choice-go" id="choice-go"></div>
      </div>

      <aside class="home-side" aria-label="使用提示">
        <div class="home-side-kicker">三步开始</div>
        <ol class="home-side-steps">
          <li><span>01</span><div><b>选择场景</b><small id="step-scene"></small></div></li>
          <li><span>02</span><div><b>建立账簿</b><small>填写起止时间与地点，管理密码可选</small></div></li>
          <li><span>03</span><div><b>登记与导出</b><small id="step-entry"></small></div></li>
        </ol>
        <button type="button" class="home-side-help" id="help-btn">查看完整使用说明</button>
      </aside>
    </div>

    <div class="section-head recent-head">
      <div class="recent-head-title">
        <h2>最近账簿</h2>
        <span class="section-note">打开后自动汇总金额与人数</span>
      </div>
      <div class="recent-nav" id="recent-nav">
        <span class="recent-nav-hint">左右滑动查看</span>
        <button type="button" class="recent-arrow" id="recent-prev" aria-label="上一组账簿" disabled>‹</button>
        <button type="button" class="recent-arrow" id="recent-next" aria-label="下一组账簿" disabled>›</button>
      </div>
    </div>

    <div id="recent-events" class="recent-list"></div>

    <div class="home-bottom">
      <p>一笔一份心意，一簿一段时光。</p>
      <button id="home-create-btn" class="home-create-btn">＋ 创建新账簿</button>
    </div>

    <footer class="home-footer"><span>本地部署 · 自主管理</span><span>建议定期导出，妥善留存每一份记录</span></footer>
  </div>
</div>`

export function mountHome(root) {
  root.innerHTML = SKELETON
  const $ = (id) => root.querySelector(id)

  const recentEl = $('#recent-events')
  const catBtns = root.querySelectorAll('.cat-btn')
  const copy = () => copyOf(null, st.homeCategory)
  const catText = () => CATEGORY_TEXT[st.homeCategory]
  const isSolemn = () => st.homeCategory === 'white'

  // 网络探测每 15 秒触发一次订阅；卡片内容没变就不要重建，
  // 否则正在横向滚动的列表会跳动、金额遮罩状态也会被打断。
  let lastRecentHtml = ''
  const renderRecent = () => {
    const html = recentMarkup()
    if (html !== lastRecentHtml) {
      recentEl.innerHTML = html
      lastRecentHtml = html
    }
  }

  const syncArrows = () => {
    if (!recentEl) return
    $('#recent-prev').disabled = recentEl.scrollLeft <= 1
    $('#recent-next').disabled = recentEl.scrollLeft + recentEl.clientWidth >= recentEl.scrollWidth - 1
  }
  const scrollRecent = (dir) => {
    if (!recentEl) return
    recentEl.scrollBy({ left: dir * (recentEl.clientWidth || 320), behavior: 'smooth' })
    setTimeout(syncArrows, 320)
  }

  const update = () => {
    const ct = catText()
    const cp = copy()
    // 顶栏
    catBtns.forEach((b) => b.classList.toggle('active', b.dataset.cat === st.homeCategory))
    const chip = $('#net-chip')
    chip.className = `net-chip is-${net.health.level}`
    chip.querySelector('.net-text').textContent = net.health.text
    $('#version-chip').textContent = `v${versionLabel()}`
    $('#large-text-btn').textContent = st.largeText ? '标准字号' : '大字'
    $('#large-text-btn').setAttribute('aria-pressed', String(st.largeText))
    $('#access-btn').textContent = st.authEnabled ? '访问保护 · 开' : '访问保护'
    $('#logout-btn').style.display = st.authEnabled ? '' : 'none'
    // hero
    $('#home-eyebrow').textContent = ct.eyebrow
    $('#home-title').textContent = ct.title
    $('#home-sub').textContent = ct.sub
    // 卡片
    $('#book-edition').textContent = isSolemn() ? '肃 穆 礼 记' : '喜 事 礼 记'
    $('#book-seal').textContent = isSolemn() ? '奠' : '囍'
    $('#book-sub').textContent = isSolemn() ? '肃 · 穆 · 记' : '壹 · 叁'
    $('#choice-kicker').textContent = ct.kicker
    $('#choice-title').textContent = ct.cardTitle
    $('#choice-desc').textContent = ct.cardDesc
    $('#choice-count').textContent = `${homeCount()} 本账簿`
    $('#choice-go').textContent = ct.go
    $('#step-scene').textContent = cp.stepScene
    $('#step-entry').textContent = cp.stepEntry
    // 最近
    renderRecent()
    syncArrows()
  }

  // 事件
  root.querySelector('#cat-switch').addEventListener('click', (e) => {
    const btn = e.target.closest('.cat-btn')
    if (btn) switchCategory(btn.dataset.cat)
  })
  $('#net-chip').addEventListener('click', showNetworkDetails)
  $('#version-chip').addEventListener('click', showChangelog)
  $('#large-text-btn').addEventListener('click', () => {
    info(st.largeText ? '已恢复标准字号' : '已开启大字模式', { duration: 1800 })
    toggleLargeText()
  })
  $('#autobackup-btn').addEventListener('click', showAutoBackupModal)
  $('#access-btn').addEventListener('click', showAccessModal)
  $('#logout-btn').addEventListener('click', logout)
  $('#home-main-card').addEventListener('click', () => showTemplates(st.homeCategory))
  $('#home-main-card').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showTemplates(st.homeCategory) }
  })
  $('#help-btn').addEventListener('click', showHelpDialog)
  $('#home-create-btn').addEventListener('click', () => showSetup())
  $('#recent-prev').addEventListener('click', () => scrollRecent(-1))
  $('#recent-next').addEventListener('click', () => scrollRecent(1))
  recentEl.addEventListener('click', (e) => {
    const eye = e.target.closest('[data-eye]')
    if (eye) {
      const id = eye.dataset.eye
      if (masked.has(id)) masked.delete(id)
      else masked.add(id)
      update()
      return
    }
    const item = e.target.closest('[data-event]')
    if (item) openEvent(item.dataset.event)
  })
  recentEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    const item = e.target.closest('[data-event]')
    if (item) openEvent(item.dataset.event)
  })
  recentEl.addEventListener('scroll', syncArrows, { passive: true })
  window.addEventListener('resize', syncArrows)

  update()
  const unsub = subscribe(update)
  return {
    unmount() {
      unsub()
      window.removeEventListener('resize', syncArrows)
    },
  }
}
