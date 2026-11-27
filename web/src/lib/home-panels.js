// 设置里的二级面板：按需加载组件，避免首屏体积变大。
import { openModal } from './modal.js'
import { safeImport } from './lazy.js'

async function openComponent(name, title, size = 'default') {
  const mod = await safeImport(() => import('../components/dialogs.js'), name)
  if (!mod) return
  const component = mod[name]
  if (!component) return
  openModal(title, { type: 'component', component }, [], { size, dismissable: true })
}

export function showFamilySettings() {
  return openComponent('FamilySettingsPanel', '家庭设置')
}

export function showFamilyArchives() {
  return openComponent('FamilyArchivePanel', '家庭归档', 'large')
}

export function showFamilyOverview() {
  return openComponent('FamilyOverviewPanel', '家庭总览', 'large')
}

export function showAuditLog() {
  return openComponent('AuditPanel', '操作记录', 'large')
}

export function showAboutPanel() {
  return openComponent('AboutPanel', '本机与关于')
}

export function showBackupHealth() {
  return openComponent('BackupHealthCenter', '备份健康中心', 'large')
}

export function showCategorySettings() {
  return openComponent('CategorySettingsPanel', '首页分类')
}
