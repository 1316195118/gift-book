// 弹窗/表单共用的字段结构片段。所有面板用同一套 class，样式集中在 fields.css。
export const label = (forId, text, extra = '') =>
  `<label for="${forId}" class="field-label">${text}${extra}</label>`

export const hint = (text) => `<p class="field-hint">${text}</p>`

// 带单位或图标的输入外壳
export const shell = ({ icon = '', suffix = '', input = '' } = {}) =>
  `<div class="field-shell">${icon}${input}${suffix ? `<span class="field-suffix">${suffix}</span>` : ''}</div>`

export const ICON_USER = '<svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M4.8 19.5c.9-3.4 3.7-5.3 7.2-5.3s6.3 1.9 7.2 5.3"/></svg>'
export const ICON_PIN = '<svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 21s6.5-5.4 6.5-10.2A6.5 6.5 0 0 0 5.5 10.8C5.5 15.6 12 21 12 21Z"/><circle cx="12" cy="10.6" r="2.4"/></svg>'
export const ICON_NOTE = '<svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 5.5h14M5 10h14M5 14.5h9M5 19h6"/></svg>'
export const ICON_LOCK = '<svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7M12 14.4v2.6"/></svg>'
export const ICON_MONEY = '<svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M7 5.5h10M7 9.5h10M12 5.5v13M9 18.5h6M8.5 9.5 12 14l3.5-4.5"/></svg>'
