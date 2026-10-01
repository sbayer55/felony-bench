import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// BASE_PATH is set by the GitHub Pages deploy workflow (e.g. /felony-bench/).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
