import { describe, it, expect } from 'vitest';
import { evaluateThreshold, getDefaultThreshold } from '../threshold';
import type { AxeViolation } from '../../types/scan';

function makeViolation(overrides: Partial<AxeViolation> = {}): AxeViolation {
  return {
    id: 'color-contrast',
    impact: 'serious',
    tags: ['wcag143'],
    description: 'Elements must have sufficient color contrast',
    help: 'Ensure contrast ratio',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.0/color-contrast',
    nodes: [{ html: '<span>', target: ['span'], impact: 'serious' }],
    ...overrides,
  };
}

describe('evaluateThreshold', () => {
  describe('score checks', () => {
    it('passes when score is above threshold', () => {
      const result = evaluateThreshold(85, [], { score: 70 });
      expect(result.scorePassed).toBe(true);
    });

    it('passes when score equals threshold', () => {
      const result = evaluateThreshold(70, [], { score: 70 });
      expect(result.scorePassed).toBe(true);
    });

    it('fails when score is below threshold', () => {
      const result = evaluateThreshold(69, [], { score: 70 });
      expect(result.scorePassed).toBe(false);
    });

    it('scorePassed is true when no score threshold configured', () => {
      const result = evaluateThreshold(50, [], {});
      expect(result.scorePassed).toBe(true);
    });
  });

  describe('maxViolations checks', () => {
    it('passes when violation count is within limit', () => {
      const violations = [makeViolation({ impact: 'critical' })];
      const result = evaluateThreshold(80, violations, {
        maxViolations: { critical: 1 },
      });
      expect(result.countPassed).toBe(true);
    });

    it('fails when violation count exceeds limit', () => {
      const violations = [
        makeViolation({ id: 'v1', impact: 'critical' }),
        makeViolation({ id: 'v2', impact: 'critical' }),
      ];
      const result = evaluateThreshold(80, violations, {
        maxViolations: { critical: 1 },
      });
      expect(result.countPassed).toBe(false);
    });

    it('passes when critical is zero and no critical violations exist', () => {
      const violations = [makeViolation({ impact: 'minor' })];
      const result = evaluateThreshold(80, violations, {
        maxViolations: { critical: 0 },
      });
      expect(result.countPassed).toBe(true);
    });

    it('fails when critical is zero and a critical violation exists', () => {
      const violations = [makeViolation({ impact: 'critical' })];
      const result = evaluateThreshold(80, violations, {
        maxViolations: { critical: 0 },
      });
      expect(result.countPassed).toBe(false);
    });
  });

  describe('failOnRules checks', () => {
    it('passes when no matching violations', () => {
      const violations = [makeViolation({ id: 'color-contrast' })];
      const result = evaluateThreshold(80, violations, {
        failOnRules: ['image-alt'],
      });
      expect(result.rulePassed).toBe(true);
    });

    it('fails when a required rule has violations', () => {
      const violations = [makeViolation({ id: 'image-alt' })];
      const result = evaluateThreshold(80, violations, {
        failOnRules: ['image-alt'],
      });
      expect(result.rulePassed).toBe(false);
    });
  });

  describe('ignoreRules filtering', () => {
    it('filters out ignored rules from count checks', () => {
      const violations = [
        makeViolation({ id: 'color-contrast', impact: 'critical' }),
        makeViolation({ id: 'image-alt', impact: 'critical' }),
      ];
      const result = evaluateThreshold(80, violations, {
        maxViolations: { critical: 1 },
        ignoreRules: ['color-contrast'],
      });
      // After filtering, only image-alt remains (1 critical), within limit of 1
      expect(result.countPassed).toBe(true);
    });

    it('filters out ignored rules from failOnRules checks', () => {
      const violations = [makeViolation({ id: 'image-alt' })];
      const result = evaluateThreshold(80, violations, {
        failOnRules: ['image-alt'],
        ignoreRules: ['image-alt'],
      });
      expect(result.rulePassed).toBe(true);
    });
  });

  it('produces details messages', () => {
    const result = evaluateThreshold(85, [], { score: 70 });
    expect(result.details.length).toBeGreaterThan(0);
    expect(result.details[0]).toContain('Score 85');
  });
});

describe('getDefaultThreshold', () => {
  it('returns expected defaults', () => {
    const defaults = getDefaultThreshold();
    expect(defaults.score).toBe(70);
    expect(defaults.maxViolations?.critical).toBe(0);
    expect(defaults.maxViolations?.serious).toBe(5);
    expect(defaults.maxViolations?.moderate).toBeNull();
    expect(defaults.maxViolations?.minor).toBeNull();
    expect(defaults.failOnRules).toEqual([]);
    expect(defaults.ignoreRules).toEqual([]);
  });
});
