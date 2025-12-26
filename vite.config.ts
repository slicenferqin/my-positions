import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    // 代理天天基金API解决跨域问题
    proxy: {
      '/api/fund': {
        target: 'https://fundgz.1234567.com.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/fund/, '/js'),
      },
      // 代理东方财富指数API
      '/api/index': {
        target: 'https://push2.eastmoney.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/index/, ''),
      },
      // 代理基金分时估值API和持仓API
      '/api/fundmob': {
        target: 'https://fundmobapi.eastmoney.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => {
          const newPath = path.replace(/^\/api\/fundmob/, '')
          console.log('[Proxy Rewrite]', path, '->', newPath)
          return newPath
        },
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log('[Proxy Request] URL:', proxyReq.path)
            console.log('[Proxy Request] Headers:', proxyReq.getHeaders())
          })
        },
        headers: {
          'User-Agent': 'curl/8.7.1', // Mimic curl
          'Referer': 'https://fundmobapi.eastmoney.com/'
        }
      },
      // 代理财联社电报API
      '/nodeapi': {
        target: 'https://www.cls.cn',
        changeOrigin: true,
        headers: {
          'Referer': 'https://www.cls.cn/telegraph',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      },
      // 代理财联社图片
      '/img-proxy': {
        target: 'https://img.cls.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/img-proxy/, ''),
        headers: {
          'Referer': 'https://www.cls.cn/',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      },
      // 代理本地 AI 服务
      '/api/ai': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      }
    },
  },
})
