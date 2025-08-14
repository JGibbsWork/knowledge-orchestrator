import { defineConfig, devices } from '@playwright/test';

/**
 * H2: Playwright configuration for E2E API testing
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests/e2e',
  /* Run tests in files in parallel */
  fullyParallel: false, // Disable for E2E tests that share resources
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : 1, // Single worker for E2E tests
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['line']
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:3000',
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    /* API request timeout */
    timeout: 30000
  },

  /* Configure projects for API testing */
  projects: [
    {
      name: 'api-tests',
      testMatch: '**/api/pack-final.spec.ts',
      use: { ...devices['Desktop Chrome'] }
    }
  ],

  /* Run KO service - mock servers will be managed by tests */
  webServer: {
    command: 'pnpm build && MEMORY_BASE_URL=http://localhost:3001 MEMORY_TOKEN=test123 NOTION_BASE_URL=http://localhost:3002 NOTION_TOKEN=secret_test BRAVE_API_KEY=brave123 MONGO_URL=mongodb://localhost:27017/test_e2e EMBEDDINGS_PROVIDER=ollama MOCK_NOTION=true node dist/index.js',
    url: 'http://localhost:3000/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    stderr: 'pipe',
    stdout: 'pipe'
  },
});