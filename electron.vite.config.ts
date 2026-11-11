import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = {
  '@shared': resolve(import.meta.dirname, 'src/shared'),
  '@renderer': resolve(import.meta.dirname, 'src/renderer/src')
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      externalizeDeps: true,
      rollupOptions: { input: { index: resolve(import.meta.dirname, 'src/main/index.ts') } }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: { input: { index: resolve(import.meta.dirname, 'src/renderer/index.html') } }
    }
  }
})
