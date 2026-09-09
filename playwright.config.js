import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4173/AI-360-VR-Viewer/', serviceWorkers: 'block', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], headless: !process.env.CI, launchOptions: { firefoxUserPrefs: { 'webgl.force-enabled': true } } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: { command: 'node scripts/serve.mjs --host 127.0.0.1 --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
