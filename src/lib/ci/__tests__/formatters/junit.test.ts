import { describe, it, expect } from 'vitest';
import { formatJunit } from '../../formatters/junit';
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
      details: [],
    },
    violations: [],
    ...overrides,
  };
}

describe('formatJunit', () => {
  it('produces valid XML structure', () => {
    const output = formatJunit(makeCiResult());
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(output).toContain('<testsuites>');
    expect(output).toContain('</testsuites>');
    expect(output).toContain('<testsuite');
    expect(output).toContain('</testsuite>');
  });

  it('creates a testcase for each violation', () => {
    const result = makeCiResult({
      violations: [
        { ruleId: 'color-contrast', impact: 'serious', description: 'Insufficient contrast', instanceCount: 3, helpUrl: 'https://example.com/help' },
        { ruleId: 'image-alt', impact: 'critical', description: 'Missing alt text', instanceCount: 1, helpUrl: 'https://example.com/help2' },
      ],
      violationCount: 2,
    });
    const output = formatJunit(result);
    expect(output).toContain('name="color-contrast"');
    expect(output).toContain('name="image-alt"');
    expect(output).toContain('<failure');
    // Two testcases
    const testcaseCount = (output.match(/<testcase/g) || []).length;
    expect(testcaseCount).toBe(2);
  });

  it('includes instance count in failure message', () => {
    const result = makeCiResult({
      violations: [
        { ruleId: 'color-contrast', impact: 'serious', description: 'Insufficient contrast', instanceCount: 3, helpUrl: 'https://example.com/help' },
      ],
    });
    const output = formatJunit(result);
    expect(output).toContain('3 instances');
  });

  it('uses singular "instance" for count of 1', () => {
    const result = makeCiResult({
      violations: [
        { ruleId: 'color-contrast', impact: 'serious', description: 'Insufficient contrast', instanceCount: 1, helpUrl: 'https://example.com/help' },
      ],
    });
    const output = formatJunit(result);
    expect(output).toContain('1 instance)');
    expect(output).not.toContain('1 instances');
  });

  it('escapes XML special characters', () => {
    const result = makeCiResult({
      url: 'https://example.com/page?a=1&b=2',
      violations: [
        {
          ruleId: 'rule-<test>',
          impact: 'minor',
          description: 'Description with <html> & "quotes" and \'apostrophes\'',
          instanceCount: 1,
          helpUrl: 'https://example.com',
        },
      ],
    });
    const output = formatJunit(result);
    expect(output).toContain('&amp;');
    expect(output).toContain('&lt;');
    expect(output).toContain('&gt;');
    expect(output).toContain('&quot;');
    expect(output).toContain('&apos;');
    // Should NOT contain unescaped raw characters in attribute/content context
    expect(output).not.toMatch(/name="[^"]*<[^"]*"/);
  });

  it('produces no testcases when there are no violations', () => {
    const output = formatJunit(makeCiResult());
    expect(output).not.toContain('<testcase');
  });
});
