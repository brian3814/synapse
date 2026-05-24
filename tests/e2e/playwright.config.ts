import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './suites',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: '../results' }],
  ],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
