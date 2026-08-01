import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const envDir = mode === 'test' ? resolve(__dirname, 'devlocal') : __dirname
  const env = loadEnv(mode, envDir, 'MAIN_VITE_')
  const buildApiBase =
    process.env.MAIN_VITE_OHMYTOKEN_API_BASE || env.MAIN_VITE_OHMYTOKEN_API_BASE || ''

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      // 避免业务代码直接依赖 import.meta.env，使现有 CommonJS Node 测试仍可编译。
      define: {
        __OHMYTOKEN_BUILD_API_BASE__: JSON.stringify(buildApiBase),
        __OHMYTOKEN_DEV__: JSON.stringify(mode === 'development'),
      },
      build: {
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'src/main/index.ts'),
            'scan-worker': resolve(__dirname, 'src/main/scan-worker.ts'),
          },
          external: ['sql.js'],
        },
      },
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          input: { index: resolve(__dirname, 'src/preload/index.ts') },
        },
      },
    },
    renderer: {
      root: resolve(__dirname, 'src/renderer'),
      resolve: {
        alias: {
          '@': resolve(__dirname, 'src/renderer/src'),
          '@renderer': resolve(__dirname, 'src/renderer/src'),
          '@shared': resolve(__dirname, 'src/shared'),
        },
      },
      plugins: [vue()],
      build: {
        rollupOptions: {
          input: { index: resolve(__dirname, 'src/renderer/index.html') },
        },
      },
      server: {
        host: '127.0.0.1',
        port: 5173,
        strictPort: false,
      },
    },
  }
})
