import { describe, expect, it } from 'vitest'
import { assessBackupHealth } from '../backup-health.js'

describe('backup health', () => {
  const now = new Date('2026-11-23T12:00:00+08:00').getTime()

  it('reports a recent, enabled backup as healthy', () => {
    const health = assessBackupHealth({
      now,
      auto: {
        enabled: true,
        intervalHours: 24,
        lastBackupAt: '2026-11-23 09:00',
        diskFree: 20 * 1024 * 1024 * 1024,
        files: [{ name: 'auto-1.zip', modTime: '2026-11-23T09:00:00+08:00' }],
      },
      familyInfo: { enabled: true, files: [{ name: 'auto-2.zip' }] },
    })
    expect(health.level).toBe('good')
    expect(health.autoFiles).toBe(1)
    expect(health.familyFiles).toBe(1)
  })

  it('warns when no backup exists', () => {
    const health = assessBackupHealth({ now, auto: { enabled: false, intervalHours: 24 } })
    expect(health.level).toBe('danger')
    expect(health.checks.find((item) => item.key === 'recent').status).toBe('danger')
    expect(health.checks.find((item) => item.key === 'schedule').status).toBe('warn')
  })

  it('surfaces task errors and stale backups', () => {
    const health = assessBackupHealth({
      now,
      auto: {
        enabled: true,
        intervalHours: 1,
        lastBackupAt: '2026-11-20 09:00',
        lastError: '磁盘已满',
        files: [{ name: 'auto-1.zip' }],
      },
    })
    expect(health.level).toBe('warn')
    expect(health.checks.find((item) => item.key === 'errors').detail).toBe('磁盘已满')
    expect(health.checks.find((item) => item.key === 'recent').status).toBe('warn')
  })
})
