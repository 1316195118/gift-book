import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.js'],
    globals: true,
    // 单进程 fork：避免 WorkBuddy/CI 环境下线程池与文件写入 shim 的偶发冲突。
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
})
