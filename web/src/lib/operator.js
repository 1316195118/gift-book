// 轻量操作人标识：只保存在本机，并随礼金一起进入加密载荷。
// 它不是账号或权限系统，用于多人共用一个家庭时说明“谁录的、谁改的”。
import { openModal, closeModal, afterModalRender } from './modal.js'
import { escapeHtml } from './format.js'

const RECENT_LIMIT = 6
const MAX_OPERATOR_LENGTH = 20

const storageSuffix = (familyId) => String(familyId || 'default')
const currentKey = (familyId) => `gb-operator:${storageSuffix(familyId)}`
const recentKey = (familyId) => `gb-operators:${storageSuffix(familyId)}`

export function normalizeOperator(value, fallback = '本机') {
  const text = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, MAX_OPERATOR_LENGTH)
  return text || fallback
}

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null')
    return value ?? fallback
  } catch {
    return fallback
  }
}

export function recentOperators(familyId) {
  const list = readJson(recentKey(familyId), [])
  if (!Array.isArray(list)) return []
  return [...new Set(list.map((name) => normalizeOperator(name, '')).filter(Boolean))].slice(0, RECENT_LIMIT)
}

export function currentOperator(familyId) {
  let saved = ''
  try {
    saved = localStorage.getItem(currentKey(familyId)) || ''
  } catch {
    /* 隐私模式下使用默认值 */
  }
  return normalizeOperator(saved, recentOperators(familyId)[0] || '本机')
}

export function rememberOperator(name, familyId) {
  const normalized = normalizeOperator(name)
  const recent = [normalized, ...recentOperators(familyId).filter((item) => item !== normalized)].slice(0, RECENT_LIMIT)
  try {
    localStorage.setItem(currentKey(familyId), normalized)
    localStorage.setItem(recentKey(familyId), JSON.stringify(recent))
  } catch {
    /* 隐私模式忽略；本次输入仍由调用方保留 */
  }
  return normalized
}

export function openOperatorPicker(familyId, onSelect = () => {}) {
  const active = currentOperator(familyId)
  const recent = recentOperators(familyId)
  const options = [...new Set([active, ...recent, '本机'])].filter(Boolean)
  const html = `
    <div class="gb-operator-picker">
      <p class="gb-picker-intro">多人共用同一本礼簿时，用操作人区分录入与修改记录。名称只保存在本机，并随账簿内容一起加密。</p>
      <label class="field-label" for="gb-operator-name">本次操作人</label>
      <input id="gb-operator-name" type="text" maxlength="20" value="${escapeHtml(active)}" autocomplete="off" placeholder="如：新郎、记账员小周" />
      <div class="gb-operator-quick" aria-label="最近使用">
        ${options.map((name) => `<button type="button" data-operator-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join('')}
      </div>
      <p class="field-hint">不会作为登录凭据，也不会保存到服务器明文；旧记录会显示“未记录”。</p>
    </div>`
  openModal('当前操作人', { type: 'html', html }, [
    { text: '取消', class: 'modal-btn-ghost' },
    {
      text: '使用此名称',
      class: 'modal-btn-primary',
      keepOpen: true,
      handler: () => {
        const value = document.getElementById('gb-operator-name')?.value
        const selected = rememberOperator(value, familyId)
        onSelect(selected)
        closeModal()
      },
    },
  ], { dismissable: true })
  afterModalRender(() => {
    document.querySelectorAll('[data-operator-name]').forEach((button) => {
      button.addEventListener('click', () => {
        const input = document.getElementById('gb-operator-name')
        if (input) input.value = button.dataset.operatorName || ''
        input?.focus()
      })
    })
  })
}

export { MAX_OPERATOR_LENGTH }
