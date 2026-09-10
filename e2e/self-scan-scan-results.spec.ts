import { test, expect } from './fixtures/axe-fixture';

test.describe('Scan results page accessibility', () => {
  test('has no WCAG 2.2 AA violations', async ({
    page,
    request,
    makeAxeBuilder,
  }) => {
    test.setTimeout(120_000);

    // Trigger a scan via API — we test the rendered page regardless of scan outcome
    const response = await request.post('/api/scan', {
      data: { url: 'https://example.com' },
    });
    expect(response.ok()).toBe(true);
    const { scanId } = await response.json();

    // Poll until the scan reaches a terminal state (complete or error)
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await request.get(`/api/scan/${scanId}`);
      if (!poll.ok()) continue;
      const data = await poll.json();
      if (data.status === 'complete' || data.status === 'error') break;
    }

    // Navigate to the scan results page and test its accessibility
    await page.goto(`/scan/${scanId}`);
    await page.waitForSelector('h1', { timeout: 30_000 });
    await page.waitForTimeout(1000);
    const results = await makeAxeBuilder().analyze();
    expect(results.violations).toEqual([]);
  });
});
