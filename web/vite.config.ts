import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  root: r('.'),
  publicDir: r('../assets'),
  build: { outDir: r('../dist'), emptyOutDir: true, target: 'es2022' },
  server: {
    port: 5173,
    host: true,
    fs: { allow: [r('..')] },
    proxy: { '/api': 'http://localhost:8787' },
  },
})
