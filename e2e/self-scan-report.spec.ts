import { test, expect } from './fixtures/axe-fixture';
import { generateReportHtml } from '../src/lib/report/templates/report-template';
import { createMockReportData } from './fixtures/report-data';

test.describe('Generated single-page report accessibility', () => {
  test('has no critical or serious WCAG violations', async ({ page, makeAxeBuilder }) => {
    const reportData = createMockReportData();
    const html = generateReportHtml(reportData);
    await page.setContent(html, { waitUntil: 'load' });
    const results = await makeAxeBuilder().analyze();
    const criticalOrSerious = results.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );
    expect(criticalOrSerious).toHaveLength(0);
  });
});
