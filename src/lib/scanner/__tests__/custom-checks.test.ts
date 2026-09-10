import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  checkAmbiguousLinkText,
  checkAriaCurrentPage,
  checkEmphasisStrongSemantics,
  checkDiscountPriceAccessibility,
  checkStickyElementOverlap,
  checkFormSubmitButton,
  checkInputOnChange,
  checkElementTabbableUnobscured,
  checkFocusVisible,
  checkSkipLinkFocusVisible,
  checkNewTabIndication,
  checkReflow,
  checkRequiredFieldIndication,
  checkFocusTrap,
  checkStatusMessage,
  checkInlineError,
  runCustomChecks,
} from '../custom-checks';
import type { Page } from 'playwright';

function createMockPage(): Page {
  return {
    evaluate: vi.fn(),
  } as unknown as Page;
}

describe('custom-checks', () => {
  let page: Page;

  beforeEach(() => {
    page = createMockPage();
  });

  describe('checkAmbiguousLinkText', () => {
    it('detects ambiguous link text like "Learn More"', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([
        { html: '<a href="/info">Learn More</a>', target: ['a'] },
        { html: '<a href="/details">Click Here</a>', target: ['a'] },
      ]);

      const result = await checkAmbiguousLinkText(page);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('ambiguous-link-text');
      expect(result!.impact).toBe('serious');
      expect(result!.nodes).toHaveLength(2);
      expect(result!.tags).toContain('wcag244');
    });

    it('returns null when all links have descriptive text', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await checkAmbiguousLinkText(page);

      expect(result).toBeNull();
    });

    it('returns null for empty page with no links', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await checkAmbiguousLinkText(page);

      expect(result).toBeNull();
    });
  });

  describe('checkAriaCurrentPage', () => {
    it('detects nav links missing aria-current="page"', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([
        { html: '<a href="/">Home</a>', target: ['a'] },
      ]);

      const result = await checkAriaCurrentPage(page);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('aria-current-page');
      expect(result!.impact).toBe('moderate');
      expect(result!.nodes).toHaveLength(1);
      expect(result!.tags).toContain('wcag131');
    });

    it('returns null when aria-current="page" is present', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await checkAriaCurrentPage(page);

      expect(result).toBeNull();
    });
  });

  describe('checkEmphasisStrongSemantics', () => {
    it('detects <b> and <i> tags that should use semantic elements', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([
        { html: '<b>Bold text</b>', target: ['b'] },
        { html: '<i>Italic text</i>', target: ['i'] },
      ]);

      const result = await checkEmphasisStrongSemantics(page);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('emphasis-strong-semantics');
      expect(result!.impact).toBe('minor');
      expect(result!.nodes).toHaveLength(2);
      expect(result!.tags).toContain('best-practice');
    });

    it('returns null when only <em> and <strong> are used', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await checkEmphasisStrongSemantics(page);

      expect(result).toBeNull();
    });
  });

  describe('checkDiscountPriceAccessibility', () => {
    it('detects strikethrough pricing without screen reader context', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([
        { html: '<del>$19.99</del>', target: ['del'] },
      ]);

      const result = await checkDiscountPriceAccessibility(page);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('discount-price-accessibility');
      expect(result!.impact).toBe('serious');
      expect(result!.nodes).toHaveLength(1);
      expect(result!.tags).toContain('wcag131');
    });

    it('returns null when strikethrough has aria-label', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await checkDiscountPriceAccessibility(page);

      expect(result).toBeNull();
    });
  });

  describe('checkStickyElementOverlap', () => {
    it('detects focusable elements obscured by sticky/fixed elements', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([
        { html: '<button>Submit</button>', target: ['button'] },
      ]);

      const result = await checkStickyElementOverlap(page);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('sticky-element-overlap');
      expect(result!.impact).toBe('serious');
      expect(result!.nodes).toHaveLength(1);
      expect(result!.tags).toContain('wcag247');
    });

    it('returns null when no overlap exists', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await checkStickyElementOverlap(page);

      expect(result).toBeNull();
    });
  });

  describe('checkFormSubmitButton', () => {
    it('detects forms missing a submit control', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([
        { html: '<form id="search"></form>', target: ['form#search'] },
      ]);

      const result = await checkFormSubmitButton(page);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('form_submit_button_exists');
      expect(result!.impact).toBe('serious');
      expect(result!.nodes).toHaveLength(1);
      expect(result!.tags).toContain('wcag331');
    });

    it('returns null when forms have submit controls', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await checkFormSubmitButton(page);

      expect(result).toBeNull();
    });
  });

  describe('checkInputOnChange', () => {
    it('flags navigational onchange handlers without advisory as a review item', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([
        { html: '<select onchange="location=this.value"></select>', target: ['select'] },
      ]);

      const result = await checkInputOnChange(page);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('input_onchange_review');
      expect(result!.impact).toBe('moderate');
      expect(result!.kind).toBe('review');
      expect(result!.nodes).toHaveLength(1);
      expect(result!.tags).toContain('wcag322');
    });

    it('returns null when no risky onchange handlers exist', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await checkInputOnChange(page);

      expect(result).toBeNull();
    });
  });

  describe('checkElementTabbableUnobscured', () => {
    it('detects tabbable elements obscured by other content', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([
        { html: '<a href="/x">Link</a>', target: ['a'] },
      ]);

      const result = await checkElementTabbableUnobscured(page);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('element_tabbable_unobscured');
      expect(result!.impact).toBe('serious');
      expect(result!.nodes).toHaveLength(1);
      expect(result!.tags).toContain('wcag2411');
    });

    it('returns null when tabbable elements are visible', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await checkElementTabbableUnobscured(page);

      expect(result).toBeNull();
    });
  });

  describe('checkFocusVisible', () => {
    it('detects focused elements without a visible focus indicator', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([
        { html: '<button>Go</button>', target: ['button'] },
      ]);

      const result = await checkFocusVisible(page);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('focus-visible');
      expect(result!.impact).toBe('serious');
      expect(result!.nodes).toHaveLength(1);
      expect(result!.tags).toContain('wcag247');
    });

    it('returns null when focus indicators are present', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await checkFocusVisible(page);

      expect(result).toBeNull();
    });
  });

  describe('checkSkipLinkFocusVisible', () => {
    it('detects skip links hidden when focused', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([
        { html: '<a href="#main">Skip to content</a>', target: ['a'] },
      ]);

      const result = await checkSkipLinkFocusVisible(page);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('skip-link-focus-visible');
      expect(result!.impact).toBe('moderate');
      expect(result!.nodes).toHaveLength(1);
      expect(result!.tags).toContain('wcag241');
    });

    it('returns null when skip links are visible on focus', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await checkSkipLinkFocusVisible(page);

      expect(result).toBeNull();
    });
  });

  describe('checkNewTabIndication', () => {
    it('detects target=_blank links lacking new-window indication', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([
        { html: '<a href="/x" target="_blank">Report</a>', target: ['a'] },
      ]);

      const result = await checkNewTabIndication(page);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('new-tab-indication');
      expect(result!.impact).toBe('moderate');
      expect(result!.nodes).toHaveLength(1);
      expect(result!.tags).toContain('wcag322');
    });

    it('returns null when new-window indication is present', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await checkNewTabIndication(page);

      expect(result).toBeNull();
    });
  });

  describe('checkReflow', () => {
    function createReflowMockPage(): Page {
      return {
        evaluate: vi.fn(),
        viewportSize: vi.fn(() => ({ width: 1280, height: 1024 })),
        setViewportSize: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;
    }

    it('detects horizontal scrolling at a 320px viewport', async () => {
      const reflowPage = createReflowMockPage();
      (reflowPage.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue({
        scrollWidth: 800,
        clientWidth: 320,
      });

      const result = await checkReflow(reflowPage);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('reflow');
      expect(result!.impact).toBe('serious');
      expect(result!.nodes).toHaveLength(1);
      expect(result!.nodes[0].target).toEqual(['html']);
      expect(result!.tags).toContain('wcag1410');
    });

    it('returns null when content reflows without horizontal scroll', async () => {
      const reflowPage = createReflowMockPage();
      (reflowPage.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await checkReflow(reflowPage);

      expect(result).toBeNull();
    });
  });

  describe('checkRequiredFieldIndication', () => {
    it('detects required fields without a visible required indication', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([
        { html: '<input required name="email">', target: ['input'] },
      ]);

      const result = await checkRequiredFieldIndication(page);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('required-field-indication');
      expect(result!.impact).toBe('moderate');
      expect(result!.nodes).toHaveLength(1);
      expect(result!.tags).toContain('wcag332');
    });

    it('returns null when required fields are clearly indicated', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await checkRequiredFieldIndication(page);

      expect(result).toBeNull();
    });
  });

  describe('checkFocusTrap', () => {
    it('flags an open modal whose background is still focusable', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([
        { html: '<div role="dialog" aria-modal="true">', target: ['div#modal'] },
      ]);

      const result = await checkFocusTrap(page);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('focus-trap');
      expect(result!.impact).toBe('serious');
      expect(result!.tags).toContain('wcag243');
      expect(result!.nodes).toHaveLength(1);
    });

    it('returns null when no escaping modal is found', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await checkFocusTrap(page);

      expect(result).toBeNull();
    });
  });

  describe('checkStatusMessage', () => {
    it('flags visible status text lacking a live region and marks it review', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([
        { html: '<div class="toast">Saved successfully</div>', target: ['div#toast'] },
      ]);

      const result = await checkStatusMessage(page);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('status-message');
      expect(result!.impact).toBe('moderate');
      expect(result!.tags).toContain('wcag413');
      expect(result!.kind).toBe('review');
    });

    it('returns null when no candidate status messages are found', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await checkStatusMessage(page);

      expect(result).toBeNull();
    });
  });

  describe('checkInlineError', () => {
    it('flags an invalid field with no associated error text', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([
        { html: '<input aria-invalid="true" id="email">', target: ['input#email'] },
      ]);

      const result = await checkInlineError(page);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('inline-error');
      expect(result!.impact).toBe('serious');
      expect(result!.tags).toContain('wcag331');
      expect(result!.nodes).toHaveLength(1);
    });

    it('returns null when invalid fields have associated error text', async () => {
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await checkInlineError(page);

      expect(result).toBeNull();
    });
  });

  describe('runCustomChecks', () => {
    it('collects results from all checks that find violations', async () => {
      const evaluateMock = page.evaluate as ReturnType<typeof vi.fn>;
      // Each check calls page.evaluate once; return results for first two, empty for the rest
      evaluateMock
        .mockResolvedValueOnce([{ html: '<a href="#">Read More</a>', target: ['a'] }])  // ambiguous link
        .mockResolvedValueOnce([{ html: '<a href="/">Home</a>', target: ['a'] }])        // aria-current
        .mockResolvedValueOnce([])                                                        // emphasis semantics
        .mockResolvedValueOnce([])                                                        // discount price
        .mockResolvedValueOnce([]);                                                       // sticky overlap

      const results = await runCustomChecks(page);

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('ambiguous-link-text');
      expect(results[1].id).toBe('aria-current-page');
    });

    it('returns empty array when no violations found', async () => {
      const evaluateMock = page.evaluate as ReturnType<typeof vi.fn>;
      evaluateMock.mockResolvedValue([]);

      const results = await runCustomChecks(page);

      expect(results).toHaveLength(0);
    });

    it('continues running checks even if one throws', async () => {
      const evaluateMock = page.evaluate as ReturnType<typeof vi.fn>;
      evaluateMock
        .mockRejectedValueOnce(new Error('evaluate failed'))                             // ambiguous link throws
        .mockResolvedValueOnce([{ html: '<a href="/">Home</a>', target: ['a'] }])        // aria-current
        .mockResolvedValueOnce([])                                                        // emphasis semantics
        .mockResolvedValueOnce([])                                                        // discount price
        .mockResolvedValueOnce([]);                                                       // sticky overlap

      const results = await runCustomChecks(page);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('aria-current-page');
    });
  });
});
