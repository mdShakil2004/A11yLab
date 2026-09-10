import { describe, it, expect } from 'vitest';
import {
  normalizeIbmResults,
  normalizeCustomResults,
  normalizeAxeResults,
  normalizeAlfa,
  deduplicateViolations,
  normalizeAndMerge,
  mergeAcrossStates,
  type IbmReportResult,
  type CustomCheckResult,
  type AlfaRawOutcome,
} from '../result-normalizer';
import type { AxeViolation, NormalizedViolation, MultiEngineResults } from '../../types/scan';
import type { AxeResults } from 'axe-core';

function makeIbmResult(overrides: Partial<IbmReportResult> = {}): IbmReportResult {
  return {
    ruleId: 'img_alt_valid',
    value: ['VIOLATION', 'FAIL'],
    path: { dom: 'html > body > img' },
    message: 'Image does not have alt text',
    snippet: '<img src="photo.jpg">',
    reasonId: '1',
    level: 'violation',
    ...overrides,
  };
}

function makeAxeViolation(overrides: Partial<AxeViolation> = {}): AxeViolation {
  return {
    id: 'image-alt',
    impact: 'serious',
    tags: ['wcag2a', 'wcag111'],
    description: 'Images must have alt text',
    help: 'Ensure images have alt text',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
    nodes: [{
      html: '<img src="photo.jpg">',
      target: ['img'],
      impact: 'serious',
      failureSummary: 'Fix: add alt attribute',
    }],
    principle: 'perceivable',
    ...overrides,
  };
}

