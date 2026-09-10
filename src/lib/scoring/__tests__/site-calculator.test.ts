import { describe, it, expect } from 'vitest';
import { calculateSiteScore, aggregateViolations, generatePageSummaries } from '../site-calculator';
import type { ScanRecord, AxeViolation, AxePass } from '../../types/scan';
import type { ScoreResult } from '../../types/score';

function makeViolation(overrides: Partial<AxeViolation> = {}): AxeViolation {
  return {
    id: 'color-contrast',
    impact: 'serious',
    tags: ['wcag2aa', 'wcag143'],
    description: 'Insufficient contrast',
    help: 'Ensure contrast ratio',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
    nodes: [{ html: '<p>text</p>', target: ['p'], impact: 'serious', failureSummary: 'Fix' }],
    ...overrides,
  };
}

function makePass(overrides: Partial<AxePass> = {}): AxePass {
  return {
    id: 'html-has-lang',
    tags: ['wcag2a', 'wcag311'],
    description: 'html element has a lang attribute',
    nodes: [{ html: '<html lang="en">', target: ['html'] }],
    ...overrides,
  };
}

function makeScore(overrides: Partial<ScoreResult> = {}): ScoreResult {
  return {
    overallScore: 90,
    grade: 'A',
    principleScores: {
      perceivable: { score: 100, violationCount: 0, passCount: 1 },
      operable: { score: 100, violationCount: 0, passCount: 0 },
      understandable: { score: 100, violationCount: 0, passCount: 0 },
      robust: { score: 100, violationCount: 0, passCount: 0 },
    },
    impactBreakdown: {
      critical: { passed: 0, failed: 0 },
      serious: { passed: 0, failed: 0 },
      moderate: { passed: 0, failed: 0 },
      minor: { passed: 1, failed: 0 },
    },
    totalViolations: 0,
    totalElementViolations: 0,
    totalPasses: 1,
    totalIncomplete: 0,
    aodaCompliant: true,
    ...overrides,
  };
}

function makeRecord(
  id: string,
  url: string,
  score: number,
  violations: AxeViolation[] = [],
  passes: AxePass[] = [makePass()],
): ScanRecord {
  return {
    id,
    url,
    status: 'complete',
    progress: 100,
    message: 'Done',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:01:00.000Z',
    results: {
      url,
      timestamp: '2026-01-01T00:01:00.000Z',
      engineVersion: 'axe-core 4.10',
      violations,
      passes,
      incomplete: [],
      inapplicable: [],
      score: makeScore({
        overallScore: score,
        grade: score >= 90 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : score >= 30 ? 'D' : 'F',
        totalViolations: violations.length,
        totalElementViolations: violations.reduce((sum: number, v: {nodes: unknown[]}) => sum + v.nodes.length, 0),
        totalPasses: passes.length,
        aodaCompliant: violations.length === 0,
      }),
    },
  };
}

describe('calculateSiteScore', () => {
  it('returns correct score for a single completed page', () => {
    const records = [makeRecord('p1', 'https://example.com', 85)];
    const result = calculateSiteScore(records);

    expect(result.overallScore).toBe(85);
    expect(result.lowestPageScore).toBe(85);
    expect(result.highestPageScore).toBe(85);
    expect(result.medianPageScore).toBe(85);
    expect(result.pageCount).toBe(1);
  });

  it('computes average, min, max, median for multiple pages', () => {
    const records = [
      makeRecord('p1', 'https://example.com/a', 60),
      makeRecord('p2', 'https://example.com/b', 80),
      makeRecord('p3', 'https://example.com/c', 100),
    ];
    const result = calculateSiteScore(records);

    expect(result.overallScore).toBe(80); // (60+80+100)/3 = 80
    expect(result.lowestPageScore).toBe(60);
    expect(result.highestPageScore).toBe(100);
    expect(result.medianPageScore).toBe(80);
    expect(result.pageCount).toBe(3);
  });

  it('filters out non-completed pages', () => {
    const completed = makeRecord('p1', 'https://example.com/a', 90);
    const pending: ScanRecord = {
      id: 'p2',
      url: 'https://example.com/b',
      status: 'pending',
      progress: 0,
      message: 'Queued',
      startedAt: '2026-01-01T00:00:00.000Z',
    };
    const errored: ScanRecord = {
      id: 'p3',
      url: 'https://example.com/c',
      status: 'error',
      progress: 0,
      message: 'Failed',
      startedAt: '2026-01-01T00:00:00.000Z',
      error: 'Timeout',
    };

    const result = calculateSiteScore([completed, pending, errored]);
    expect(result.pageCount).toBe(1);
    expect(result.overallScore).toBe(90);
  });

  it('returns aodaCompliant true when all pages have no violations', () => {
    const records = [
      makeRecord('p1', 'https://example.com/a', 100),
      makeRecord('p2', 'https://example.com/b', 95),
    ];
    const result = calculateSiteScore(records);
    expect(result.aodaCompliant).toBe(true);
  });

  it('returns aodaCompliant false when some pages have violations', () => {
    const records = [
      makeRecord('p1', 'https://example.com/a', 100),
      makeRecord('p2', 'https://example.com/b', 60, [makeViolation()]),
    ];
    const result = calculateSiteScore(records);
    expect(result.aodaCompliant).toBe(false);
  });

  it('returns zeros and grade F for empty array', () => {
    const result = calculateSiteScore([]);
    expect(result.overallScore).toBe(0);
    expect(result.grade).toBe('F');
    expect(result.pageCount).toBe(0);
    expect(result.lowestPageScore).toBe(0);
    expect(result.highestPageScore).toBe(0);
    expect(result.medianPageScore).toBe(0);
  });

  it('assigns correct grade boundaries', () => {
    const r90 = calculateSiteScore([makeRecord('p1', 'https://a.com', 90)]);
    expect(r90.grade).toBe('A');

    const r70 = calculateSiteScore([makeRecord('p1', 'https://a.com', 70)]);
    expect(r70.grade).toBe('B');

    const r50 = calculateSiteScore([makeRecord('p1', 'https://a.com', 50)]);
    expect(r50.grade).toBe('C');

    const r30 = calculateSiteScore([makeRecord('p1', 'https://a.com', 30)]);
    expect(r30.grade).toBe('D');

    const r10 = calculateSiteScore([makeRecord('p1', 'https://a.com', 10)]);
    expect(r10.grade).toBe('F');
  });

  it('computes even-count median correctly', () => {
    const records = [
      makeRecord('p1', 'https://a.com/1', 60),
      makeRecord('p2', 'https://a.com/2', 80),
      makeRecord('p3', 'https://a.com/3', 90),
      makeRecord('p4', 'https://a.com/4', 100),
    ];
    const result = calculateSiteScore(records);
    // median of [60,80,90,100] = (80+90)/2 = 85
    expect(result.medianPageScore).toBe(85);
  });
});

