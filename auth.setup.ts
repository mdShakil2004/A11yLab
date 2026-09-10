import { test as setup } from '@playwright/test';

/**
 * OLT QA2 authenticated-session capture (Playwright storageState).
 *
 * Produces `playwright/.auth/user.json`, a Power Pages portal session that the
 * accessibility scanner mounts read-only at `/secrets/user.json` to scan the
 * login-gated OLT efile pages.
 *
 * Auth flow: SP-initiated SAML. The portal `Sign in` link redirects to
 * Ontario Sign-In (Okta preprod) at `stage.signin.ontario.ca`, where the
 * username/password form lives. After login, SAML asserts back to the portal
 * and sets the Power Pages session cookie.
 *
 * IMPORTANT — selectors are best-effort and MUST be confirmed before first use:
 *   npx playwright codegen "https://jus-olt-qa2.powerappsportals.com/en/"
 * Click `Sign in`, complete the Ontario Sign-In form, and copy the exact
 * email / password / submit selectors recorded by codegen into this file.
 *
 * MFA / device-trust: Ontario Sign-In may present a one-time MFA or
 * "trust this device" prompt that this unattended script cannot satisfy. If so,
 * run this capture interactively (`--headed`) once to clear/establish device
 * trust, or extend the flow with the codegen-confirmed MFA steps. Treat the
 * resulting `user.json` as a SECRET: never commit it, upload it to ADO Secure
 * Files as `olt-qa2-user.json`, and mount it `:ro` in the pipeline.
 *
 * Credentials come from env vars only — never hardcode:
 *   OLT_USER, OLT_PASSWORD
 */

const authFile = 'playwright/.auth/user.json';

