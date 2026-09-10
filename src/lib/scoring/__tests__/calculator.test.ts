import { describe, it, expect } from 'vitest';
import { calculateScore } from '../calculator';
import type { AxeViolation, AxePass } from '../../types/scan';

function makeViolation(overrides: Partial<AxeViolation> = {}): AxeViolation {
  return {
    id: 'color-contrast',
    impact: 'serious',
    tags: ['wcag143'],
    description: 'Elements must have sufficient color contrast',
    help: 'Ensure contrast ratio is sufficient',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.0/color-contrast',
    nodes: [{ html: '<span>text</span>', target: ['span'], impact: 'serious' }],
    ...overrides,
  };
}

function makePass(overrides: Partial<AxePass> = {}): AxePass {
  return {
    id: 'html-has-lang',
    tags: ['wcag311'],
    description: 'html element has a lang attribute',
    nodes: [{ html: '<html lang="en">', target: ['html'] }],
    ...overrides,
  };
}

describe('calculateScore', () => {
  it('returns score 100, grade A, aodaCompliant true with no violations and passes', () => {
    const result = calculateScore([], [], 0);
    expect(result.overallScore).toBe(100);
    expect(result.grade).toBe('A');
    expect(result.aodaCompliant).toBe(true);
    expect(result.totalViolations).toBe(0);
    expect(result.totalElementViolations).toBe(0);
    expect(result.totalPasses).toBe(0);
  });

  it('returns score 100 with passes and no violations', () => {
    const passes = [makePass(), makePass({ id: 'image-alt', tags: ['wcag111'] })];
    const result = calculateScore([], passes, 0);
    expect(result.overallScore).toBe(100);
    expect(result.grade).toBe('A');
    expect(result.aodaCompliant).toBe(true);
    expect(result.totalPasses).toBe(2);
  });

  it('returns low score with all critical violations and no passes', () => {
    const violations = [
      makeViolation({ id: 'v1', impact: 'critical', tags: ['wcag111'] }),
      makeViolation({ id: 'v2', impact: 'critical', tags: ['wcag211'] }),
    ];
    const result = calculateScore(violations, [], 0);
    expect(result.overallScore).toBe(0);
    expect(result.grade).toBe('F');
    expect(result.aodaCompliant).toBe(false);
  });

  it('computes weighted score with mixed impacts', () => {
    // 1 critical violation (weight 10) + 10 minor passes (weight 1 each)
    // weightedPassed = 10*1 = 10, weightedTotal = 10*1 + 10*1 = 20
    // score = 10/20 * 100 = 50
    const violations = [makeViolation({ impact: 'critical', tags: ['wcag111'] })];
    const passes = Array.from({ length: 10 }, (_, i) =>
      makePass({ id: `pass-${i}`, tags: ['wcag311'] })
    );
    const result = calculateScore(violations, passes, 0);
    expect(result.overallScore).toBe(50);
    expect(result.grade).toBe('C');
  });

  describe('grade boundaries', () => {
    // To get exact boundary scores, we engineer pass/violation ratios.
    // With only minor impacts (weight=1): score = passes / (passes + violations) * 100

    it.each([
      { passes: 90, violations: 10, expectedGrade: 'A' as const },
      { passes: 89, violations: 11, expectedGrade: 'B' as const },
      { passes: 70, violations: 30, expectedGrade: 'B' as const },
      { passes: 69, violations: 31, expectedGrade: 'C' as const },
      { passes: 50, violations: 50, expectedGrade: 'C' as const },
      { passes: 49, violations: 51, expectedGrade: 'D' as const },
      { passes: 30, violations: 70, expectedGrade: 'D' as const },
      { passes: 29, violations: 71, expectedGrade: 'F' as const },
    ])('$passes passes + $violations violations → grade $expectedGrade', ({ passes, violations, expectedGrade }) => {
      // All minor violations so weight=1 for everything, giving exact ratios
      const vArray = Array.from({ length: violations }, (_, i) =>
        makeViolation({ id: `v-${i}`, impact: 'minor', tags: ['wcag111'] })
      );
      const pArray = Array.from({ length: passes }, (_, i) =>
        makePass({ id: `p-${i}`, tags: ['wcag111'] })
      );
      const result = calculateScore(vArray, pArray, 0);
      expect(result.grade).toBe(expectedGrade);
    });
  });

  it('tracks principle score breakdown', () => {
    const violations = [
      makeViolation({ id: 'v1', impact: 'minor', tags: ['wcag111'] }), // perceivable
      makeViolation({ id: 'v2', impact: 'minor', tags: ['wcag211'] }), // operable
    ];
    const passes = [
      makePass({ id: 'p1', tags: ['wcag111'] }), // perceivable
      makePass({ id: 'p2', tags: ['wcag311'] }), // understandable
    ];
    const result = calculateScore(violations, passes, 0);

    expect(result.principleScores.perceivable.violationCount).toBe(1);
    expect(result.principleScores.perceivable.passCount).toBe(1);
    expect(result.principleScores.perceivable.score).toBe(50);
    expect(result.principleScores.operable.violationCount).toBe(1);
    expect(result.principleScores.operable.passCount).toBe(0);
    expect(result.principleScores.operable.score).toBe(0);
    expect(result.principleScores.understandable.violationCount).toBe(0);
    expect(result.principleScores.understandable.passCount).toBe(1);
    expect(result.principleScores.understandable.score).toBe(100);
    expect(result.principleScores.robust.violationCount).toBe(0);
    expect(result.principleScores.robust.passCount).toBe(0);
    expect(result.principleScores.robust.score).toBe(100);
  });

  it('tracks impact breakdown counts', () => {
    const violations = [
      makeViolation({ id: 'v1', impact: 'critical', tags: ['wcag111'] }),
      makeViolation({ id: 'v2', impact: 'serious', tags: ['wcag211'] }),
      makeViolation({ id: 'v3', impact: 'moderate', tags: ['wcag311'] }),
      makeViolation({ id: 'v4', impact: 'minor', tags: ['wcag411'] }),
    ];
    const result = calculateScore(violations, [], 0);

    expect(result.impactBreakdown.critical.failed).toBe(1);
    expect(result.impactBreakdown.serious.failed).toBe(1);
    expect(result.impactBreakdown.moderate.failed).toBe(1);
    expect(result.impactBreakdown.minor.failed).toBe(1);
    expect(result.impactBreakdown.critical.passed).toBe(0);
  });

  it('records incompleteCount in result', () => {
    const result = calculateScore([], [], 5);
    expect(result.totalIncomplete).toBe(5);
  });

  it('counts totalElementViolations as sum of nodes across violations', () => {
    const violations = [
      makeViolation({
        id: 'v1',
        impact: 'serious',
        tags: ['wcag111'],
        nodes: [
          { html: '<span>a</span>', target: ['span.a'], impact: 'serious' },
          { html: '<span>b</span>', target: ['span.b'], impact: 'serious' },
          { html: '<span>c</span>', target: ['span.c'], impact: 'serious' },
        ],
      }),
      makeViolation({
        id: 'v2',
        impact: 'minor',
        tags: ['wcag211'],
        nodes: [
          { html: '<div>x</div>', target: ['div.x'], impact: 'minor' },
          { html: '<div>y</div>', target: ['div.y'], impact: 'minor' },
        ],
      }),
    ];
    const result = calculateScore(violations, [], 0);
    expect(result.totalViolations).toBe(2);
    expect(result.totalElementViolations).toBe(5);
  });
});
