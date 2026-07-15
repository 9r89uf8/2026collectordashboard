import { defineConfig, loadEnv } from 'vite'

function apiProxy(target) {
  return {
    '/api': {
      target,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ''),
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'API_')
  const target = env.API_PROXY_TARGET ?? 'http://127.0.0.1:9000'

  return {
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: apiProxy(target),
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
      proxy: apiProxy(target),
    },
    test: {
      environment: 'jsdom',
    },
  }
})
