import { describe, it, expect } from 'vitest';
import { parseAxeResults } from '../result-parser';
import type { AxeResults } from 'axe-core';

function makeAxeResults(overrides: Partial<AxeResults> = {}): AxeResults {
  return {
    violations: [
      {
        id: 'color-contrast',
        impact: 'serious',
        tags: ['wcag2aa', 'wcag143'],
        description: 'Elements must have sufficient color contrast',
        help: 'Ensure contrast ratio is sufficient',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
        nodes: [
          {
            html: '<p style="color:#ccc">Low contrast</p>',
            target: ['p'],
            impact: 'serious',
            failureSummary: 'Fix the following: Element has insufficient color contrast',
            any: [],
            all: [],
            none: [],
          },
        ],
      },
    ],
    passes: [
      {
        id: 'aria-label',
        tags: ['wcag2a', 'wcag111'],
        description: 'ARIA label is present',
        help: 'Elements have an ARIA label',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-label',
        impact: undefined,
        nodes: [
          {
            html: '<div aria-label="nav">content</div>',
            target: ['div'],
            impact: undefined,
            any: [],
            all: [],
            none: [],
          },
        ],
      },
    ],
    incomplete: [
      {
        id: 'heading-order',
        impact: 'moderate',
        tags: ['best-practice'],
        description: 'Heading levels should increase by one',
        help: 'Check heading order',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/heading-order',
        nodes: [
          {
            html: '<h3>Skipped</h3>',
            target: ['h3'],
            impact: 'moderate',
            failureSummary: 'Review heading order',
            any: [],
            all: [],
            none: [],
          },
        ],
      },
    ],
    inapplicable: [
      {
        id: 'frame-title',
        tags: ['wcag2a', 'wcag241'],
        description: 'Frames must have title',
        help: 'Frame title',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/frame-title',
        impact: undefined,
        nodes: [],
      },
    ],
    testEngine: { name: 'axe-core', version: '4.10.0' },
    testRunner: { name: 'axe' },
    testEnvironment: {
      userAgent: 'test',
      windowWidth: 1024,
      windowHeight: 768,
      orientationAngle: 0,
      orientationType: 'landscape-primary',
    },
    timestamp: '2026-01-01T00:00:00.000Z',
    url: 'https://example.com',
    toolOptions: {},
    ...overrides,
  } as unknown as AxeResults;
}

describe('parseAxeResults', () => {
  it('maps violations with correct fields including principle', () => {
    const raw = makeAxeResults();
    const result = parseAxeResults('https://example.com', raw);

    expect(result.violations).toHaveLength(1);
    const v = result.violations[0];
    expect(v.id).toBe('color-contrast');
    expect(v.impact).toBe('serious');
    expect(v.tags).toContain('wcag143');
    expect(v.description).toBe('Elements must have sufficient color contrast');
    expect(v.help).toBe('Ensure contrast ratio is sufficient');
    expect(v.helpUrl).toContain('color-contrast');
    expect(v.nodes).toHaveLength(1);
    expect(v.nodes[0].target).toEqual(['p']);
    expect(v.nodes[0].html).toContain('Low contrast');
    expect(v.nodes[0].failureSummary).toBeDefined();
    // wcag143 → first digit = 1 → perceivable
    expect(v.principle).toBe('perceivable');
  });

  it('maps passes correctly', () => {
    const raw = makeAxeResults();
    const result = parseAxeResults('https://example.com', raw);

    expect(result.passes).toHaveLength(1);
    const p = result.passes[0];
    expect(p.id).toBe('aria-label');
    expect(p.tags).toContain('wcag111');
    expect(p.nodes).toHaveLength(1);
    expect(p.nodes[0].target).toEqual(['div']);
  });

  it('maps incomplete results', () => {
    const raw = makeAxeResults();
    const result = parseAxeResults('https://example.com', raw);

    expect(result.incomplete).toHaveLength(1);
    const inc = result.incomplete[0];
    expect(inc.id).toBe('heading-order');
    expect(inc.impact).toBe('moderate');
    expect(inc.nodes).toHaveLength(1);
    expect(inc.nodes[0].target).toEqual(['h3']);
  });

  it('maps inapplicable results', () => {
    const raw = makeAxeResults();
    const result = parseAxeResults('https://example.com', raw);

    expect(result.inapplicable).toHaveLength(1);
    expect(result.inapplicable[0].id).toBe('frame-title');
    expect(result.inapplicable[0].tags).toContain('wcag241');
  });

  it('includes score from real calculator', () => {
    const raw = makeAxeResults();
    const result = parseAxeResults('https://example.com', raw);

    expect(result.score).toBeDefined();
    expect(result.score.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.score.overallScore).toBeLessThanOrEqual(100);
    expect(result.score.grade).toBeDefined();
    expect(result.score.totalViolations).toBe(1);
    expect(result.score.totalPasses).toBe(1);
  });

  it('extracts engine version from testEngine', () => {
    const raw = makeAxeResults();
    const result = parseAxeResults('https://example.com', raw);
    expect(result.engineVersion).toBe('axe-core 4.10.0');
  });

  it('sets url and timestamp', () => {
    const raw = makeAxeResults();
    const result = parseAxeResults('https://test.org', raw);
    expect(result.url).toBe('https://test.org');
    expect(result.timestamp).toBeDefined();
    // timestamp should be a valid ISO string
    expect(() => new Date(result.timestamp)).not.toThrow();
  });

  it('handles empty arrays', () => {
    const raw = makeAxeResults({
      violations: [],
      passes: [],
      incomplete: [],
      inapplicable: [],
    } as Partial<AxeResults>);

    const result = parseAxeResults('https://example.com', raw);
    expect(result.violations).toHaveLength(0);
    expect(result.passes).toHaveLength(0);
    expect(result.incomplete).toHaveLength(0);
    expect(result.inapplicable).toHaveLength(0);
    expect(result.score.overallScore).toBe(100);
    expect(result.score.aodaCompliant).toBe(true);
  });

  it('returns unknown when testEngine version is missing', () => {
    const raw = makeAxeResults({ testEngine: undefined } as Partial<AxeResults>);
    const result = parseAxeResults('https://example.com', raw);
    expect(result.engineVersion).toBe('axe-core unknown');
  });

  it('handles nodes with multiple selectors', () => {
    const raw = makeAxeResults({
      violations: [
        {
          id: 'list-item',
          impact: 'minor',
          tags: ['wcag2a', 'wcag131'],
          description: 'List items must be inside a list',
          help: 'li must be in ul/ol',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/list-item',
          nodes: [
            {
              html: '<li>orphan</li>',
              target: ['#main', '.content', 'li'],
              impact: 'minor',
              failureSummary: 'Fix',
              any: [],
              all: [],
              none: [],
            },
          ],
        },
      ],
    } as Partial<AxeResults>);

    const result = parseAxeResults('https://example.com', raw);
    expect(result.violations[0].nodes[0].target).toEqual(['#main', '.content', 'li']);
  });
});

