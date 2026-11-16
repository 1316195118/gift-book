// 首页设置：按「数据 / 安全 / 家庭 / 关于」分组，避免按钮越堆越多。
import { state as st } from '../store.js'
import { openModal, closeModal, afterModalRender, confirm } from './modal.js'
import { showAutoBackupModal, showAccessModal, logout } from './actions.js'
import { showTrashModal } from './trash.js'
import { showFamilyAdmin } from './family-admin.js'
import { showFamilyBackup } from './family-backup.js'
import { showFamilySettings, showFamilyArchives, showFamilyOverview, showAuditLog, showAboutPanel } from './home-panels.js'
import { escapeHtml } from './crypto.js'

const ICONS = {
  backup: '<path d="M4 7h16v12H4z"/><path d="M4 7l2-3h12l2 3"/><path d="M9 12h6"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v9h14v-9"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  archive: '<rect x="3" y="4" width="18" height="5"/><path d="M5 9v11h14V9"/><path d="M10 13h4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9"/><path d="M16 4l4 4"/>',
  shield: '<path d="M12 3l8 4v6c0 5-4 8-8 9-4-1-8-4-8-9V7z"/><path d="M9 12l2 2 4-4"/>',
  exit: '<path d="M10 5H5v14h5"/><path d="M15 8l4 4-4 4"/><path d="M19 12H9"/>',
  family: '<circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M15 20c0-2 2-4 5-4"/>',
  overview: '<rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="5"/><rect x="13" y="10" width="8" height="11"/><rect x="3" y="13" width="8" height="8"/>',
  audit: '<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7h.01"/>',
}

function icon(name) {
  return `<span class="gb-settings-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.about}</svg></span>`
}

function item(act, title, desc, iconName, danger = false) {
  return { act, title, desc, iconName, danger }
}

function backupStatus(value) {
  if (!value) return { text: '本家庭还未备份', warn: true }
  const time = new Date(String(value).replace(' ', 'T')).getTime()
  if (!Number.isFinite(time)) return { text: `上次备份 ${String(value).slice(0, 10)}`, warn: false }
  const days = Math.floor((Date.now() - time) / 86400000)
  if (days <= 0) return { text: '今天已备份', warn: false }
  if (days <= 7) return { text: `上次备份 ${days} 天前`, warn: false }
  return { text: `已 ${days} 天未备份`, warn: true }
}

export function showHomeSettings() {
  const family = st.family || {}
  const isAdmin = Boolean(family.admin)
  const groups = []

  const dataItems = []
  if (isAdmin) {
    dataItems.push(item('backup', '备份与恢复', '整站备份、自动备份、换机器还原（仅管理员）', 'backup'))
  }
  dataItems.push(item('familybackup', '家庭备份', `只备份「${family.name || '本家庭'}」的账簿，不含其他家庭`, 'home'))
  dataItems.push(item('trash', '回收站', '找回本家庭误删的账簿，恢复不覆盖现有账簿', 'trash'))
  if (isAdmin) {
    dataItems.push(item('archives', '家庭归档', '查看并恢复已删除的家庭', 'archive'))
  }
  groups.push({ title: '数据', items: dataItems })

  const securityItems = []
  if (isAdmin || !st.authEnabled) {
    securityItems.push(item('access', '管理员密码', st.authEnabled ? '已设置：可进入所有家庭、管理家庭与整站备份' : '未设置：设置后可跨家庭管理', 'key'))
  }
  const familySettingsDesc = family.hasCode
    ? (isAdmin ? '改家庭名、换访问码、退出所有设备' : '改家庭名、换访问码')
    : (isAdmin ? '改家庭名、设置访问码、退出所有设备' : '改家庭名、设置访问码')
  securityItems.push(item('familysettings', '家庭设置', familySettingsDesc, 'shield'))
  if (isAdmin && st.authEnabled) {
    securityItems.push(item('logout', '退出管理员', '回到选择家庭，普通家庭成员不受影响', 'exit', true))
  }
  groups.push({ title: '安全', items: securityItems })

  if (isAdmin) {
    groups.push({
      title: '家庭',
      items: [
        item('family', '家庭管理', '新建家庭、重置访问码、改为开放家庭、删除家庭', 'family'),
        item('overview', '家庭总览', '各家庭账簿数量、最近活动与备份状态', 'overview'),
        item('audit', '操作记录', '创建、删除、改码、还原等管理操作留痕', 'audit'),
      ],
    })
  }

  groups.push({ title: '关于', items: [item('about', '本机与关于', '版本、网络、大字、音效、更新说明与许可', 'about')] })

  const codeText = family.hasCode ? '已设访问码' : '免访问码'
  const latestBackup = [family.lastBackupAt, family.lastAutoBackupAt].filter(Boolean).sort().pop() || ''
  const backup = backupStatus(latestBackup)
  const html = `
    <div id="gb-home-settings" class="gb-settings">
      <div class="gb-settings-family">
        <div class="gb-settings-family-top">
          <b>${escapeHtml(family.name || '我的家庭')}</b>
          <span class="gb-settings-role">${isAdmin ? '管理员' : '家庭成员'}</span>
        </div>
        <div class="gb-settings-family-meta">
          <span>${family.eventCount || 0} 本账簿</span><i aria-hidden="true">·</i>
          <span>${codeText}</span><i aria-hidden="true">·</i>
          <span class="${backup.warn ? 'is-warn' : ''}">${backup.text}</span>
        </div>
      </div>
      ${groups.map((group) => `
        <section class="gb-settings-group">
          <h4 class="gb-settings-group-title">${group.title}</h4>
          <div class="gb-settings-list">
            ${group.items.map((entry) => `
              <button type="button" class="gb-settings-item${entry.danger ? ' is-danger' : ''}" data-settings-act="${entry.act}">
                ${icon(entry.iconName)}
                <span class="gb-settings-text"><b>${entry.title}</b><small>${entry.desc}</small></span>
              </button>`).join('')}
          </div>
        </section>`).join('')}
    </div>`
  openModal('设置', { type: 'html', html }, [{ text: '关闭', class: 'modal-btn-ghost' }], { size: 'default', dismissable: true })
  afterModalRender(() => {
    const root = document.getElementById('gb-home-settings')
    if (!root) return
    root.addEventListener('click', (event) => {
      const act = event.target.closest('[data-settings-act]')?.dataset.settingsAct
      if (!act) return
      if (act === 'logout') {
        confirm('退出管理员', '退出后会回到「选择家庭」，普通家庭成员不受影响。确定吗？', async () => {
          closeModal()
          await logout()
        })
        return
      }
      closeModal()
      // 等当前弹窗退场后再打开目标面板，避免两个弹窗抢同一个容器。
      setTimeout(() => {
        if (act === 'backup') showAutoBackupModal()
        if (act === 'familybackup') showFamilyBackup()
        if (act === 'trash') showTrashModal()
        if (act === 'archives') showFamilyArchives()
        if (act === 'access') showAccessModal()
        if (act === 'familysettings') showFamilySettings()
        if (act === 'family') showFamilyAdmin()
        if (act === 'overview') showFamilyOverview()
        if (act === 'audit') showAuditLog()
        if (act === 'about') showAboutPanel()
      }, 140)
    })
  })
}
