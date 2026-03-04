import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const appBaseRaw = process.env.APP_BASE || '/'
const appBase = appBaseRaw.endsWith('/') ? appBaseRaw : `${appBaseRaw}/`
const basePrefix = appBase === '/' ? '' : appBase.slice(0, -1)

const stripBasePrefix = (requestPath: string) => {
  if (basePrefix && requestPath.startsWith(basePrefix)) {
    return requestPath.slice(basePrefix.length) || '/'
  }
  return requestPath
}

function createProxyConfig(): Record<string, string | ProxyOptions> {
  const proxy: Record<string, string | ProxyOptions> = {}

  const addProxy = (route: string, options: ProxyOptions) => {
    proxy[route] = options
    if (basePrefix) {
      proxy[`${basePrefix}${route}`] = options
    }
  }

  const backendRoutes = ['/api/ai', '/api/auth', '/api/funds', '/api/watchlist', '/api/news', '/api/webhook', '/api/portfolio', '/api/dashboard']
  for (const route of backendRoutes) {
    addProxy(route, {
      target: 'http://127.0.0.1:5001',
      changeOrigin: true,
      rewrite: (requestPath) => stripBasePrefix(requestPath),
    })
  }

  // 代理天天基金 API 解决跨域问题
  addProxy('/api/fund/', {
    target: 'https://fundgz.1234567.com.cn',
    changeOrigin: true,
    rewrite: (requestPath) => stripBasePrefix(requestPath).replace(/^\/api\/fund\//, '/js/'),
  })

  // 代理东方财富指数 API
  addProxy('/api/index', {
    target: 'https://push2.eastmoney.com',
    changeOrigin: true,
    rewrite: (requestPath) => stripBasePrefix(requestPath).replace(/^\/api\/index/, ''),
  })

  // 代理基金分时估值 API 和持仓 API
  addProxy('/api/fundmob', {
    target: 'https://fundmobapi.eastmoney.com',
    changeOrigin: true,
    secure: false,
    rewrite: (requestPath) => {
      const normalizedPath = stripBasePrefix(requestPath)
      const rewrittenPath = normalizedPath.replace(/^\/api\/fundmob/, '')
      console.log('[Proxy Rewrite]', requestPath, '->', rewrittenPath)
      return rewrittenPath
    },
    configure: (proxyServer) => {
      proxyServer.on('proxyReq', (proxyReq) => {
        console.log('[Proxy Request] URL:', proxyReq.path)
        console.log('[Proxy Request] Headers:', proxyReq.getHeaders())
      })
    },
    headers: {
      'User-Agent': 'curl/8.7.1',
      Referer: 'https://fundmobapi.eastmoney.com/',
    },
  })

  // 代理财联社电报 API
  addProxy('/nodeapi', {
    target: 'https://www.cls.cn',
    changeOrigin: true,
    rewrite: (requestPath) => stripBasePrefix(requestPath),
    headers: {
      Referer: 'https://www.cls.cn/telegraph',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  })

  // 代理财联社图片
  addProxy('/img-proxy', {
    target: 'https://img.cls.cn',
    changeOrigin: true,
    rewrite: (requestPath) => stripBasePrefix(requestPath).replace(/^\/img-proxy/, ''),
    headers: {
      Referer: 'https://www.cls.cn/',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  })

  return proxy
}

// https://vite.dev/config/
export default defineConfig({
  base: appBase,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: createProxyConfig(),
  },
})
