import { vi, describe, it, expect, beforeEach } from 'vitest';
import { generateReportHtml } from '../templates/report-template';
import type { AxeViolation, AxeNode } from '../../types/scan';
import type { ScoreResult, ScoreGrade } from '../../types/score';
import type { ReportData } from '../../types/report';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeNode(overrides?: Partial<AxeNode>): AxeNode {
  return {
    html: '<div class="test-element">Test</div>',
    target: ['div.test-element'],
    impact: 'serious',
    failureSummary: 'Fix the following: Element must have sufficient color contrast',
    ...overrides,
  };
}

function makeViolation(overrides?: Partial<AxeViolation>): AxeViolation {
  return {
    id: 'color-contrast',
    impact: 'serious',
    tags: ['wcag2aa', 'wcag143', 'cat.color'],
    description:
      'Ensures the contrast between foreground and background colors meets WCAG 2 AA',
    help: 'Elements must have sufficient color contrast',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.6/color-contrast',
    nodes: [makeNode()],
    ...overrides,
  };
}

function makeScore(overrides?: Partial<ScoreResult>): ScoreResult {
  return {
    overallScore: 72,
    grade: 'C' as ScoreGrade,
    principleScores: {
      perceivable: { score: 60, violationCount: 2, passCount: 5 },
      operable: { score: 80, violationCount: 1, passCount: 4 },
      understandable: { score: 90, violationCount: 0, passCount: 3 },
      robust: { score: 85, violationCount: 1, passCount: 2 },
    },
    impactBreakdown: {
      critical: { passed: 2, failed: 1 },
      serious: { passed: 3, failed: 1 },
      moderate: { passed: 4, failed: 1 },
      minor: { passed: 5, failed: 1 },
    },
    totalViolations: 4,
    totalElementViolations: 4,
    totalPasses: 14,
    totalIncomplete: 1,
    aodaCompliant: false,
    ...overrides,
  };
}

function makeReportData(overrides?: Partial<ReportData>): ReportData {
  return {
    url: 'https://example.com',
    scanDate: '2026-01-01',
    engineVersion: '4.0.0',
    score: makeScore(),
    violations: [makeViolation()],
    passes: [],
    incomplete: [],
    aodaNote: 'AODA compliance note text',
    disclaimer: 'Disclaimer text',
    ...overrides,
  };
}

function makeCleanReportData(): ReportData {
  return makeReportData({
    violations: [],
    score: makeScore({
      overallScore: 98,
      grade: 'A',
      principleScores: {
        perceivable: { score: 100, violationCount: 0, passCount: 10 },
        operable: { score: 100, violationCount: 0, passCount: 8 },
        understandable: { score: 100, violationCount: 0, passCount: 6 },
        robust: { score: 100, violationCount: 0, passCount: 4 },
      },
      impactBreakdown: {
        critical: { passed: 5, failed: 0 },
        serious: { passed: 8, failed: 0 },
        moderate: { passed: 10, failed: 0 },
        minor: { passed: 5, failed: 0 },
      },
      totalViolations: 0,
      totalElementViolations: 0,
      totalPasses: 28,
      totalIncomplete: 0,
      aodaCompliant: true,
    }),
  });
}

function makeDirtyReportData(): ReportData {
  return makeReportData({
    violations: [
      makeViolation({ id: 'v-critical', impact: 'critical', tags: ['wcag2aa', 'cat.color'] }),
      makeViolation({ id: 'v-serious', impact: 'serious', tags: ['wcag2aa', 'cat.forms'] }),
      makeViolation({ id: 'v-moderate', impact: 'moderate', tags: ['wcag2aa', 'cat.keyboard'] }),
      makeViolation({ id: 'v-minor', impact: 'minor', tags: ['wcag2aa', 'cat.semantics'] }),
    ],
    score: makeScore({
      overallScore: 30,
      grade: 'F',
      principleScores: {
        perceivable: { score: 20, violationCount: 5, passCount: 2 },
        operable: { score: 30, violationCount: 4, passCount: 3 },
        understandable: { score: 40, violationCount: 3, passCount: 2 },
        robust: { score: 25, violationCount: 2, passCount: 1 },
      },
      impactBreakdown: {
        critical: { passed: 1, failed: 3 },
        serious: { passed: 2, failed: 4 },
        moderate: { passed: 3, failed: 2 },
        minor: { passed: 4, failed: 5 },
      },
      totalViolations: 14,
      totalElementViolations: 14,
      totalPasses: 10,
      totalIncomplete: 3,
      aodaCompliant: false,
    }),
  });
}

// ---------------------------------------------------------------------------
// Structural validation tests
// ---------------------------------------------------------------------------

