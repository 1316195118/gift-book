// 更新说明：只写用户能感知的结果（优化了什么 / 修复了什么 / 新增了什么），不写实现细节。
// v1.0.x 的旧版记录（history）按原样存档，不再改写。
import history from './changelog-history.json'

export const APP_VERSION = '2.4.60'

const LOG_TAG = { feat: '新增', fix: '修复', sec: '安全', opt: '优化' }

const CURRENT = []
export const CHANGELOG = [...CURRENT, ...history]

export function renderLogEntries(entries) {
  return entries
    .map(
      (entry) => `
      <div class="log-entry">
        <div class="log-head">
          <b>v${entry.version}</b>
          <span class="log-date">${entry.date}</span>
        </div>
        <ul class="log-list">
          ${entry.notes.map((n) => `<li><span class="log-tag log-tag-${n.t}">${LOG_TAG[n.t] || '变更'}</span><span>${n.text}</span></li>`).join('')}
        </ul>
      </div>`,
    )
    .join('')
}

export function renderChangelog() {
  return `
    <div class="log-wrap">${renderLogEntries(CHANGELOG)}</div>
    <p class="hint" style="margin-top:14px">当前版本 v${APP_VERSION} · 发布源 单文件 / Docker / GHCR 镜像</p>
    <p class="hint" style="margin-top:6px">© 2026 Gift Book contributors · MIT License · 运行时依赖 Vue 3 (MIT)</p>`
}
