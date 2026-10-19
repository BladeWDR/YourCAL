import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { env: { SESSION_SECRET: 'a'.repeat(64) } },
})
