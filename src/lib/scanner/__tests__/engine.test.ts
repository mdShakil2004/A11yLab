import { vi, describe, it, expect, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const mockAnalyze = vi.fn().mockResolvedValue({
    violations: [],
    passes: [],
    incomplete: [],
    inapplicable: [],
    testEngine: { name: 'axe-core', version: '4.10.0' },
  });
  const mockWithTags = vi.fn();
  const mockOptions = vi.fn();

  const builderInstance = {
    withTags: mockWithTags,
    options: mockOptions,
    analyze: mockAnalyze,
  };

  // withTags and options return the builder for chaining
  mockWithTags.mockReturnValue(builderInstance);
  mockOptions.mockReturnValue(builderInstance);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const MockAxeBuilder = vi.fn().mockImplementation(function (_opts: unknown) {
    return builderInstance;
  });

  const mockPage = {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockIbmPage = {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  // Track which page newPage returns: first call -> mockPage (main), second -> mockIbmPage (IBM)
  let newPageCallCount = 0;
  const mockContext = {
    newPage: vi.fn().mockImplementation(() => {
      newPageCallCount++;
      return Promise.resolve(newPageCallCount <= 1 ? mockPage : mockIbmPage);
    }),
    close: vi.fn(),
  };
  const mockBrowser = {
    newContext: vi.fn().mockResolvedValue(mockContext),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const mockGetCompliance = vi.fn().mockResolvedValue({
    report: { results: [] },
  });

  return {
    MockAxeBuilder,
    mockWithTags,
    mockAnalyze,
    mockPage,
    mockIbmPage,
    get newPageCallCount() { return newPageCallCount; },
    set newPageCallCount(v: number) { newPageCallCount = v; },
    mockContext,
    mockBrowser,
    mockGetCompliance,
    chromium: {
      launch: vi.fn().mockResolvedValue(mockBrowser),
    },
  };
});

vi.mock('playwright', () => ({
  chromium: mocks.chromium,
}));

vi.mock('@axe-core/playwright', () => ({
  default: mocks.MockAxeBuilder,
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: vi.fn().mockReturnValue('function axe(){}') };
});

vi.mock('accessibility-checker', () => ({
  getCompliance: mocks.mockGetCompliance,
}));

import { scanPage, scanUrl, multiEngineScan, applyActions, multiEngineScanWithStates } from '../engine';

describe('engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.newPageCallCount = 0;
    mocks.chromium.launch.mockResolvedValue(mocks.mockBrowser);
    mocks.mockBrowser.newContext.mockResolvedValue(mocks.mockContext);
    mocks.mockContext.newPage.mockImplementation(() => {
      mocks.newPageCallCount++;
      return Promise.resolve(mocks.newPageCallCount <= 1 ? mocks.mockPage : mocks.mockIbmPage);
    });
    mocks.mockPage.goto.mockResolvedValue(undefined);
    mocks.mockIbmPage.goto.mockResolvedValue(undefined);
    mocks.mockAnalyze.mockResolvedValue({
      violations: [],
      passes: [],
      incomplete: [],
      inapplicable: [],
      testEngine: { name: 'axe-core', version: '4.10.0' },
    });
  });

  describe('scanPage', () => {
    it('constructs AxeBuilder with the page and runs analysis', async () => {
      const expectedResults = {
        violations: [{ id: 'color-contrast', impact: 'serious' }],
        passes: [{ id: 'html-has-lang' }],
        incomplete: [],
        inapplicable: [],
      };
      mocks.mockAnalyze.mockResolvedValueOnce(expectedResults);

      const results = await scanPage(mocks.mockPage as never);

      expect(mocks.MockAxeBuilder).toHaveBeenCalledWith({ page: mocks.mockPage, axeSource: expect.any(String) });
      expect(mocks.mockWithTags).toHaveBeenCalledWith(
        ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa', 'best-practice'],
      );
      expect(mocks.mockAnalyze).toHaveBeenCalled();
      expect(results).toEqual(expectedResults);
    });

    it('returns empty results when no violations found', async () => {
      const emptyResults = {
        violations: [],
        passes: [{ id: 'html-has-lang' }],
        incomplete: [],
        inapplicable: [],
      };
      mocks.mockAnalyze.mockResolvedValueOnce(emptyResults);

      const results = await scanPage(mocks.mockPage as never);

      expect(results.violations).toHaveLength(0);
    });

    it('includes best-practice in the tags array', async () => {
      await scanPage(mocks.mockPage as never);

      const tagsArg = mocks.mockWithTags.mock.calls[0][0] as string[];
      expect(tagsArg).toContain('best-practice');
    });
  });

  describe('scanUrl', () => {
    it('launches browser, navigates, scans, and closes browser', async () => {
      await scanUrl('https://example.com');

      expect(mocks.chromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({ headless: true }),
      );
      expect(mocks.mockBrowser.newContext).toHaveBeenCalled();
      expect(mocks.mockContext.newPage).toHaveBeenCalled();
      expect(mocks.mockPage.goto).toHaveBeenCalledWith('https://example.com', expect.any(Object));
      expect(mocks.mockBrowser.close).toHaveBeenCalled();
    });

    it('calls onProgress callback at each stage', async () => {
      const onProgress = vi.fn();

      await scanUrl('https://example.com', onProgress);

      expect(onProgress).toHaveBeenCalledWith('navigating', 10);
      expect(onProgress).toHaveBeenCalledWith('scanning', 40);
      expect(onProgress).toHaveBeenCalledWith('scoring', 80);
    });

    it('handles navigation timeout by falling back to domcontentloaded', async () => {
      const timeoutError = new Error('Timeout 30000ms exceeded');
      mocks.mockPage.goto.mockRejectedValueOnce(timeoutError);

      await scanUrl('https://slow-site.com');

      expect(mocks.mockPage.waitForLoadState).toHaveBeenCalledWith('domcontentloaded', expect.any(Object));
      expect(mocks.mockBrowser.close).toHaveBeenCalled();
    });

    it('rethrows non-timeout navigation errors', async () => {
      const netError = new Error('net::ERR_CONNECTION_REFUSED');
      mocks.mockPage.goto.mockRejectedValueOnce(netError);

      await expect(scanUrl('https://unreachable.com')).rejects.toThrow('net::ERR_CONNECTION_REFUSED');

      expect(mocks.mockBrowser.close).toHaveBeenCalled();
    });

    it('closes browser even when scan throws', async () => {
      mocks.mockAnalyze.mockRejectedValueOnce(new Error('axe eval failed'));

      await expect(scanUrl('https://example.com')).rejects.toThrow('axe eval failed');

      expect(mocks.mockBrowser.close).toHaveBeenCalled();
    });

    it('returns multi-engine results on successful scan', async () => {
      const axeData = {
        violations: [{ id: 'image-alt', impact: 'serious', tags: ['wcag2a'], description: 'Alt', help: 'Alt', helpUrl: '', nodes: [{ html: '<img>', target: ['img'], impact: 'serious', any: [], all: [], none: [] }] }],
        passes: [],
        incomplete: [],
        inapplicable: [],
        testEngine: { name: 'axe-core', version: '4.10.0' },
      };
      mocks.mockAnalyze.mockResolvedValueOnce(axeData);

      const results = await scanUrl('https://example.com');

      // scanUrl now returns MultiEngineResults
      expect(results).toHaveProperty('engineVersions');
      expect(results.violations.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('multiEngineScan', () => {
    it('runs axe-core on main page and IBM in isolated page', async () => {
      const axeData = {
        violations: [],
        passes: [],
        incomplete: [],
        inapplicable: [],
        testEngine: { name: 'axe-core', version: '4.10.0' },
      };
      mocks.mockAnalyze.mockResolvedValueOnce(axeData);
      mocks.mockGetCompliance.mockResolvedValueOnce({
        report: {
          results: [{
            ruleId: 'img_alt_valid',
            value: ['VIOLATION', 'FAIL'],
            path: { dom: 'img.test' },
            message: 'Missing alt',
            snippet: '<img>',
            level: 'violation',
          }],
        },
      });

      const results = await multiEngineScan(mocks.mockPage as never, 'https://example.com', mocks.mockContext as never);

      expect(results.engineVersions['axe-core']).toBe('4.10.0');
      expect(results.engineVersions['ibm-equal-access']).toBe('latest');
      expect(results.violations).toHaveLength(1);
      expect(results.violations[0].engine).toBe('ibm-equal-access');
      // IBM scan should have opened a separate page
      expect(mocks.mockContext.newPage).toHaveBeenCalled();
    });

    it('gracefully degrades when IBM scan fails', async () => {
      const axeData = {
        violations: [{ id: 'color-contrast', impact: 'serious', tags: ['wcag2aa'], description: 'Contrast', help: 'Contrast', helpUrl: '', nodes: [{ html: '<p>', target: ['p'], impact: 'serious', any: [], all: [], none: [] }] }],
        passes: [],
        incomplete: [],
        inapplicable: [],
        testEngine: { name: 'axe-core', version: '4.10.0' },
      };
      mocks.mockAnalyze.mockResolvedValueOnce(axeData);
      mocks.mockGetCompliance.mockRejectedValueOnce(new Error('IBM engine failure'));

      const results = await multiEngineScan(mocks.mockPage as never, 'https://example.com', mocks.mockContext as never);

      // Should still return axe results even though IBM failed
      expect(results.violations).toHaveLength(1);
      expect(results.violations[0].id).toBe('color-contrast');
      expect(results.engineVersions['axe-core']).toBe('4.10.0');
    });

    it('returns MultiEngineResults format with engineVersions', async () => {
      mocks.mockGetCompliance.mockResolvedValueOnce({ report: { results: [] } });

      const results = await multiEngineScan(mocks.mockPage as never, 'https://example.com', mocks.mockContext as never);

      expect(results).toHaveProperty('engineVersions');
      expect(results).toHaveProperty('violations');
      expect(results).toHaveProperty('passes');
      expect(results).toHaveProperty('incomplete');
      expect(results).toHaveProperty('inapplicable');
    });

    it('degrades to a no-op when the Alfa ACT-Rules packages are absent', async () => {
      // The @siteimprove/alfa-* packages are optionalDependencies and are NOT
      // installed in the test environment, so runAlfa's dynamic imports reject
      // and it returns []. The scan must still complete with the other engines
      // and must NOT surface an 'alfa' engine version or any alfa-tagged finding.
      mocks.mockGetCompliance.mockResolvedValueOnce({ report: { results: [] } });

      const results = await multiEngineScan(mocks.mockPage as never, 'https://example.com', mocks.mockContext as never);

      expect(results).toHaveProperty('engineVersions');
      expect(results.engineVersions['alfa']).toBeUndefined();
      expect(results.violations.some(v => v.engine === 'alfa')).toBe(false);
    });
  });

  describe('applyActions', () => {
    function createActionPage() {
      return {
        click: vi.fn().mockResolvedValue(undefined),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        fill: vi.fn().mockResolvedValue(undefined),
        keyboard: { press: vi.fn().mockResolvedValue(undefined) },
      };
    }

    it('dispatches click actions to page.click', async () => {
      const page = createActionPage();
      await applyActions(page as never, [{ click: '#open-menu' }]);
      expect(page.click).toHaveBeenCalledWith('#open-menu');
    });

    it('dispatches waitFor actions to page.waitForSelector', async () => {
      const page = createActionPage();
      await applyActions(page as never, [{ waitFor: '#dialog' }]);
      expect(page.waitForSelector).toHaveBeenCalledWith('#dialog');
    });

    it('dispatches fill actions to page.fill with selector and value', async () => {
      const page = createActionPage();
      await applyActions(page as never, [{ fill: { selector: '#email', value: 'a@b.com' } }]);
      expect(page.fill).toHaveBeenCalledWith('#email', 'a@b.com');
    });

    it('dispatches press actions to page.keyboard.press', async () => {
      const page = createActionPage();
      await applyActions(page as never, [{ press: 'Enter' }]);
      expect(page.keyboard.press).toHaveBeenCalledWith('Enter');
    });

    it('applies actions in order', async () => {
      const page = createActionPage();
      const calls: string[] = [];
      page.click.mockImplementation(async () => { calls.push('click'); });
      page.fill.mockImplementation(async () => { calls.push('fill'); });
      page.keyboard.press.mockImplementation(async () => { calls.push('press'); });

      await applyActions(page as never, [
        { click: '#a' },
        { fill: { selector: '#b', value: 'x' } },
        { press: 'Tab' },
      ]);

      expect(calls).toEqual(['click', 'fill', 'press']);
    });

    it('routes subsequent actions into a same-origin iframe after a frame action', async () => {
      const inFrame = {
        click: vi.fn().mockResolvedValue(undefined),
        fill: vi.fn().mockResolvedValue(undefined),
        waitFor: vi.fn().mockResolvedValue(undefined),
      };
      const locator = vi.fn().mockReturnValue(inFrame);
      const page = {
        ...createActionPage(),
        frameLocator: vi.fn().mockReturnValue({ locator }),
      };

      await applyActions(page as never, [
        { frame: '.modal-form-insert.in iframe' },
        { click: '#InsertButton' },
        { waitFor: '#ValidationSummaryEntityFormControl_EntityFormView' },
      ]);

      // The iframe is resolved via FrameLocator and in-frame actions go through
      // frame.locator(...), NOT the main-frame page.* APIs.
      expect(page.frameLocator).toHaveBeenCalledWith('.modal-form-insert.in iframe');
      expect(locator).toHaveBeenCalledWith('#InsertButton');
      expect(locator).toHaveBeenCalledWith('#ValidationSummaryEntityFormControl_EntityFormView');
      expect(inFrame.click).toHaveBeenCalledTimes(1);
      expect(inFrame.waitFor).toHaveBeenCalledTimes(1);
      expect(page.click).not.toHaveBeenCalled();
      expect(page.waitForSelector).not.toHaveBeenCalled();
    });

    it('resets back to the main frame when a frame action is empty', async () => {
      const inFrame = {
        click: vi.fn().mockResolvedValue(undefined),
        fill: vi.fn().mockResolvedValue(undefined),
        waitFor: vi.fn().mockResolvedValue(undefined),
      };
      const page = {
        ...createActionPage(),
        frameLocator: vi.fn().mockReturnValue({ locator: vi.fn().mockReturnValue(inFrame) }),
      };

      await applyActions(page as never, [
        { frame: '.modal iframe' },
        { click: '#inside-frame' },
        { frame: '' },
        { click: '#back-in-main' },
      ]);

      expect(inFrame.click).toHaveBeenCalledTimes(1);
      expect(page.click).toHaveBeenCalledWith('#back-in-main');
      expect(page.click).toHaveBeenCalledTimes(1);
    });
  });

  describe('multiEngineScanWithStates', () => {
    it('tags state-only findings with the state name and keeps the default-DOM scan clean', async () => {
      const stateViolation = {
        violations: [{
          id: 'aria-dialog-name', impact: 'serious', tags: ['wcag2a'],
          description: 'Dialog needs a name', help: 'Name the dialog', helpUrl: '',
          nodes: [{ html: '<div role="dialog">', target: ['div'], impact: 'serious', any: [], all: [], none: [] }],
        }],
        passes: [], incomplete: [], inapplicable: [],
        testEngine: { name: 'axe-core', version: '4.10.0' },
      };
      // 1st analyze = base (clean), 2nd analyze = state (violation)
      mocks.mockAnalyze
        .mockResolvedValueOnce({ violations: [], passes: [], incomplete: [], inapplicable: [], testEngine: { name: 'axe-core', version: '4.10.0' } })
        .mockResolvedValueOnce(stateViolation);

      const results = await multiEngineScanWithStates(
        mocks.mockPage as never,
        'https://example.com',
        mocks.mockContext as never,
        [{ name: 'dialog-open', actions: [] }],
      );

      expect(results.violations).toHaveLength(1);
      expect(results.violations[0].id).toBe('aria-dialog-name');
      expect(results.violations[0].state).toBe('dialog-open');
    });

    it('does not duplicate a finding present in both the default DOM and a state', async () => {
      const shared = {
        violations: [{
          id: 'color-contrast', impact: 'serious', tags: ['wcag2aa'],
          description: 'Contrast', help: 'Contrast', helpUrl: '',
          nodes: [{ html: '<p>', target: ['p'], impact: 'serious', any: [], all: [], none: [] }],
        }],
        passes: [], incomplete: [], inapplicable: [],
        testEngine: { name: 'axe-core', version: '4.10.0' },
      };
      mocks.mockAnalyze.mockResolvedValue(shared);

      const results = await multiEngineScanWithStates(
        mocks.mockPage as never,
        'https://example.com',
        mocks.mockContext as never,
        [{ name: 'dialog-open', actions: [] }],
      );

      expect(results.violations).toHaveLength(1);
      // default-DOM scan wins on duplicates, so no state tag
      expect(results.violations[0].state).toBeUndefined();
    });

    it('degrades gracefully when a state action fails (bad selector) and still returns base results', async () => {
      const baseViolation = {
        violations: [{
          id: 'image-alt', impact: 'serious', tags: ['wcag2a'],
          description: 'Alt', help: 'Alt', helpUrl: '',
          nodes: [{ html: '<img>', target: ['img'], impact: 'serious', any: [], all: [], none: [] }],
        }],
        passes: [], incomplete: [], inapplicable: [],
        testEngine: { name: 'axe-core', version: '4.10.0' },
      };
      mocks.mockAnalyze.mockResolvedValue(baseViolation);
      // applyActions drives page.click for this state; make it throw to simulate
      // a stale/invalid selector. A bad state recipe must NOT crash the whole URL.
      (mocks.mockPage as Record<string, unknown>).click = vi
        .fn()
        .mockRejectedValue(new Error('selector not found'));

      const results = await multiEngineScanWithStates(
        mocks.mockPage as never,
        'https://example.com',
        mocks.mockContext as never,
        [{ name: 'broken-state', actions: [{ click: '#does-not-exist' }] }],
      );

      // No throw; the base-DOM finding is still returned and the failed state
      // tagged nothing (it was skipped).
      expect(results.violations.length).toBeGreaterThanOrEqual(1);
      expect(results.violations[0].id).toBe('image-alt');
      expect(results.violations.every((v) => v.state !== 'broken-state')).toBe(true);
    });

    it('retries a flaky state apply and still captures the state findings', async () => {
      const stateViolation = {
        violations: [{
          id: 'aria-dialog-name', impact: 'serious', tags: ['wcag2a'],
          description: 'Dialog needs a name', help: 'Name the dialog', helpUrl: '',
          nodes: [{ html: '<div role="dialog">', target: ['div'], impact: 'serious', any: [], all: [], none: [] }],
        }],
        passes: [], incomplete: [], inapplicable: [],
        testEngine: { name: 'axe-core', version: '4.10.0' },
      };
      // 1st analyze = base (clean), 2nd analyze = state (violation) once applied.
      mocks.mockAnalyze
        .mockResolvedValueOnce({ violations: [], passes: [], incomplete: [], inapplicable: [], testEngine: { name: 'axe-core', version: '4.10.0' } })
        .mockResolvedValueOnce(stateViolation);
      // The modal trigger fails to open the dialog on the first attempt, then
      // succeeds — the exact intermittent behaviour seen on the Add Party modal.
      (mocks.mockPage as Record<string, unknown>).click = vi
        .fn()
        .mockRejectedValueOnce(new Error('modal did not open'))
        .mockResolvedValue(undefined);

      const results = await multiEngineScanWithStates(
        mocks.mockPage as never,
        'https://example.com',
        mocks.mockContext as never,
        [{ name: 'add-party-modal', actions: [{ click: 'a.create-action' }] }],
      );

      // The state was retried rather than dropped, so its finding is captured.
      expect(results.violations.some((v) => v.state === 'add-party-modal')).toBe(true);
      // A clean re-navigation happened between the failed and successful attempt.
      expect(mocks.mockPage.goto).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({ waitUntil: 'load' }),
      );
    });
  });
});