setup('authenticate to OLT QA2', async ({ page }) => {
  const username = process.env.OLT_USER;
  const password = process.env.OLT_PASSWORD;
  if (!username || !password) {
    throw new Error(
      'OLT_USER and OLT_PASSWORD must be set in the environment (never hardcode credentials).',
    );
  }

  // Helper: try an action but never fail the run — the human operator can
  // complete any step the auto-flow misses (MFA, a moved selector, etc.).
  const tryStep = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
      console.log(`  [auto] ${label}: ok`);
    } catch {
      console.log(`  [auto] ${label}: skipped (complete manually in the browser)`);
    }
  };

  // 1. Start at the portal landing page.
  await page.goto('https://jus-olt-qa2.powerappsportals.com/en/');

  // 2. Click the portal `Sign in` link to trigger the SP-initiated SAML redirect.
  await tryStep('click portal Sign in', async () => {
    await page.getByRole('link', { name: /sign\s*in/i }).first().click({ timeout: 15_000 });
  });

  // 3. Wait for the redirect to Ontario Sign-In (Okta preprod).
  //    SAML endpoint: stage.signin.ontario.ca/app/stage-ontsignin_...
  await tryStep('await Ontario Sign-In redirect', async () => {
    await page.waitForURL(/stage\.signin\.ontario\.ca/, { timeout: 30_000 });
  });

  // Give the sign-in widget time to render, then DIAGNOSE the form: dump every
  // input's identifying attributes so selectors can be confirmed if auto-fill
  // misses. Inputs may live inside an iframe — check frames too.
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(2_000);
  const dumpInputs = async () => {
    for (const f of page.frames()) {
      const inputs = await f
        .evaluate(() =>
          Array.from(document.querySelectorAll('input')).map((el) => ({
            type: (el as HTMLInputElement).type,
            name: el.getAttribute('name'),
            id: el.id,
            placeholder: el.getAttribute('placeholder'),
            ariaLabel: el.getAttribute('aria-label'),
            autocomplete: el.getAttribute('autocomplete'),
          })),
        )
        .catch(() => []);
      if (inputs.length) {
        console.log(`  [diag] frame ${f.url()} inputs:`, JSON.stringify(inputs));
      }
    }
  };
  await tryStep('diagnose sign-in inputs', dumpInputs);

  // Resolve the frame that actually holds the password input (handles iframes).
  const findFrameWith = async (selector: string) => {
    for (const f of page.frames()) {
      if (await f.locator(selector).count().catch(() => 0)) return f;
    }
    return page.mainFrame();
  };

  // 4. Fill the Ontario.ca Login form. Try several selectors per field and use
  //    the first visible match. Labels are not linked to inputs on this form.
  //    Confirmed live selectors (Okta widget): email = input#identifier
  //    (name="identifier", autocomplete="username"); password =
  //    input[name="credentials.passcode"] (autocomplete="current-password").
  let emailFilled = false;
  let passwordFilled = false;
  await tryStep('fill email', async () => {
    const f = await findFrameWith('input[type="password"]');
    const email = f
      .locator(
        'input#identifier, input[name="identifier"], input[autocomplete="username"], input[type="email"], input[name*="email" i], input[name*="user" i], input[id*="email" i], input[id*="user" i], input:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="submit"]):not([type="button"])',
      )
      .first();
    await email.waitFor({ state: 'visible', timeout: 20_000 });
    await email.click();
    await email.fill(username);
    emailFilled = (await email.inputValue().catch(() => '')) === username;
    console.log(`  [auto] email value confirmed: ${emailFilled}`);
  });
  await tryStep('fill password', async () => {
    const f = await findFrameWith('input[type="password"]');
    const pwd = f
      .locator('input[name="credentials.passcode"], input[autocomplete="current-password"], input[type="password"]')
      .first();
    await pwd.waitFor({ state: 'visible', timeout: 10_000 });
    await pwd.click();
    await pwd.fill(password);
    passwordFilled = (await pwd.inputValue().catch(() => '')).length > 0;
    console.log(`  [auto] password value confirmed: ${passwordFilled}`);
  });

  // 5. Submit ONLY when both fields are confirmed populated. Otherwise leave the
  //    form for the operator to complete by hand (avoids submitting empty and
  //    tripping the form's validation).
  if (emailFilled && passwordFilled) {
    await tryStep('click Sign in', async () => {
      const f = await findFrameWith('input[type="password"]');
      await f
        .locator(
          'button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Continue"), input[type="submit"], button[type="submit"]',
        )
        .first()
        .click({ timeout: 10_000 });
    });
  } else {
    console.log(
      '  [auto] Skipping auto-submit — one or more fields not auto-filled. ' +
        'Complete the email/password and click Sign in MANUALLY in the open browser.',
    );
  }

  // 6. SAML asserts back to the portal and sets the Power Pages session cookie.
  //    MFA / device-trust may appear here — the operator completes it manually.
  //    Long timeout so the human has time to finish any interactive step.
  console.log('  Waiting (up to 3 min) for return to the OLT portal — complete MFA/manual steps now if prompted...');
  await page.waitForURL(/jus-olt-qa2\.powerappsportals\.com/, { timeout: 180_000 });

  // 7. Confirm an authenticated landing. This portal exposes the signed-in user
  //    via an account-name dropdown in the nav (e.g. "Emmanuel Knafo"), not a
  //    visible "Sign out" link, so accept any of several authenticated markers.
  //    Non-fatal: if no marker is found we still persist the session and let the
  //    pipeline's auth-expiry guard be the source of truth.
  await tryStep('confirm authenticated marker', async () => {
    const markers = [
      page.getByText(new RegExp(username.split('@')[0], 'i')),
      page.getByText(/sign\s*out|log\s*out/i),
      page.getByRole('link', { name: /new appeal|my appeals|my invoices/i }),
      page.getByText(/my appeals|my invoices|appeal parties/i),
    ];
    await Promise.race(markers.map((m) => m.first().waitFor({ timeout: 60_000 })));
  });

  // Settle network so all auth cookies are committed before snapshotting.
  await page.waitForLoadState('networkidle').catch(() => {});

  // 8. Persist the authenticated storageState (always — even if the marker probe
  //    above did not match a specific element).
  await page.context().storageState({ path: authFile });
  const cookieCount = (await page.context().cookies()).length;
  console.log(`  Captured authenticated storageState -> ${authFile} (${cookieCount} cookies)`);
});
