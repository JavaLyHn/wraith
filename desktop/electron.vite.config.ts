import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: 'src/main/index.ts',
        external: ['node-pty', 'koffi']
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: 'src/preload/index.ts',
          pet: 'src/preload/pet.ts'
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    server: {
      // 不占 Vite 默认的 5173(用户其他项目在用);再冲突时 vite 自动 +1,不阻塞
      port: 5873
    },
    css: {
      postcss: {
        plugins: [tailwindcss(), autoprefixer()]
      }
    },
    worker: {
      format: 'es'
    },
    build: {
      rollupOptions: {
        input: {
          index: 'src/renderer/index.html',
          pet: 'src/renderer/pet.html'
        },
        output: {
          // Monaco 按需加载(DiffView 动态 import),单独拆 chunk 确保首屏零 Monaco
          manualChunks(id) {
            if (id.includes('node_modules/monaco-editor')) {
              // editor.api 子路径单独分块,与 monaco 主包隔离
              if (id.includes('editor.api') || id.includes('editor.worker')) {
                return 'monaco-core'
              }
              return 'monaco'
            }
          }
        }
      }
    },
    plugins: [react()]
  }
})
