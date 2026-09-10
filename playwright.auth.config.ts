import { defineConfig } from '@playwright/test';

/**
 * Dedicated config for capturing the OLT QA2 authenticated storageState.
 *
 * Kept separate from playwright.config.ts so the capture does NOT spin up the
 * local Next.js webServer (the auth flow targets the external portal, not
 * localhost). Run headed so a human can complete the Ontario Sign-In SAML
 * login and any MFA / device-trust prompt:
 *
 *   $env:OLT_USER="<user>"; $env:OLT_PASSWORD="<password>"
 *   npx playwright test --config=playwright.auth.config.ts --headed
 *
 * Output: playwright/.auth/user.json (treat as a SECRET — never commit).
 */
export default defineConfig({
  testDir: '.',
  testMatch: /auth\.setup\.ts/,
  timeout: 180_000,
  retries: 0,
  reporter: [['list']],
  use: {
    headless: false,
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
});