describe('generateReportHtml', () => {
  let html: string;

  beforeEach(() => {
    html = generateReportHtml(makeReportData());
  });

  it('contains Executive Summary section', () => {
    expect(html).toContain('Executive Summary');
  });

  it('contains WCAG Principles (POUR) section', () => {
    expect(html).toContain('WCAG Principles');
  });

  it('contains Category Breakdown section', () => {
    expect(html).toContain('Category Breakdown');
  });

  it('contains Impact Breakdown section', () => {
    expect(html).toContain('Impact Breakdown');
  });

  it('contains violation details with code snippets', () => {
    expect(html).toContain('&lt;div class=&quot;test-element&quot;&gt;Test&lt;/div&gt;');
    expect(html).toContain('<pre');
    expect(html).toContain('<code');
  });

  it('contains failure summary text', () => {
    expect(html).toContain(
      'Fix the following: Element must have sufficient color contrast',
    );
  });

  it('contains help URL link', () => {
    expect(html).toContain('Learn more');
    expect(html).toContain('dequeuniversity.com');
  });

  it('contains AODA Compliance Note', () => {
    expect(html).toContain('AODA');
  });

  it('contains Disclaimer', () => {
    expect(html).toContain('Disclaimer');
  });

  it('escapes HTML in code snippets', () => {
    const xssData = makeReportData({
      violations: [
        makeViolation({
          nodes: [makeNode({ html: '<script>alert("xss")</script>' })],
        }),
      ],
    });
    const output = generateReportHtml(xssData);
    expect(output).toContain('&lt;script&gt;');
    expect(output).not.toContain('<script>alert');
  });
});

// ---------------------------------------------------------------------------
// Scenario-based tests
// ---------------------------------------------------------------------------

describe('report scenarios', () => {
  it('clean site shows compliant badge and no violation cards', () => {
    const html = generateReportHtml(makeCleanReportData());
    expect(html).toContain('AODA Compliant');
    expect(html).not.toContain('Learn more');
  });

  it('dirty site shows remediation badge and violation details', () => {
    const html = generateReportHtml(makeDirtyReportData());
    expect(html).toContain('Needs Remediation');
    expect(html).toContain('Learn more');
  });

  it('mixed severity renders all impact levels', () => {
    const data = makeReportData({
      violations: [
        makeViolation({ id: 'v-crit', impact: 'critical' }),
        makeViolation({ id: 'v-ser', impact: 'serious' }),
        makeViolation({ id: 'v-mod', impact: 'moderate' }),
        makeViolation({ id: 'v-min', impact: 'minor' }),
      ],
    });
    const html = generateReportHtml(data);
    expect(html).toContain('critical');
    expect(html).toContain('serious');
    expect(html).toContain('moderate');
    expect(html).toContain('minor');
  });

  it('large violation set renders without error', () => {
    const violations = Array.from({ length: 55 }, (_, i) =>
      makeViolation({ id: `rule-${i}` }),
    );
    const data = makeReportData({ violations });
    const html = generateReportHtml(data);
    expect(html.length).toBeGreaterThan(1000);
  });

  it('caps nodes at 5 per violation with overflow text', () => {
    const nodes = Array.from({ length: 10 }, (_, i) =>
      makeNode({ html: `<span>Node ${i}</span>` }),
    );
    const data = makeReportData({
      violations: [makeViolation({ nodes })],
    });
    const html = generateReportHtml(data);

    // Count <pre occurrences within the violation card
    const preMatches = html.match(/<pre /g) || [];
    expect(preMatches.length).toBe(5);
    expect(html).toContain('and 5 more element(s)');
  });

  it('category breakdown reflects violation categories', () => {
    const data = makeReportData({
      violations: [
        makeViolation({ id: 'v-color', tags: ['wcag2aa', 'cat.color'] }),
        makeViolation({ id: 'v-forms', tags: ['wcag2aa', 'cat.forms'] }),
        makeViolation({ id: 'v-keyboard', tags: ['wcag2aa', 'cat.keyboard'] }),
      ],
    });
    const html = generateReportHtml(data);
    expect(html).toContain('Color &amp; Contrast');
    expect(html).toContain('Forms');
    expect(html).toContain('Keyboard');
  });

  it('handles violations with no failureSummary gracefully', () => {
    const data = makeReportData({
      violations: [
        makeViolation({
          nodes: [makeNode({ failureSummary: undefined })],
        }),
      ],
    });
    const html = generateReportHtml(data);
    expect(html).not.toContain('Fix the following');
  });
});

// ---------------------------------------------------------------------------
// PDF smoke test (mocked Puppeteer — matches pdf-generator.test.ts pattern)
// ---------------------------------------------------------------------------

const pdfMocks = vi.hoisted(() => {
  const mockPage = {
    setContent: vi.fn().mockResolvedValue(undefined),
    pdf: vi.fn().mockResolvedValue(Buffer.from('mock-pdf-content')),
  };
  const mockBrowser = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    mockPage,
    mockBrowser,
    launch: vi.fn().mockResolvedValue(mockBrowser),
  };
});

vi.mock('puppeteer', () => ({
  default: { launch: pdfMocks.launch },
}));

// Dynamic import so the mock is applied
import { generatePdf } from '../pdf-generator';

describe('PDF smoke test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pdfMocks.launch.mockResolvedValue(pdfMocks.mockBrowser);
    pdfMocks.mockBrowser.newPage.mockResolvedValue(pdfMocks.mockPage);
    pdfMocks.mockPage.setContent.mockResolvedValue(undefined);
    pdfMocks.mockPage.pdf.mockResolvedValue(Buffer.from('mock-pdf-content'));
  });

  it('generates PDF buffer from enhanced report HTML', async () => {
    const reportHtml = generateReportHtml(makeReportData());
    const result = await generatePdf(reportHtml);

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });

  it('passes HTML with enhanced sections to setContent', async () => {
    const reportHtml = generateReportHtml(makeReportData());
    await generatePdf(reportHtml);

    expect(pdfMocks.mockPage.setContent).toHaveBeenCalledWith(
      expect.stringContaining('Category Breakdown'),
      expect.any(Object),
    );
  });
});
