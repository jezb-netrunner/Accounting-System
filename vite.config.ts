import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages serves this app from a repo subpath. BASE_PATH lets CI (or a
// fork with a different repo name) override it without touching the config.
const base =
  process.env.BASE_PATH ?? (process.env.NODE_ENV === 'production' ? '/Accounting-System/' : '/')

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