describe('aggregateViolations', () => {
  it('groups same rule across multiple pages', () => {
    const v1 = makeViolation({ id: 'color-contrast', nodes: [{ html: '<p>a</p>', target: ['p'], impact: 'serious', failureSummary: 'Fix' }] });
    const v2 = makeViolation({ id: 'color-contrast', nodes: [{ html: '<span>b</span>', target: ['span'], impact: 'serious', failureSummary: 'Fix' }, { html: '<div>c</div>', target: ['div'], impact: 'serious', failureSummary: 'Fix' }] });

    const records = [
      makeRecord('p1', 'https://a.com/1', 70, [v1]),
      makeRecord('p2', 'https://a.com/2', 60, [v2]),
    ];

    const result = aggregateViolations(records);
    expect(result).toHaveLength(1);
    expect(result[0].ruleId).toBe('color-contrast');
    expect(result[0].totalInstances).toBe(3); // 1 + 2
    expect(result[0].affectedPages).toHaveLength(2);
  });

  it('keeps different rules separate', () => {
    const v1 = makeViolation({ id: 'color-contrast' });
    const v2 = makeViolation({ id: 'image-alt', tags: ['wcag2a', 'wcag111'] });

    const records = [makeRecord('p1', 'https://a.com', 60, [v1, v2])];
    const result = aggregateViolations(records);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.ruleId).sort()).toEqual(['color-contrast', 'image-alt']);
  });

  it('returns empty array when no violations', () => {
    const records = [makeRecord('p1', 'https://a.com', 100)];
    const result = aggregateViolations(records);
    expect(result).toHaveLength(0);
  });

  it('skips non-completed pages', () => {
    const pending: ScanRecord = {
      id: 'p1',
      url: 'https://a.com',
      status: 'pending',
      progress: 0,
      message: 'Queued',
      startedAt: '2026-01-01T00:00:00.000Z',
    };
    const result = aggregateViolations([pending]);
    expect(result).toHaveLength(0);
  });
});

describe('generatePageSummaries', () => {
  it('returns correct summary fields for completed pages', () => {
    const records = [makeRecord('p1', 'https://example.com', 85, [], [makePass()])];
    const summaries = generatePageSummaries(records);

    expect(summaries).toHaveLength(1);
    expect(summaries[0].pageId).toBe('p1');
    expect(summaries[0].url).toBe('https://example.com');
    expect(summaries[0].score).toBe(85);
    expect(summaries[0].violationCount).toBe(0);
    expect(summaries[0].passCount).toBe(1);
    expect(summaries[0].status).toBe('complete');
    expect(summaries[0].scannedAt).toBeDefined();
  });

  it('uses completedAt as scannedAt when available', () => {
    const records = [makeRecord('p1', 'https://example.com', 90)];
    const summaries = generatePageSummaries(records);
    expect(summaries[0].scannedAt).toBe('2026-01-01T00:01:00.000Z');
  });

  it('skips non-completed pages', () => {
    const pending: ScanRecord = {
      id: 'p1',
      url: 'https://a.com',
      status: 'pending',
      progress: 0,
      message: 'Queued',
      startedAt: '2026-01-01T00:00:00.000Z',
    };
    const completed = makeRecord('p2', 'https://b.com', 90);

    const summaries = generatePageSummaries([pending, completed]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].pageId).toBe('p2');
  });

  it('returns empty array for empty input', () => {
    const summaries = generatePageSummaries([]);
    expect(summaries).toHaveLength(0);
  });

  it('assigns correct grade for each page', () => {
    const records = [
      makeRecord('p1', 'https://a.com', 95),
      makeRecord('p2', 'https://b.com', 55),
    ];
    const summaries = generatePageSummaries(records);
    expect(summaries[0].grade).toBe('A');
    expect(summaries[1].grade).toBe('C');
  });
});
