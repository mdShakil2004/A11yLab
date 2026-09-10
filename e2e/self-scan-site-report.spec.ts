import { test, expect } from './fixtures/axe-fixture';
import { generateSiteReportHtml } from '../src/lib/report/templates/site-report-template';
import { createMockSiteReportData } from './fixtures/report-data';

test.describe('Generated site report accessibility', () => {
  test('has no critical or serious WCAG violations', async ({ page, makeAxeBuilder }) => {
    const siteReportData = createMockSiteReportData();
    const html = generateSiteReportHtml(siteReportData);
    await page.setContent(html, { waitUntil: 'load' });
    const results = await makeAxeBuilder().analyze();
    const criticalOrSerious = results.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );
    expect(criticalOrSerious).toHaveLength(0);
  });
});
