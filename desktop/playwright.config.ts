import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']]
})
