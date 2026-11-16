// 家庭备份面板：只处理当前家庭的导出与还原。
import { openModal } from './modal.js'
import { safeImport } from './lazy.js'

export async function showFamilyBackup() {
  const mod = await safeImport(() => import('../components/dialogs.js'), '家庭备份')
  if (!mod) return
  const { FamilyBackupPanel } = mod
  openModal('家庭备份', { type: 'component', component: FamilyBackupPanel }, [
    { text: '关闭', class: 'modal-btn-ghost' },
  ], { size: 'default', dismissable: true })
}
