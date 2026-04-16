import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command:
      'VITE_E2E_MOCK_WALLET=true VITE_E2E_SKIP_GAS_ESTIMATION=true VITE_E2E_SEND_DELAY_MS=25 VITE_WALLETCONNECT_PROJECT_ID=playwright-mock-project VITE_RPC_URL=http://127.0.0.1:8545 VITE_GLIF_RPC_URL_PRIMARY=http://127.0.0.1:1234/rpc/v1 VITE_GLIF_RPC_URL_FALLBACK=http://127.0.0.1:1235/rpc/v1 VITE_GLIF_RPC_TIMEOUT_MS=1000 VITE_FEE_ADDR_A=0x1111111111111111111111111111111111111111 VITE_FEE_ADDR_B=0x2222222222222222222222222222222222222222 yarn dev --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
