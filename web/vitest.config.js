import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.js'],
    globals: true,
    // 单进程 fork：避免 WorkBuddy/CI 环境下线程池与文件写入 shim 的偶发冲突。
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // 门槛按当前实测略低设置：防回退，不追求好看的数字。
      thresholds: { statements: 14, branches: 60, functions: 10, lines: 14 },
    },
  },
})
