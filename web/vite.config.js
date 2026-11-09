import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          vue: ['vue'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 开发时后端端口可用 GIFTBOOK_API 覆盖，方便对着已经跑起来的实例调界面。
      // 服务端的写接口校验同源，所以代理要把 Origin / Referer 改写成后端自己的地址，
      // 否则从 5173 发出的请求会被当成跨站请求挡掉。
      '/api': {
        target: process.env.GIFTBOOK_API || 'http://127.0.0.1:8099',
        changeOrigin: true,
        configure(proxy, options) {
          const origin = String(options.target).replace(/\/$/, '')
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('origin', origin)
            proxyReq.setHeader('referer', origin + '/')
          })
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