describe('parseAxeResults with MultiEngineResults', () => {
  it('parses MultiEngineResults and includes all engine versions in engineVersion string', () => {
    const multiResults = {
      violations: [{
        id: 'image-alt',
        impact: 'critical' as const,
        tags: ['wcag2a', 'wcag111'],
        description: 'Images must have alt text',
        help: 'Ensure images have alt text',
        helpUrl: 'https://able.ibm.com/rules/tools/help/img_alt_valid',
        nodes: [{
          html: '<img src="photo.jpg">',
          target: ['img'],
          impact: 'critical',
          failureSummary: 'No alt text',
        }],
        principle: 'perceivable',
        engine: 'ibm-equal-access' as const,
      }],
      passes: [],
      incomplete: [],
      inapplicable: [],
      engineVersions: { 'axe-core': '4.10.0', 'ibm-equal-access': 'latest' },
    };

    const result = parseAxeResults('https://example.com', multiResults);
    expect(result.engineVersion).toContain('axe-core 4.10.0');
    expect(result.engineVersion).toContain('ibm-equal-access latest');
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].id).toBe('image-alt');
  });

  it('sets principle from violation when already present', () => {
    const multiResults = {
      violations: [{
        id: 'color-contrast',
        impact: 'serious' as const,
        tags: ['wcag2aa', 'wcag143'],
        description: 'Contrast',
        help: 'Contrast',
        helpUrl: '',
        nodes: [],
        principle: 'perceivable',
        engine: 'axe-core' as const,
      }],
      passes: [],
      incomplete: [],
      inapplicable: [],
      engineVersions: { 'axe-core': '4.10.0' },
    };

    const result = parseAxeResults('https://example.com', multiResults);
    expect(result.violations[0].principle).toBe('perceivable');
  });

  it('computes score from multi-engine violations', () => {
    const multiResults = {
      violations: [{
        id: 'image-alt',
        impact: 'critical' as const,
        tags: ['wcag2a'],
        description: 'Alt',
        help: 'Alt',
        helpUrl: '',
        nodes: [{ html: '<img>', target: ['img'], impact: 'critical', failureSummary: '' }],
        engine: 'ibm-equal-access' as const,
      }],
      passes: [],
      incomplete: [],
      inapplicable: [],
      engineVersions: { 'axe-core': '4.10.0', 'ibm-equal-access': 'latest' },
    };

    const result = parseAxeResults('https://example.com', multiResults);
    expect(result.score).toBeDefined();
    expect(result.score.totalViolations).toBe(1);
  });
});