function makeAxeResults(overrides: Partial<AxeResults> = {}): AxeResults {
  return {
    violations: [],
    passes: [],
    incomplete: [],
    inapplicable: [],
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

describe('normalizeIbmResults', () => {
  it('maps IBM violation level to critical impact', () => {
    const result = normalizeIbmResults([makeIbmResult({ level: 'violation' })]);
    expect(result).toHaveLength(1);
    expect(result[0].impact).toBe('critical');
    expect(result[0].engine).toBe('ibm-equal-access');
  });

  it('maps IBM potentialviolation level to serious impact', () => {
    const result = normalizeIbmResults([makeIbmResult({ level: 'potentialviolation' })]);
    expect(result[0].impact).toBe('serious');
  });

  it('maps IBM recommendation level to moderate impact', () => {
    const result = normalizeIbmResults([makeIbmResult({ level: 'recommendation' })]);
    expect(result[0].impact).toBe('moderate');
  });

  it('maps IBM potentialrecommendation level to moderate impact', () => {
    const result = normalizeIbmResults([makeIbmResult({ level: 'potentialrecommendation' })]);
    expect(result[0].impact).toBe('moderate');
  });

  it('maps IBM manual level to minor impact', () => {
    const result = normalizeIbmResults([makeIbmResult({ level: 'manual' })]);
    expect(result[0].impact).toBe('minor');
  });

  it('defaults to moderate for unknown level', () => {
    const result = normalizeIbmResults([makeIbmResult({ level: 'something-unknown' })]);
    expect(result[0].impact).toBe('moderate');
  });

  it('infers level from value tuple when level not provided', () => {
    const result = normalizeIbmResults([makeIbmResult({ level: undefined, value: ['VIOLATION', 'FAIL'] })]);
    expect(result[0].impact).toBe('critical');
  });

  it('infers potentialviolation from POTENTIAL confidence', () => {
    const result = normalizeIbmResults([makeIbmResult({ level: undefined, value: ['VIOLATION', 'POTENTIAL'] })]);
    expect(result[0].impact).toBe('serious');
  });

  it('infers manual from MANUAL confidence', () => {
    const result = normalizeIbmResults([makeIbmResult({ level: undefined, value: ['VIOLATION', 'MANUAL'] })]);
    expect(result[0].impact).toBe('minor');
  });

  it('infers recommendation from RECOMMENDATION policy', () => {
    const result = normalizeIbmResults([makeIbmResult({ level: undefined, value: ['RECOMMENDATION', 'FAIL'] })]);
    expect(result[0].impact).toBe('moderate');
  });

  it('defaults to recommendation for unknown value tuple', () => {
    const result = normalizeIbmResults([makeIbmResult({ level: undefined, value: ['UNKNOWN', 'UNKNOWN'] })]);
    expect(result[0].impact).toBe('moderate');
  });

  it('filters out PASS results', () => {
    const result = normalizeIbmResults([makeIbmResult({ value: ['VIOLATION', 'PASS'] })]);
    expect(result).toHaveLength(0);
  });

  it('maps ruleId to id', () => {
    const result = normalizeIbmResults([makeIbmResult({ ruleId: 'aria_label_valid' })]);
    expect(result[0].id).toBe('aria_label_valid');
  });

  it('maps path.dom to target array', () => {
    const result = normalizeIbmResults([makeIbmResult({ path: { dom: 'body > div > p' } })]);
    expect(result[0].nodes[0].target).toEqual(['body > div > p']);
  });

  it('falls back to path.aria when path.dom is absent', () => {
    const result = normalizeIbmResults([makeIbmResult({ path: { aria: '/document/main' } })]);
    expect(result[0].nodes[0].target).toEqual(['/document/main']);
  });

  it('uses empty string target when no path keys present', () => {
    const result = normalizeIbmResults([makeIbmResult({ path: {} })]);
    expect(result[0].nodes[0].target).toEqual(['']);
  });

  it('maps message to description and help', () => {
    const result = normalizeIbmResults([makeIbmResult({ message: 'Test message', help: 'Test help' })]);
    expect(result[0].description).toBe('Test message');
    expect(result[0].help).toBe('Test message');
  });

  it('uses message as help text when help is not provided', () => {
    const result = normalizeIbmResults([makeIbmResult({ message: 'Test message', help: undefined })]);
    expect(result[0].help).toBe('Test message');
  });

  it('uses empty snippet as empty html', () => {
    const result = normalizeIbmResults([makeIbmResult({ snippet: '' })]);
    expect(result[0].nodes[0].html).toBe('');
  });

  it('constructs IBM helpUrl from ruleId', () => {
    const result = normalizeIbmResults([makeIbmResult({ ruleId: 'img_alt_valid' })]);
    expect(result[0].helpUrl).toBe('https://able.ibm.com/rules/archives/latest/doc/en-US/img_alt_valid.html');
  });

  it('extracts base URL from IBM help field and normalizes to latest archive', () => {
    const result = normalizeIbmResults([makeIbmResult({
      ruleId: 'style_color_misuse',
      help: 'https://able.ibm.com/rules/archives/2026.03.04/doc/en-US/style_color_misuse.html#ruleInfo=%7B%22someKey%22%3A%22someValue%22%7D',
    })]);
    expect(result[0].helpUrl).toBe('https://able.ibm.com/rules/archives/latest/doc/en-US/style_color_misuse.html');
  });

  it('falls back to archive URL when help is not a URL', () => {
    const result = normalizeIbmResults([makeIbmResult({
      ruleId: 'img_alt_valid',
      help: 'Some non-URL help text',
    })]);
    expect(result[0].helpUrl).toBe('https://able.ibm.com/rules/archives/latest/doc/en-US/img_alt_valid.html');
  });

  it('uses message as help text even when IBM help field is a URL', () => {
    const result = normalizeIbmResults([makeIbmResult({
      message: 'Human readable text',
      help: 'https://able.ibm.com/rules/archives/2026.03.04/doc/en-US/some_rule.html',
    })]);
    expect(result[0].help).toBe('Human readable text');
    expect(result[0].helpUrl).toBe('https://able.ibm.com/rules/archives/latest/doc/en-US/some_rule.html');
  });

  it('includes category as a tag when present', () => {
    const result = normalizeIbmResults([makeIbmResult({ category: 'wcag2a' })]);
    expect(result[0].tags).toContain('wcag2a');
  });

  it('adds best-practice tag when no wcag category', () => {
    const result = normalizeIbmResults([makeIbmResult({ category: undefined })]);
    expect(result[0].tags).toContain('best-practice');
  });

  it('adds best-practice tag when category does not start with wcag', () => {
    const result = normalizeIbmResults([makeIbmResult({ category: 'aria' })]);
    expect(result[0].tags).toContain('best-practice');
    expect(result[0].tags).toContain('aria');
  });

  it('does not add best-practice when category starts with wcag', () => {
    const result = normalizeIbmResults([makeIbmResult({ category: 'wcag2aa' })]);
    expect(result[0].tags).not.toContain('best-practice');
  });

  it('returns empty array for null/undefined/empty input', () => {
    expect(normalizeIbmResults([])).toEqual([]);
    expect(normalizeIbmResults(null as unknown as IbmReportResult[])).toEqual([]);
    expect(normalizeIbmResults(undefined as unknown as IbmReportResult[])).toEqual([]);
  });
});

describe('normalizeCustomResults', () => {
  it('maps custom check results to NormalizedViolation', () => {
    const custom: CustomCheckResult = {
      id: 'ambiguous-link',
      impact: 'moderate',
      description: 'Link text is ambiguous',
      help: 'Use descriptive link text',
      helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/link-purpose-in-context',
      tags: ['wcag2a', 'wcag244'],
      nodes: [{ html: '<a href="#">Click here</a>', target: ['a.link'] }],
    };

    const result = normalizeCustomResults([custom]);
    expect(result).toHaveLength(1);
    expect(result[0].engine).toBe('custom');
    expect(result[0].id).toBe('ambiguous-link');
    expect(result[0].impact).toBe('moderate');
  });

  it('returns empty array for empty input', () => {
    expect(normalizeCustomResults([])).toEqual([]);
  });

  it('returns empty array for null/undefined input', () => {
    expect(normalizeCustomResults(null as unknown as CustomCheckResult[])).toEqual([]);
    expect(normalizeCustomResults(undefined as unknown as CustomCheckResult[])).toEqual([]);
  });

  it('maps multiple nodes correctly', () => {
    const custom: CustomCheckResult = {
      id: 'test-rule',
      impact: 'serious',
      description: 'Test',
      help: 'Fix it',
      helpUrl: 'https://example.com',
      tags: ['wcag2a'],
      nodes: [
        { html: '<a>one</a>', target: ['a.one'] },
        { html: '<a>two</a>', target: ['a.two'] },
      ],
    };
    const result = normalizeCustomResults([custom]);
    expect(result[0].nodes).toHaveLength(2);
    expect(result[0].nodes[0].failureSummary).toBe('Test');
    expect(result[0].nodes[1].impact).toBe('serious');
  });
});

describe('normalizeAxeResults', () => {
  it('adds axe-core engine tag to violations', () => {
    const result = normalizeAxeResults([makeAxeViolation()]);
    expect(result).toHaveLength(1);
    expect(result[0].engine).toBe('axe-core');
    expect(result[0].id).toBe('image-alt');
  });

  it('returns empty array for empty input', () => {
    expect(normalizeAxeResults([])).toEqual([]);
  });
});

describe('deduplicateViolations', () => {
  it('removes duplicate violations for same element + WCAG criterion', () => {
    const v1: NormalizedViolation = {
      ...makeAxeViolation({ impact: 'serious', tags: ['wcag2a', 'wcag111'] }),
      engine: 'axe-core',
    };
    const v2: NormalizedViolation = {
      ...makeAxeViolation({ id: 'ibm-img-alt', impact: 'critical', tags: ['wcag111'] }),
      engine: 'ibm-equal-access',
      nodes: [{ html: '<img src="photo.jpg">', target: ['img'], impact: 'critical', failureSummary: 'No alt' }],
    };

    const result = deduplicateViolations([v1, v2]);
    expect(result).toHaveLength(1);
    // Should keep higher severity (critical from IBM)
    expect(result[0].impact).toBe('critical');
  });

  it('keeps violations with different WCAG criteria for same element', () => {
    const v1: NormalizedViolation = {
      ...makeAxeViolation({ tags: ['wcag111'] }),
      engine: 'axe-core',
    };
    const v2: NormalizedViolation = {
      ...makeAxeViolation({ id: 'color-contrast', tags: ['wcag143'] }),
      engine: 'ibm-equal-access',
      nodes: [{ html: '<img src="photo.jpg">', target: ['img'], impact: 'serious', failureSummary: 'Contrast' }],
    };

    const result = deduplicateViolations([v1, v2]);
    expect(result).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateViolations([])).toEqual([]);
  });

  it('returns empty array for null/undefined input', () => {
    expect(deduplicateViolations(null as unknown as NormalizedViolation[])).toEqual([]);
    expect(deduplicateViolations(undefined as unknown as NormalizedViolation[])).toEqual([]);
  });

  it('keeps lower severity when it appears first and no higher one replaces', () => {
    const v1: NormalizedViolation = {
      ...makeAxeViolation({ impact: 'minor', tags: ['wcag111'] }),
      engine: 'axe-core',
      nodes: [{ html: '<img>', target: ['img.unique1'], impact: 'minor' }],
    };
    const v2: NormalizedViolation = {
      ...makeAxeViolation({ impact: 'moderate', tags: ['wcag143'] }),
      engine: 'axe-core',
      nodes: [{ html: '<img>', target: ['img.unique2'], impact: 'moderate' }],
    };

    const result = deduplicateViolations([v1, v2]);
    expect(result).toHaveLength(2);
  });

  it('handles nodes with empty target array', () => {
    const v: NormalizedViolation = {
      ...makeAxeViolation({ tags: ['wcag111'] }),
      engine: 'axe-core',
      nodes: [{ html: '<img>', target: [], impact: 'serious' }],
    };

    const result = deduplicateViolations([v]);
    expect(result).toHaveLength(1);
  });

  it('handles violations with no wcag tags', () => {
    const v: NormalizedViolation = {
      ...makeAxeViolation({ tags: ['best-practice'] }),
      engine: 'custom',
      nodes: [{ html: '<b>text</b>', target: ['b'], impact: 'minor' }],
    };

    const result = deduplicateViolations([v]);
    expect(result).toHaveLength(1);
  });

  it('handles violations with empty tags', () => {
    const v: NormalizedViolation = {
      ...makeAxeViolation({ tags: [] }),
      engine: 'custom',
      nodes: [{ html: '<div></div>', target: ['div'], impact: 'minor' }],
    };

    const result = deduplicateViolations([v]);
    expect(result).toHaveLength(1);
  });

  it('does not re-expand a multi-node violation (regression: N×N node explosion)', () => {
    // A single violation with many distinct-selector nodes (e.g. axe "region"
    // firing on every landmark-less block) must produce one survivor per
    // distinct (selector, WCAG criterion) — each carrying exactly ONE node —
    // never the whole violation repeated once per node.
    const nodeCount = 40;
    const v: NormalizedViolation = {
      ...makeAxeViolation({ id: 'region', tags: ['wcag131'] }),
      engine: 'axe-core',
      nodes: Array.from({ length: nodeCount }, (_, i) => ({
        html: `<div id="block-${i}"></div>`,
        target: [`#block-${i}`],
        impact: 'moderate' as const,
        failureSummary: 'Not in a landmark',
      })),
    };

    const result = deduplicateViolations([v]);

    // One survivor per distinct selector...
    expect(result).toHaveLength(nodeCount);
    // ...and every survivor carries exactly one node (no carried-over siblings),
    // so the total node count is N, not N×N.
    const totalNodes = result.reduce((sum, r) => sum + r.nodes.length, 0);
    expect(totalNodes).toBe(nodeCount);
    expect(result.every(r => r.nodes.length === 1)).toBe(true);
  });

  it('keeps a hard violation over a review duplicate on the same key', () => {
    const shared = { html: '<button>Go</button>', target: ['button.go'], impact: 'moderate' as const };
    const review: NormalizedViolation = {
      ...makeAxeViolation({ id: 'focus-visible', tags: ['wcag247'], impact: 'serious' }),
      engine: 'ibm-equal-access',
      kind: 'review',
      nodes: [shared],
    };
    const violation: NormalizedViolation = {
      ...makeAxeViolation({ id: 'focus-visible', tags: ['wcag247'], impact: 'minor' }),
      engine: 'axe-core',
      kind: 'violation',
      nodes: [shared],
    };

    // Review listed first, then the hard violation — the violation must win
    // regardless of the lower mapped severity.
    const result = deduplicateViolations([review, violation]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('violation');
    expect(result[0].engine).toBe('axe-core');
  });

  it('keeps the higher severity when both items are review kind', () => {
    const shared = { html: '<button>Go</button>', target: ['button.go'], impact: 'moderate' as const };
    const lowReview: NormalizedViolation = {
      ...makeAxeViolation({ id: 'focus-visible', tags: ['wcag247'], impact: 'minor' }),
      engine: 'axe-core',
      kind: 'review',
      nodes: [shared],
    };
    const highReview: NormalizedViolation = {
      ...makeAxeViolation({ id: 'focus-visible', tags: ['wcag247'], impact: 'serious' }),
      engine: 'ibm-equal-access',
      kind: 'review',
      nodes: [shared],
    };

    const result = deduplicateViolations([lowReview, highReview]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('review');
    expect(result[0].impact).toBe('serious');
  });
});

function makeAlfaOutcome(overrides: Partial<AlfaRawOutcome> = {}): AlfaRawOutcome {
  return {
    ruleId: 'https://alfa.siteimprove.com/rules/sia-r1',
    outcome: 'failed',
    impact: 'serious',
    html: '<title></title>',
    target: 'head > title',
    message: 'Document has an empty title',
    helpUrl: 'https://alfa.siteimprove.com/rules/sia-r1',
    tags: ['wcag2a', 'wcag242'],
    ...overrides,
  };
}

describe('normalizeAlfa', () => {
  it('maps a failed outcome to a hard violation tagged engine alfa', () => {
    const result = normalizeAlfa([makeAlfaOutcome({ outcome: 'failed' })]);
    expect(result).toHaveLength(1);
    expect(result[0].engine).toBe('alfa');
    expect(result[0].kind).toBe('violation');
    expect(result[0].impact).toBe('serious');
    expect(result[0].nodes[0].target).toEqual(['head > title']);
  });

  it('maps a cantTell outcome to a needs-review item', () => {
    const result = normalizeAlfa([makeAlfaOutcome({ outcome: 'cantTell' })]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('review');
  });

  it('drops passed and inapplicable outcomes', () => {
    const result = normalizeAlfa([
      makeAlfaOutcome({ outcome: 'passed' }),
      makeAlfaOutcome({ outcome: 'inapplicable' }),
    ]);
    expect(result).toHaveLength(0);
  });

  it('assigns a WCAG principle from the tags', () => {
    const result = normalizeAlfa([makeAlfaOutcome({ tags: ['wcag2a', 'wcag111'] })]);
    expect(result[0].principle).toBeTruthy();
  });

  it('falls back to best-practice tag when none provided', () => {
    const result = normalizeAlfa([makeAlfaOutcome({ tags: [] })]);
    expect(result[0].tags).toContain('best-practice');
  });

  it('defaults impact to moderate when missing', () => {
    const result = normalizeAlfa([makeAlfaOutcome({ impact: null as unknown as AlfaRawOutcome['impact'] })]);
    expect(result[0].impact).toBe('moderate');
  });

  it('returns empty array for empty input', () => {
    expect(normalizeAlfa([])).toEqual([]);
  });

  it('returns empty array for null/undefined input', () => {
    expect(normalizeAlfa(null as unknown as AlfaRawOutcome[])).toEqual([]);
    expect(normalizeAlfa(undefined as unknown as AlfaRawOutcome[])).toEqual([]);
  });
});

describe('normalizeAndMerge', () => {
  it('merges axe and IBM results', () => {
    const axe = makeAxeResults({
      violations: [{
        id: 'image-alt',
        impact: 'serious',
        tags: ['wcag2a', 'wcag111'],
        description: 'Images must have alt text',
        help: 'Ensure images have alt text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
        nodes: [{
          html: '<img src="test.jpg">',
          target: ['img.hero'],
          impact: 'serious',
          any: [], all: [], none: [],
        }],
      }],
    } as Partial<AxeResults>);

    const ibm = [makeIbmResult({
      path: { dom: 'body > div > img.thumb' },
      ruleId: 'img_alt_valid',
    })];

    const result = normalizeAndMerge(axe, ibm, []);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
    expect(result.engineVersions['axe-core']).toBe('4.10.0');
    expect(result.engineVersions['ibm-equal-access']).toBe('latest');
  });

  it('works with no IBM results', () => {
    const axe = makeAxeResults();
    const result = normalizeAndMerge(axe, [], []);
    expect(result.violations).toHaveLength(0);
    expect(result.engineVersions['axe-core']).toBe('4.10.0');
    expect(result.engineVersions['ibm-equal-access']).toBeUndefined();
  });

  it('carries through passes, incomplete, and inapplicable from axe', () => {
    const axe = makeAxeResults({
      passes: [{
        id: 'html-has-lang',
        impact: undefined,
        tags: ['wcag2a'],
        description: 'Page has lang',
        help: 'lang attribute',
        helpUrl: '',
        nodes: [{ html: '<html lang="en">', target: ['html'], impact: undefined, any: [], all: [], none: [] }],
      }],
      incomplete: [{
        id: 'color-contrast',
        impact: 'serious',
        tags: ['wcag2aa', 'wcag143'],
        description: 'Color contrast',
        help: 'Ensure contrast',
        helpUrl: 'https://example.com',
        nodes: [{ html: '<p>text</p>', target: ['p'], impact: 'serious', any: [], all: [], none: [] }],
      }],
      inapplicable: [{
        id: 'video-caption',
        tags: ['wcag2a'],
        description: 'Video captions',
        help: '',
        helpUrl: '',
        impact: undefined,
        nodes: [],
      }],
    } as Partial<AxeResults>);

    const result = normalizeAndMerge(axe, [], []);
    expect(result.passes).toHaveLength(1);
    expect(result.passes[0].id).toBe('html-has-lang');
    expect(result.incomplete).toHaveLength(1);
    expect(result.incomplete[0].id).toBe('color-contrast');
    expect(result.incomplete[0].impact).toBe('serious');
    expect(result.inapplicable).toHaveLength(1);
    expect(result.inapplicable[0].id).toBe('video-caption');
  });

  it('includes custom engine version when custom results present', () => {
    const custom: CustomCheckResult = {
      id: 'test-check',
      impact: 'minor',
      description: 'test',
      help: 'test',
      helpUrl: 'https://example.com',
      tags: ['best-practice'],
      nodes: [{ html: '<b>test</b>', target: ['b'] }],
    };

    const result = normalizeAndMerge(makeAxeResults(), [], [custom]);
    expect(result.engineVersions['custom']).toBe('1.0.0');
    expect(result.violations).toHaveLength(1);
  });

  it('merges alfa results and records the alfa engine version', () => {
    const alfa: AlfaRawOutcome = {
      ruleId: 'https://alfa.siteimprove.com/rules/sia-r1',
      outcome: 'failed',
      impact: 'serious',
      html: '<title></title>',
      target: 'head > title',
      message: 'Document has an empty title',
      helpUrl: 'https://alfa.siteimprove.com/rules/sia-r1',
      tags: ['wcag2a', 'wcag242'],
    };

    const result = normalizeAndMerge(makeAxeResults(), [], [], [alfa]);
    expect(result.engineVersions['alfa']).toBe('latest');
    expect(result.violations.some(v => v.engine === 'alfa')).toBe(true);
  });

  it('omits the alfa engine version when no alfa results are passed', () => {
    const result = normalizeAndMerge(makeAxeResults(), [], []);
    expect(result.engineVersions['alfa']).toBeUndefined();
  });

  it('defaults axe-core version to unknown when testEngine is missing', () => {
    const axe = makeAxeResults({ testEngine: undefined } as Partial<AxeResults>);
    const result = normalizeAndMerge(axe, [], []);
    expect(result.engineVersions['axe-core']).toBe('unknown');
  });

  it('handles axe violations with null impact', () => {
    const axe = makeAxeResults({
      violations: [{
        id: 'test-rule',
        impact: null,
        tags: ['wcag2a'],
        description: 'test',
        help: 'test',
        helpUrl: 'https://example.com',
        nodes: [{ html: '<div></div>', target: ['div'], impact: null, any: [], all: [], none: [] }],
      }],
    } as Partial<AxeResults>);

    const result = normalizeAndMerge(axe, [], []);
    expect(result.violations[0].impact).toBe('minor');
  });
});

describe('mergeAcrossStates', () => {
  function makeNV(overrides: Partial<NormalizedViolation> = {}): NormalizedViolation {
    return {
      ...makeAxeViolation(),
      engine: 'axe-core',
      ...overrides,
    } as NormalizedViolation;
  }

  function makeResults(violations: NormalizedViolation[], extra: Partial<MultiEngineResults> = {}): MultiEngineResults {
    return {
      violations,
      passes: [],
      incomplete: [],
      inapplicable: [],
      engineVersions: { 'axe-core': '4.10.0' },
      ...extra,
    };
  }

  it('keeps the base finding and drops a state duplicate on the same key', () => {
    const base = makeResults([makeNV({ id: 'image-alt' })]);
    const stateDup = makeResults([makeNV({ id: 'image-alt', state: 'menu-open' })]);

    const merged = mergeAcrossStates(base, [stateDup]);

    expect(merged.violations).toHaveLength(1);
    expect(merged.violations[0].state).toBeUndefined();
  });

  it('adds a state-only finding that is not present in the base', () => {
    const base = makeResults([makeNV({ id: 'image-alt' })]);
    const stateOnly = makeResults([
      makeNV({
        id: 'aria-dialog-name',
        state: 'dialog-open',
        description: 'Dialog needs a name',
        nodes: [{ html: '<div role="dialog">', target: ['div.modal'], impact: 'serious' }],
      }),
    ]);

    const merged = mergeAcrossStates(base, [stateOnly]);

    expect(merged.violations).toHaveLength(2);
    const dialog = merged.violations.find((v) => v.id === 'aria-dialog-name');
    expect(dialog?.state).toBe('dialog-open');
  });

  it('preserves base passes, incomplete, and inapplicable unchanged', () => {
    const base = makeResults([], {
      passes: [makeNV({ id: 'html-has-lang' })],
      incomplete: [makeNV({ id: 'color-contrast' })],
      inapplicable: [makeNV({ id: 'video-caption' })],
    });
    const stateOnly = makeResults([
      makeNV({ id: 'aria-dialog-name', state: 's1', nodes: [{ html: '<div>', target: ['div.x'], impact: 'serious' }] }),
    ]);

    const merged = mergeAcrossStates(base, [stateOnly]);

    expect(merged.passes).toHaveLength(1);
    expect(merged.incomplete).toHaveLength(1);
    expect(merged.inapplicable).toHaveLength(1);
  });

  it('unions engine versions from base and state results', () => {
    const base = makeResults([], { engineVersions: { 'axe-core': '4.10.0' } });
    const stateOnly = makeResults([], { engineVersions: { 'ibm-equal-access': 'latest', custom: '1.0.0' } });

    const merged = mergeAcrossStates(base, [stateOnly]);

    expect(merged.engineVersions['axe-core']).toBe('4.10.0');
    expect(merged.engineVersions['ibm-equal-access']).toBe('latest');
    expect(merged.engineVersions['custom']).toBe('1.0.0');
  });
});
