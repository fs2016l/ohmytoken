// ESLint 9 flat config —— ohmyagent/desktop
// 最小防护网：max-lines + 进程边界 + 防止 pages/ 回潮
// 设计原则：warn 先暴露历史问题不阻塞，error 只对真实架构违规
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import eslintConfigPrettier from 'eslint-config-prettier'

export default [
  // === 全局忽略 ===
  {
    ignores: [
      'out/**',
      'out-test/**',
      'devlocal/**',
      'dist/**',
      'release/**',
      'node_modules/**',
      '.eslintrc.*',
      'src/renderer/src/env.d.ts', // 含全局 Window 接口扩展，避免被规则误报
      '*.config.{js,ts,mjs,cjs}',
      'electron-builder.{yml,yaml}',
    ],
  },

  // === 基础：JS + TS 推荐 ===
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // === Vue 推荐（flat config 形式） ===
  ...pluginVue.configs['flat/recommended'],

  // === .vue 文件：让 vue-eslint-parser 把 <script lang="ts"> 交给 ts parser ===
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },
  },

  // === Node CJS 测试脚本 ===
  {
    files: ['tests/node/**/*.cjs'],
    languageOptions: {
      globals: {
        require: 'readonly',
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // === 全局通用规则（所有源码） ===
  {
    files: ['src/**/*.{ts,vue,js,mjs}'],
    rules: {
      // 单文件规模上限：硬上限 500 行（warn 先暴露 AgentPage 2346 行不阻塞）
      'max-lines': ['warn', { max: 500, skipComments: true }],

      // TS：unused-vars / any（先 warn）
      // 注：consistent-type-imports 需要 typed linting（parserOptions.project），
      // 与"最小防护网"原则冲突，暂不启用
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',

      // Vue：允许 AgentPage/TokenPage 等单词页面名
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'warn',
      'vue/require-default-prop': 'warn',

      // 通用
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'warn',
      // 历史代码暴露但不阻塞（本次改造目标是目录结构，不是修业务 bug）
      'no-useless-escape': 'warn',
      'no-irregular-whitespace': 'warn',
    },
  },

  // === main 进程专属规则 ===
  {
    files: ['src/main/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['vue', '@vue/*', 'pinia', 'vue-router', 'axios', 'echarts'],
              message: 'main 进程禁止依赖 Vue/UI 库（保持纯 Node 环境）',
            },
            {
              group: ['@renderer/*', '../renderer/**', '../../renderer/**'],
              message: 'main 进程禁止 import renderer 代码',
            },
          ],
        },
      ],
    },
  },

  // === preload 进程专属规则 ===
  {
    files: ['src/preload/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['vue', '@vue/*', 'pinia', 'vue-router', 'echarts'],
              message: 'preload 进程禁止依赖 Vue/UI 库（仅暴露白名单 IPC API）',
            },
            {
              group: ['@renderer/*', '../renderer/**'],
              message: 'preload 禁止 import renderer 代码',
            },
          ],
        },
      ],
    },
  },

  // === renderer 进程专属规则 ===
  {
    files: ['src/renderer/src/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron', 'fs', 'path', 'os', 'child_process'],
              message: 'renderer 禁止直接 require Node API，请通过 window.api.* 走 IPC',
            },
            {
              group: ['../main/**', '../../main/**', '@main/**', '../../../main/**'],
              message: 'renderer 禁止 import main 进程代码，请走 window.api.* IPC',
            },
            {
              group: ['../preload/**', '../../preload/**', '../../../preload/**'],
              message: 'renderer 禁止 import preload 内部实现，只能用 window.api',
            },
            // 防止 pages/ 上提后又回潮（本次 Phase 1 改造后启用）
            {
              group: [
                '@renderer/components/pages/**',
                '../components/pages/**',
                '../../components/pages/**',
                './components/pages/**',
              ],
              message: 'pages/ 已迁移到 views/，请更新 import 路径',
            },
          ],
        },
      ],
    },
  },

  // === shared 层规则（仅类型 + 常量） ===
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'electron',
                'fs',
                'path',
                'vue',
                '@vue/*',
                'pinia',
                'axios',
                'echarts',
                '@renderer/*',
                '../renderer/**',
                '../main/**',
                '../preload/**',
              ],
              message: 'shared 只能放纯类型 + 常量，禁止运行时代码或跨进程依赖',
            },
          ],
        },
      ],
    },
  },

  // === Prettier 兼容（关闭冲突规则，放最后） ===
  eslintConfigPrettier,
]
