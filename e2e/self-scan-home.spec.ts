import { test, expect } from './fixtures/axe-fixture';
import { evaluateAccessibility } from './fixtures/threshold';

test.describe('Home page accessibility', () => {
  test('meets WCAG 2.2 AA threshold', async ({ page, makeAxeBuilder }) => {
    await page.goto('/');
    const results = await makeAxeBuilder().analyze();
    const totalChecks = results.passes.length + results.violations.length;
    const score =
      totalChecks > 0
        ? Math.round((results.passes.length / totalChecks) * 100)
        : 100;
    const evaluation = evaluateAccessibility(score, results.violations);
    expect(evaluation.passed, evaluation.details.join('\n')).toBe(true);
  });

  test('has zero violations after remediation', async ({
    page,
    makeAxeBuilder,
  }) => {
    await page.goto('/');
    const results = await makeAxeBuilder().analyze();
    expect(results.violations).toEqual([]);
  });

  test('has proper heading structure', async ({ page }) => {
    await page.goto('/');
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
  });
});
