import { describe, it, expect } from 'vitest';
import { formatJson } from '../../formatters/json';
import type { CiResult } from '../../../types/crawl';

function makeCiResult(overrides: Partial<CiResult> = {}): CiResult {
  return {
    passed: true,
    score: 95,
    grade: 'A',
    url: 'https://example.com',
    timestamp: '2026-01-01T00:00:00.000Z',
    violationCount: 0,
    thresholdEvaluation: {
      scorePassed: true,
      countPassed: true,
      rulePassed: true,
      details: ['Score 95 meets threshold 70'],
    },
    violations: [],
    ...overrides,
  };
}

describe('formatJson', () => {
  it('produces valid parseable JSON', () => {
    const result = makeCiResult();
    const output = formatJson(result);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('output structure matches input', () => {
    const result = makeCiResult({
      violations: [
        { ruleId: 'color-contrast', impact: 'serious', description: 'Insufficient contrast', instanceCount: 3, helpUrl: 'https://example.com/help' },
      ],
      violationCount: 1,
    });
    const output = JSON.parse(formatJson(result));
    expect(output.passed).toBe(true);
    expect(output.score).toBe(95);
    expect(output.violations).toHaveLength(1);
    expect(output.violations[0].ruleId).toBe('color-contrast');
  });

  it('formats with 2-space indentation', () => {
    const result = makeCiResult();
    const output = formatJson(result);
    // JSON.stringify(x, null, 2) produces 2-space indented output
    expect(output).toBe(JSON.stringify(result, null, 2));
  });
});
