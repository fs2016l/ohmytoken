import { resolve } from 'path'
import { dirname } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

function licenseCoverage(): Plugin {
  const cataloguePath = resolve(__dirname, 'third-party-licenses/generated/catalogue.json')
  const catalogue: { entries: { id: string }[] } = JSON.parse(readFileSync(cataloguePath, 'utf8'))
  const covered = new Set(catalogue.entries.map((entry) => entry.id))
  const checked = new Set<string>()
  return {
    name: 'ohmytoken-license-coverage',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        for (const [moduleId, info] of Object.entries(chunk.modules)) {
          if (!info.renderedLength || moduleId.startsWith('\0')) continue
          const id = moduleId.replaceAll('\\', '/').split('?')[0]
          if (id.endsWith('/gifenc/src/pnnquant2.js'))
            this.error('Unlicensed PnnQuant-derived code must not be included in GIF exports')
          if (!id.includes('/node_modules/')) continue
          let folder = dirname(id)
          while (folder.includes('node_modules')) {
            const file = resolve(folder, 'package.json')
            if (checked.has(file)) break
            if (existsSync(file)) {
              const pkg = JSON.parse(readFileSync(file, 'utf8'))
              if (pkg.name && pkg.version) {
                if (!covered.has(`${pkg.name}@${pkg.version}`))
                  this.error(
                    `Missing third-party notice for bundled ${pkg.name}@${pkg.version}. Update scripts/third-party-notices.mjs and run npm run licenses:generate.`,
                  )
                checked.add(file)
                break
              }
            }
            const parent = dirname(folder)
            if (parent === folder) break
            folder = parent
          }
        }
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, 'MAIN_VITE_')
  const buildApiBase =
    process.env.MAIN_VITE_OHMYTOKEN_API_BASE || env.MAIN_VITE_OHMYTOKEN_API_BASE || ''

  return {
    main: {
      plugins: [externalizeDepsPlugin(), licenseCoverage()],
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
            'codex-parse-worker': resolve(__dirname, 'src/main/codex-parse-worker.ts'),
            'agent-scan-worker': resolve(__dirname, 'src/main/agent-scan-worker.ts'),
          },
          external: ['sql.js'],
        },
      },
    },
    preload: {
      plugins: [externalizeDepsPlugin(), licenseCoverage()],
      build: {
        rollupOptions: {
          input: { index: resolve(__dirname, 'src/preload/index.ts') },
        },
      },
    },
    renderer: {
      root: resolve(__dirname, 'src/renderer'),
      // The replay worker is loaded on demand. Prebundle its dependencies before the first
      // export so Vite does not reload the renderer and interrupt an active generation.
      optimizeDeps: { include: ['mediabunny', 'gifenc/src/index.js'] },
      resolve: {
        alias: {
          '@': resolve(__dirname, 'src/renderer/src'),
          '@renderer': resolve(__dirname, 'src/renderer/src'),
          '@shared': resolve(__dirname, 'src/shared'),
        },
      },
      plugins: [vue(), licenseCoverage()],
      worker: { plugins: () => [licenseCoverage()] },
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
