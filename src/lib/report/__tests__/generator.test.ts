import { describe, it, expect } from 'vitest';
import { assembleReportData } from '../generator';
import type { ScanResults, AxeViolation } from '../../types/scan';
import type { ScoreResult } from '../../types/score';

function makeViolation(impact: AxeViolation['impact'], id: string): AxeViolation {
  return {
    id,
    impact,
    tags: ['wcag111'],
    description: `${id} description`,
    help: `${id} help`,
    helpUrl: `https://help.example.com/${id}`,
    nodes: [{ html: '<div></div>', target: ['div'], impact }],
  };
}

function makeScanResults(violations: AxeViolation[]): ScanResults {
  const score: ScoreResult = {
    overallScore: 80,
    grade: 'B',
    principleScores: {
      perceivable: { score: 80, violationCount: 1, passCount: 4 },
      operable: { score: 100, violationCount: 0, passCount: 3 },
      understandable: { score: 100, violationCount: 0, passCount: 2 },
      robust: { score: 100, violationCount: 0, passCount: 1 },
    },
    impactBreakdown: {
      critical: { passed: 0, failed: 0 },
      serious: { passed: 0, failed: 0 },
      moderate: { passed: 0, failed: 0 },
      minor: { passed: 10, failed: 0 },
    },
    totalViolations: violations.length,
    totalElementViolations: 0,
    totalPasses: 10,
    totalIncomplete: 0,
    aodaCompliant: violations.length === 0,
  };

  return {
    url: 'https://example.com',
    timestamp: '2026-01-01T00:00:00.000Z',
    engineVersion: '4.0.0',
    violations,
    passes: [],
    incomplete: [],
    inapplicable: [],
    score,
  };
}

describe('assembleReportData', () => {
  it('sorts violations by impact severity: critical → serious → moderate → minor', () => {
    const violations = [
      makeViolation('minor', 'v-minor'),
      makeViolation('critical', 'v-critical'),
      makeViolation('moderate', 'v-moderate'),
      makeViolation('serious', 'v-serious'),
    ];
    const report = assembleReportData(makeScanResults(violations));

    expect(report.violations[0].impact).toBe('critical');
    expect(report.violations[1].impact).toBe('serious');
    expect(report.violations[2].impact).toBe('moderate');
    expect(report.violations[3].impact).toBe('minor');
  });

  it('includes all required fields', () => {
    const report = assembleReportData(makeScanResults([]));
    expect(report.url).toBe('https://example.com');
    expect(report.scanDate).toBeDefined();
    expect(report.engineVersion).toBe('4.0.0');
    expect(report.score).toBeDefined();
    expect(report.violations).toBeDefined();
    expect(report.passes).toBeDefined();
    expect(report.incomplete).toBeDefined();
  });

  it('includes aodaNote string', () => {
    const report = assembleReportData(makeScanResults([]));
    expect(report.aodaNote).toContain('Accessibility for Ontarians with Disabilities Act');
    expect(report.aodaNote).toContain('WCAG 2.2 Level AA');
  });

  it('includes disclaimer string', () => {
    const report = assembleReportData(makeScanResults([]));
    expect(report.disclaimer).toContain('Automated accessibility testing');
    expect(report.disclaimer).toContain('manual testing');
  });

  it('does not mutate original violations array', () => {
    const violations = [
      makeViolation('minor', 'v-minor'),
      makeViolation('critical', 'v-critical'),
    ];
    const original = [...violations];
    assembleReportData(makeScanResults(violations));
    expect(violations[0].id).toBe(original[0].id);
    expect(violations[1].id).toBe(original[1].id);
  });
});
