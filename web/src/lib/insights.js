// 低频分析面板：按需加载，不进入记账首屏依赖。
import { openModal } from './modal.js'
import { safeImport } from './lazy.js'

async function openComponent(loader, label, title, size = 'large') {
  const mod = await safeImport(loader, label)
  if (!mod?.default) return
  openModal(title, { type: 'component', component: mod.default }, [], { size, dismissable: true })
}

export function openReviewQueue() {
  return openComponent(() => import('../components/ReviewQueuePanel.vue'), '异常核对', '异常核对')
}

export function openGuestProfiles() {
  return openComponent(() => import('../components/GuestProfilePanel.vue'), '来宾档案', '跨账簿来宾档案', 'large')
}

export function openAnnualReport() {
  return openComponent(() => import('../components/AnnualReportPanel.vue'), '年度人情报告', '年度人情报告', 'large')
}

export function openBackupHealth() {
  return openComponent(() => import('../components/BackupHealthCenter.vue'), '备份健康中心', '备份健康中心', 'large')
}
