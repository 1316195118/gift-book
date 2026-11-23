// 备份健康判断只使用现有接口返回的时间、文件数与错误信息，不虚构恢复演练结果。
function parseTime(value) {
  if (!value) return null
  const normalized = typeof value === 'number' ? value : String(value).includes('T')
    ? String(value)
    : String(value).replace(' ', 'T')
  const time = new Date(normalized).getTime()
  return Number.isFinite(time) ? time : null
}

export function assessBackupHealth({ auto = null, family = null, familyInfo = null, now = Date.now() } = {}) {
  const familyFiles = Array.isArray(familyInfo?.files) ? familyInfo.files : []
  const autoFiles = Array.isArray(auto?.files) ? auto.files : []
  const candidates = [
    parseTime(auto?.lastBackupAt),
    parseTime(family?.lastBackupAt),
    parseTime(family?.lastAutoBackupAt),
    ...autoFiles.map((file) => parseTime(file.modTime)),
    ...familyFiles.map((file) => parseTime(file.modTime)),
  ].filter((time) => time !== null && time <= now)
  const latestAt = candidates.length ? Math.max(...candidates) : null
  const ageMs = latestAt === null ? null : Math.max(0, now - latestAt)
  const intervalHours = Math.max(1, Number(auto?.intervalHours) || Number(familyInfo?.intervalHours) || 24)
  const staleAfterMs = intervalHours * 2 * 3600000
  const isStale = latestAt === null || ageMs > staleAfterMs
  const lastError = String(auto?.lastError || family?.backupAlert || familyInfo?.lastError || '').trim()
  const diskFree = Number(auto?.diskFree) || 0
  const lowDisk = diskFree > 0 && diskFree < 1024 * 1024 * 1024
  const backupEnabled = Boolean(auto?.enabled ?? familyInfo?.enabled ?? family?.autoBackupEnabled)
  const hasBackup = latestAt !== null
  let level = 'good'
  if (!hasBackup || isStale || lastError || lowDisk) level = 'warn'
  if (lastError && !hasBackup) level = 'danger'
  if (!hasBackup) level = 'danger'

  const checks = [
    {
      key: 'recent',
      title: '最近有效备份',
      status: hasBackup ? (isStale ? 'warn' : 'good') : 'danger',
      detail: hasBackup
        ? (isStale ? `已超过预计间隔 ${intervalHours} 小时，建议立即备份。` : '最近备份时间在预计间隔内。')
        : '还没有找到可确认的备份文件。',
    },
    {
      key: 'schedule',
      title: '自动备份计划',
      status: backupEnabled ? 'good' : 'warn',
      detail: backupEnabled ? `已启用，预计每 ${intervalHours} 小时运行一次。` : '未启用自动备份，需要手动导出。',
    },
    {
      key: 'errors',
      title: '备份任务错误',
      status: lastError ? 'danger' : 'good',
      detail: lastError || '最近没有备份任务错误。',
    },
    {
      key: 'files',
      title: '备份文件',
      status: autoFiles.length + familyFiles.length > 0 ? 'good' : 'warn',
      detail: `整站 ${autoFiles.length} 份 · 家庭 ${familyFiles.length} 份。`,
    },
    {
      key: 'disk',
      title: '可用空间',
      status: lowDisk ? 'warn' : 'good',
      detail: diskFree > 0 ? `${(diskFree / 1024 / 1024 / 1024).toFixed(1)} GB 可用。` : '当前账号未返回磁盘余量。',
    },
  ]

  return {
    level,
    title: level === 'good' ? '备份状态良好' : level === 'warn' ? '备份需要注意' : '缺少可用备份',
    latestAt,
    ageMs,
    intervalHours,
    backupEnabled,
    autoFiles: autoFiles.length,
    familyFiles: familyFiles.length,
    totalBytes: Number(auto?.totalBytes) || 0,
    familyBytes: Number(auto?.familyBytes) || 0,
    diskFree,
    checks,
  }
}
