import { test, expect } from './fixtures/axe-fixture';
import { seedCrawlResult } from './fixtures/seed-data';

test.describe('Crawl results page accessibility', () => {
  test('has no WCAG 2.2 AA violations', async ({
    page,
    request,
    makeAxeBuilder,
  }) => {
    test.setTimeout(180_000); // 3 minutes for crawl seeding + rendering
    const crawlId = await seedCrawlResult(request);
    await page.goto(`/crawl/${crawlId}`);
    // Wait for the site report heading to appear
    await page.waitForSelector('h1', { timeout: 120_000 });
    await page.waitForTimeout(1000);
    const results = await makeAxeBuilder().analyze();
    expect(results.violations).toEqual([]);
  });
});
