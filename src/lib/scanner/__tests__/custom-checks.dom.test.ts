// @vitest-environment happy-dom
//
// DOM-execution coverage for the custom accessibility probes.
//
// The sibling custom-checks.test.ts runs under the `node` environment and mocks
// page.evaluate, so it only exercises each probe's result-assembly logic — the
// large in-browser page.evaluate(() => { ... }) callback bodies never run there.
// This file runs under happy-dom and makes the mocked page.evaluate actually
// invoke the callback against a real DOM (with targeted layout stubs), so the
// detection heuristics themselves are executed and covered.
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  checkFormSubmitButton,
  checkInputOnChange,
  checkNewTabIndication,
  checkRequiredFieldIndication,
  checkInlineError,
  checkFocusVisible,
  checkSkipLinkFocusVisible,
  checkElementTabbableUnobscured,
  checkFocusTrap,
  checkStatusMessage,
  checkReflow,
  checkTabOrder,
  checkAccessibleNameLeak,
  checkDuplicateHeading,
  checkImageOfText,
  checkImageMeaningfulMissingAlt,
  checkUndeclaredLanguage,
  runCustomChecks,
} from '../custom-checks';
import type { Page } from 'playwright';

// OCR probe dependencies are mocked so checkImageOfText runs deterministically
// and offline. wcag-contrast is intentionally NOT mocked — the real ratio math
// runs against the pixels produced by the pngjs mock.
const ocrMocks = vi.hoisted(() => ({
  createWorker: null as null | ((...args: unknown[]) => unknown),
  pngRead: null as null | ((buf: Buffer) => unknown),
}));
vi.mock('tesseract.js', () => ({
  createWorker: (...args: unknown[]) => ocrMocks.createWorker?.(...args),
}));
vi.mock('pngjs', () => ({
  PNG: { sync: { read: (buf: Buffer) => ocrMocks.pngRead?.(buf) } },
}));

/**
 * A Page-like mock whose `evaluate` actually executes the supplied callback
 * against the live happy-dom document, mirroring how Playwright runs it in the
 * browser. Viewport helpers are stubbed for checkReflow.
 */
function makeDomPage(): Page {
  return {
    evaluate: vi.fn(<T, A>(fn: (arg: A) => T, arg: A) => Promise.resolve(fn(arg))),
    viewportSize: vi.fn(() => ({ width: 1280, height: 1024 })),
    setViewportSize: vi.fn().mockResolvedValue(undefined),
  } as unknown as Page;
}

/** Force every element to report a non-zero, on-screen bounding box. */
function stubVisibleRects(rect?: Partial<DOMRect>): void {
  const r = { x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20, toJSON() {}, ...rect } as DOMRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(r);
}

/** Stub window.getComputedStyle to return a controllable style declaration. */
function stubComputedStyle(style: Partial<CSSStyleDeclaration>): void {
  const base: Partial<CSSStyleDeclaration> = {
    display: 'block',
    visibility: 'visible',
    outlineStyle: 'none',
    outlineWidth: '0px',
    boxShadow: 'none',
    opacity: '1',
  };
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({ ...base, ...style } as CSSStyleDeclaration);
}

let page: Page;

beforeEach(() => {
  page = makeDomPage();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('custom-checks DOM execution', () => {
  describe('checkFormSubmitButton', () => {
    it('flags a form with no submit control', async () => {
      document.body.innerHTML = '<form id="search"><input type="text" name="q"></form>';
      const result = await checkFormSubmitButton(page);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('form_submit_button_exists');
      expect(result!.nodes).toHaveLength(1);
      expect(result!.nodes[0].target).toEqual(['form#search']);
    });

    it('passes a form that has a submit button', async () => {
      document.body.innerHTML = '<form><button type="submit">Go</button></form>';
      expect(await checkFormSubmitButton(page)).toBeNull();
    });

    it('passes a form with an implicit-submit button (no type)', async () => {
      document.body.innerHTML = '<form><button>Go</button></form>';
      expect(await checkFormSubmitButton(page)).toBeNull();
    });
  });

  describe('checkInputOnChange', () => {
    it('flags a navigational onchange handler with no advisory', async () => {
      document.body.innerHTML = '<select id="jump" onchange="location=this.value"><option>a</option></select>';
      const result = await checkInputOnChange(page);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('input_onchange_review');
      expect(result!.kind).toBe('review');
      expect(result!.nodes[0].target).toEqual(['select#jump']);
    });

    it('ignores a non-navigational onchange handler', async () => {
      document.body.innerHTML = '<select onchange="doStuff()"></select>';
      expect(await checkInputOnChange(page)).toBeNull();
    });

    it('passes when an advisory title is present', async () => {
      document.body.innerHTML = '<select onchange="this.form.submit()" title="auto submits"></select>';
      expect(await checkInputOnChange(page)).toBeNull();
    });

    it('passes when the wrapping label warns of auto navigation', async () => {
      document.body.innerHTML = '<label>Auto jump<select onchange="window.open(this.value)"></select></label>';
      expect(await checkInputOnChange(page)).toBeNull();
    });
  });

  describe('checkNewTabIndication', () => {
    it('flags a target=_blank link with no new-window hint', async () => {
      document.body.innerHTML = '<a id="r" href="/x" target="_blank">Report</a>';
      const result = await checkNewTabIndication(page);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('new-tab-indication');
      expect(result!.nodes[0].target).toEqual(['a#r']);
    });

    it('passes a link that announces the new tab in text', async () => {
      document.body.innerHTML = '<a href="/x" target="_blank">Report (opens in new tab)</a>';
      expect(await checkNewTabIndication(page)).toBeNull();
    });

    it('passes a link with an external-icon hint', async () => {
      document.body.innerHTML = '<a href="/x" target="_blank">Report<svg></svg></a>';
      expect(await checkNewTabIndication(page)).toBeNull();
    });
  });

  describe('checkRequiredFieldIndication', () => {
    it('flags a required field with no visible indication', async () => {
      document.body.innerHTML = '<input required id="email">';
      const result = await checkRequiredFieldIndication(page);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('required-field-indication');
      expect(result!.nodes[0].target).toEqual(['input#email']);
    });

    it('passes a required field with a visible "*" in its for-label', async () => {
      document.body.innerHTML = '<label for="email">Email *</label><input required id="email">';
      expect(await checkRequiredFieldIndication(page)).toBeNull();
    });

    it('passes an aria-required field whose aria-label says required', async () => {
      document.body.innerHTML = '<input aria-required="true" aria-label="Phone (required)">';
      expect(await checkRequiredFieldIndication(page)).toBeNull();
    });
  });

  describe('checkInlineError', () => {
    it('flags an aria-invalid field with no associated error text', async () => {
      document.body.innerHTML = '<input aria-invalid="true" id="email">';
      const result = await checkInlineError(page);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('inline-error');
      expect(result!.nodes[0].target).toEqual(['input#email']);
    });

    it('passes when aria-describedby points to error text', async () => {
      document.body.innerHTML =
        '<input aria-invalid="true" id="email" aria-describedby="err"><span id="err">Email is required</span>';
      expect(await checkInlineError(page)).toBeNull();
    });

    it('passes when aria-errormessage points to error text', async () => {
      document.body.innerHTML =
        '<input aria-invalid="true" id="phone" aria-errormessage="perr"><span id="perr">Bad number</span>';
      expect(await checkInlineError(page)).toBeNull();
    });
  });

  describe('checkFocusVisible', () => {
    it('flags a focusable element with no visible focus indicator', async () => {
      document.body.innerHTML = '<button id="go">Go</button>';
      stubVisibleRects();
      stubComputedStyle({ outlineStyle: 'none', outlineWidth: '0px', boxShadow: 'none' });
      const result = await checkFocusVisible(page);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('focus-visible');
      expect(result!.nodes[0].target).toEqual(['button#go']);
    });

    it('passes when the element shows an outline on focus', async () => {
      document.body.innerHTML = '<button id="go">Go</button>';
      stubVisibleRects();
      stubComputedStyle({ outlineStyle: 'solid', outlineWidth: '2px', boxShadow: 'none' });
      expect(await checkFocusVisible(page)).toBeNull();
    });

    it('skips zero-size elements', async () => {
      document.body.innerHTML = '<button>Go</button>';
      stubVisibleRects({ width: 0, height: 0, right: 10, bottom: 10 });
      expect(await checkFocusVisible(page)).toBeNull();
    });
  });

  describe('checkSkipLinkFocusVisible', () => {
    it('flags a skip link that stays hidden when focused', async () => {
      document.body.innerHTML = '<a id="skip" href="#main">Skip to main content</a>';
      stubVisibleRects();
      stubComputedStyle({ display: 'none' });
      const result = await checkSkipLinkFocusVisible(page);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('skip-link-focus-visible');
      expect(result!.nodes[0].target).toEqual(['a#skip']);
    });

    it('passes a skip link that becomes visible on focus', async () => {
      document.body.innerHTML = '<a href="#main">Skip to main content</a>';
      stubVisibleRects();
      stubComputedStyle({ display: 'block', visibility: 'visible', opacity: '1' });
      expect(await checkSkipLinkFocusVisible(page)).toBeNull();
    });

    it('ignores in-page anchors that are not skip links', async () => {
      document.body.innerHTML = '<a href="#section">Jump to section</a>';
      stubVisibleRects();
      stubComputedStyle({ display: 'none' });
      expect(await checkSkipLinkFocusVisible(page)).toBeNull();
    });
  });

  describe('checkElementTabbableUnobscured', () => {
    it('flags a focused element fully covered by another element', async () => {
      document.body.innerHTML = '<button id="go">Go</button><div id="overlay">x</div>';
      stubVisibleRects();
      const overlay = document.getElementById('overlay')!;
      vi.spyOn(document, 'elementFromPoint').mockReturnValue(overlay);
      const result = await checkElementTabbableUnobscured(page);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('element_tabbable_unobscured');
      expect(result!.nodes[0].target).toEqual(['button#go']);
    });

    it('passes when the focused element is the top element at its centre', async () => {
      document.body.innerHTML = '<button id="go">Go</button>';
      stubVisibleRects();
      const go = document.getElementById('go')!;
      vi.spyOn(document, 'elementFromPoint').mockReturnValue(go);
      expect(await checkElementTabbableUnobscured(page)).toBeNull();
    });

    it('skips elements whose centre is off-screen', async () => {
      document.body.innerHTML = '<button>Go</button>';
      stubVisibleRects({ left: -500, right: -400, top: -500, bottom: -400, x: -500, y: -500 });
      expect(await checkElementTabbableUnobscured(page)).toBeNull();
    });
  });

  describe('checkFocusTrap', () => {
    it('flags an open modal whose background remains focusable', async () => {
      document.body.innerHTML =
        '<div role="dialog" aria-modal="true" id="m"><button>Close</button></div><button id="bg">Background</button>';
      stubVisibleRects();
      stubComputedStyle({ display: 'block', visibility: 'visible' });
      const result = await checkFocusTrap(page);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('focus-trap');
      expect(result!.nodes[0].target).toEqual(['div#m']);
    });

    it('passes when background content is aria-hidden', async () => {
      document.body.innerHTML =
        '<div role="dialog" aria-modal="true" id="m"><button>Close</button></div>' +
        '<div aria-hidden="true"><button>Background</button></div>';
      stubVisibleRects();
      stubComputedStyle({ display: 'block', visibility: 'visible' });
      expect(await checkFocusTrap(page)).toBeNull();
    });

    it('returns null when there is no open modal', async () => {
      document.body.innerHTML = '<button id="bg">Background</button>';
      stubVisibleRects();
      stubComputedStyle({ display: 'block', visibility: 'visible' });
      expect(await checkFocusTrap(page)).toBeNull();
    });

    it('flags a role="dialog" modal that omits aria-modal but owns a backdrop', async () => {
      document.body.innerHTML =
        '<section role="dialog" data-backdrop="static" id="m"><button>Close</button></section>' +
        '<button id="bg">Background</button>';
      stubVisibleRects();
      stubComputedStyle({ display: 'block', visibility: 'visible' });
      const result = await checkFocusTrap(page);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('focus-trap');
      expect(result!.nodes[0].target).toEqual(['section#m']);
    });

    it('flags a role="dialog" modal with a visible .modal-backdrop overlay', async () => {
      document.body.innerHTML =
        '<section role="dialog" id="m"><button>Close</button></section>' +
        '<div class="modal-backdrop"></div><button id="bg">Background</button>';
      stubVisibleRects();
      stubComputedStyle({ display: 'block', visibility: 'visible' });
      const result = await checkFocusTrap(page);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('focus-trap');
    });

    it('does not flag a plain role="dialog" with no backdrop (false-positive guard)', async () => {
      document.body.innerHTML =
        '<div role="dialog" id="m"><button>Close</button></div><button id="bg">Background</button>';
      stubVisibleRects();
      stubComputedStyle({ display: 'block', visibility: 'visible' });
      expect(await checkFocusTrap(page)).toBeNull();
    });
  });

  describe('checkStatusMessage', () => {
    it('flags a visible status-like element with no live region (review)', async () => {
      document.body.innerHTML = '<div id="toast" class="toast">Saved successfully</div>';
      stubVisibleRects();
      stubComputedStyle({ display: 'block', visibility: 'visible' });
      const result = await checkStatusMessage(page);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('status-message');
      expect(result!.kind).toBe('review');
      expect(result!.nodes[0].target).toEqual(['div#toast']);
    });

    it('passes when the status element exposes role="status"', async () => {
      document.body.innerHTML = '<div class="toast" role="status">Saved</div>';
      stubVisibleRects();
      stubComputedStyle({ display: 'block', visibility: 'visible' });
      expect(await checkStatusMessage(page)).toBeNull();
    });

    it('passes when an ancestor is an aria-live region', async () => {
      document.body.innerHTML = '<div aria-live="polite"><span class="message">Done</span></div>';
      stubVisibleRects();
      stubComputedStyle({ display: 'block', visibility: 'visible' });
      expect(await checkStatusMessage(page)).toBeNull();
    });
  });

  describe('checkReflow', () => {
    function setDocWidths(scrollWidth: number, clientWidth: number): void {
      Object.defineProperty(document.documentElement, 'scrollWidth', { configurable: true, value: scrollWidth });
      Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: clientWidth });
    }

    it('flags horizontal overflow at the 320px viewport', async () => {
      setDocWidths(800, 320);
      const result = await checkReflow(page);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('reflow');
      expect(result!.nodes[0].target).toEqual(['html']);
      expect(page.setViewportSize).toHaveBeenCalledWith({ width: 320, height: 1024 });
    });

    it('passes when there is no horizontal overflow', async () => {
      setDocWidths(320, 320);
      expect(await checkReflow(page)).toBeNull();
    });
  });

  describe('checkTabOrder', () => {
    it('flags a positive tabindex and the resulting focus-order mismatch', async () => {
      document.body.innerHTML =
        '<button tabindex="3">A</button><button tabindex="1">B</button><button>C</button>';
      stubVisibleRects();
      stubComputedStyle({ outlineStyle: 'solid', outlineWidth: '2px' });
      const results = await checkTabOrder(page);
      expect(results).not.toBeNull();
      const ids = (results ?? []).map((r) => r.id);
      expect(ids).toContain('positive-tabindex');
      expect(ids).toContain('focus-order-mismatch');
    });

    it('flags an inline keyboard trap on Tab', async () => {
      document.body.innerHTML =
        '<div tabindex="0" onkeydown="if(event.key===\'Tab\'){event.preventDefault()}">Trap</div>';
      stubVisibleRects();
      stubComputedStyle({ outlineStyle: 'solid', outlineWidth: '2px' });
      const results = await checkTabOrder(page);
      const trap = (results ?? []).find((r) => r.id === 'keyboard-trap');
      expect(trap).toBeDefined();
      expect(trap!.impact).toBe('critical');
    });

    it('flags a focusable tab stop positioned off-screen', async () => {
      document.body.innerHTML = '<a href="/x">Link</a>';
      stubVisibleRects({ left: -100, right: -50, top: -100, bottom: -50, width: 50, height: 50 });
      stubComputedStyle({ outlineStyle: 'solid', outlineWidth: '2px' });
      const results = await checkTabOrder(page);
      const off = (results ?? []).find((r) => r.id === 'offscreen-focus');
      expect(off).toBeDefined();
    });

    it('flags a navigation-heavy page with no skip link', async () => {
      document.body.innerHTML = '<nav><a href="/a">A</a></nav>';
      stubVisibleRects();
      stubComputedStyle({ outlineStyle: 'solid', outlineWidth: '2px' });
      const results = await checkTabOrder(page);
      const skip = (results ?? []).find((r) => r.id === 'missing-skip-link');
      expect(skip).toBeDefined();
      expect(skip!.nodes[0].target).toEqual(['body']);
    });

    it('passes when a skip link is present', async () => {
      document.body.innerHTML =
        '<a href="#main">Skip to main content</a><nav><a href="/a">A</a></nav><main id="main">x</main>';
      stubVisibleRects();
      stubComputedStyle({ outlineStyle: 'solid', outlineWidth: '2px' });
      const results = await checkTabOrder(page);
      const skip = (results ?? []).find((r) => r.id === 'missing-skip-link');
      expect(skip).toBeUndefined();
    });

    it('flags a focusable element with no visible focus indicator', async () => {
      document.body.innerHTML = '<button>X</button>';
      stubVisibleRects();
      stubComputedStyle({ outlineStyle: 'none', outlineWidth: '0px', boxShadow: 'none' });
      const results = await checkTabOrder(page);
      const fnv = (results ?? []).find((r) => r.id === 'focus-not-visible');
      expect(fnv).toBeDefined();
    });

    it('passes a single focusable element with a visible focus ring', async () => {
      document.body.innerHTML = '<button tabindex="0">OK</button>';
      stubVisibleRects();
      stubComputedStyle({ outlineStyle: 'solid', outlineWidth: '2px' });
      expect(await checkTabOrder(page)).toBeNull();
    });
  });

  describe('checkAccessibleNameLeak', () => {
    it('flags an accessible name ending in "_label"', async () => {
      document.body.innerHTML = '<button aria-label="InsertButton_label">+</button>';
      const result = await checkAccessibleNameLeak(page);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('accessible-name-leak');
      expect(result!.nodes).toHaveLength(1);
    });

    it('flags a GUID accessible name', async () => {
      document.body.innerHTML =
        '<button aria-label="a1b2c3d4-e5f6-7890-abcd-ef1234567890">Go</button>';
      const result = await checkAccessibleNameLeak(page);
      expect(result).not.toBeNull();
      expect(result!.nodes[0].target).toEqual(['button']);
    });

    it('flags an underscore-delimited internal control id', async () => {
      document.body.innerHTML =
        '<button aria-label="ctl00_MainContent_btnSave">Save</button>';
      const result = await checkAccessibleNameLeak(page);
      expect(result).not.toBeNull();
    });

    it('passes controls with human-readable names', async () => {
      document.body.innerHTML =
        '<button aria-label="Insert">+</button><button aria-label="Submit">Go</button>';
      expect(await checkAccessibleNameLeak(page)).toBeNull();
    });
  });

  describe('checkDuplicateHeading', () => {
    it('flags repeated heading text', async () => {
      document.body.innerHTML = '<h2>Details</h2><h2>Details</h2>';
      const result = await checkDuplicateHeading(page);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('duplicate-heading');
      expect(result!.nodes).toHaveLength(1);
    });

    it('flags an ARIA heading missing a level', async () => {
      document.body.innerHTML = '<div role="heading">Title</div>';
      const result = await checkDuplicateHeading(page);
      expect(result).not.toBeNull();
      expect(result!.nodes[0].target).toEqual(['div']);
    });

    it('passes unique, well-levelled headings', async () => {
      document.body.innerHTML = '<h1>Title</h1><h2>Subtitle</h2>';
      expect(await checkDuplicateHeading(page)).toBeNull();
    });
  });

  describe('runCustomChecks (real DOM orchestration)', () => {
    it('collects findings from the real detection heuristics', async () => {
      document.body.innerHTML =
        '<form id="f"><input type="text"></form>' +
        '<a href="/x" target="_blank">Report</a>';
      stubVisibleRects();
      stubComputedStyle({ display: 'block', visibility: 'visible' });
      vi.spyOn(document, 'elementFromPoint').mockReturnValue(null);

      const results = await runCustomChecks(page);
      const ids = results.map((r) => r.id);
      expect(ids).toContain('form_submit_button_exists');
      expect(ids).toContain('new-tab-indication');
    });

    it('flattens array-returning probes into individual results', async () => {
      document.body.innerHTML =
        '<button tabindex="3">A</button><button tabindex="1">B</button>';
      stubVisibleRects();
      stubComputedStyle({ outlineStyle: 'solid', outlineWidth: '2px' });

      const results = await runCustomChecks(page);
      const ids = results.map((r) => r.id);
      expect(ids).toContain('positive-tabindex');
    });
  });

  describe('checkImageOfText (OCR)', () => {
    const SENTENCE_ALT = 'Register now to reserve your seat today';

    function makeOcrPage(): {
      page: Page;
      terminate: ReturnType<typeof vi.fn>;
      screenshot: ReturnType<typeof vi.fn>;
    } {
      const screenshot = vi.fn(async () => Buffer.from('fake-png'));
      const terminate = vi.fn(async () => undefined);
      // Default: a worker that recognizes one confident, word-like token.
      ocrMocks.createWorker = vi.fn(async () => ({
        recognize: vi.fn(async () => ({
          data: {
            blocks: [
              {
                paragraphs: [
                  {
                    lines: [
                      {
                        words: [
                          {
                            text: 'Welcome',
                            confidence: 92,
                            bbox: { x0: 5, y0: 5, x1: 80, y1: 22 },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        })),
        terminate,
      }));
      const base = makeDomPage();
      const page = {
        ...base,
        $: vi.fn(async (selector: string) =>
          document.querySelector(selector) ? { screenshot } : null,
        ),
      } as unknown as Page;
      return { page, terminate, screenshot };
    }

    // 100x30 RGBA: left half mid-grey (50), right half lighter grey (90).
    // A word spanning both halves yields ~1.9:1 contrast — below the 4.5 minimum.
    function lowContrastPng() {
      return () => {
        const width = 100;
        const height = 30;
        const data = Buffer.alloc(width * height * 4);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const v = x < 50 ? 50 : 90;
            data[i] = v;
            data[i + 1] = v;
            data[i + 2] = v;
            data[i + 3] = 255;
          }
        }
        return { width, height, data };
      };
    }

    it('flags image-of-text for a sentence-like alt image and tears down the worker', async () => {
      document.body.innerHTML = `<img id="hero" alt="${SENTENCE_ALT}">`;
      stubVisibleRects();
      stubComputedStyle({});
      ocrMocks.pngRead = lowContrastPng();
      const { page, terminate } = makeOcrPage();

      const results = await checkImageOfText(page);
      expect(results).not.toBeNull();
      const iot = results!.find((r) => r.id === 'image-of-text');
      expect(iot).toBeDefined();
      expect(iot!.kind).toBe('review');
      expect(iot!.tags).toContain('wcag145');
      expect(iot!.nodes[0].target).toEqual(['img#hero']);
      expect(terminate).toHaveBeenCalledTimes(1);
    });

    it('flags rendered-text-contrast when baked text is below the AA minimum', async () => {
      document.body.innerHTML = `<img id="hero" alt="${SENTENCE_ALT}">`;
      stubVisibleRects();
      stubComputedStyle({});
      ocrMocks.pngRead = lowContrastPng();
      const { page } = makeOcrPage();

      const results = await checkImageOfText(page);
      const ids = (results ?? []).map((r) => r.id);
      expect(ids).toContain('rendered-text-contrast');
      const contrast = (results ?? []).find(
        (r) => r.id === 'rendered-text-contrast',
      );
      expect(contrast!.tags).toContain('wcag143');
    });

    it('returns null without starting a worker when there are no suspect regions', async () => {
      document.body.innerHTML = '<img id="logo" alt="Logo">';
      stubVisibleRects();
      stubComputedStyle({});
      makeOcrPage();
      const createSpy = vi.fn(async () => {
        throw new Error('should not be called');
      });
      ocrMocks.createWorker = createSpy;
      const page = {
        ...makeDomPage(),
        $: vi.fn(async () => null),
      } as unknown as Page;

      const results = await checkImageOfText(page);
      expect(results).toBeNull();
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('degrades gracefully (returns null) when the OCR worker cannot start', async () => {
      document.body.innerHTML = `<img id="hero" alt="${SENTENCE_ALT}">`;
      stubVisibleRects();
      stubComputedStyle({});
      const { page } = makeOcrPage();
      ocrMocks.createWorker = vi.fn(async () => {
        throw new Error('language data missing');
      });

      const results = await checkImageOfText(page);
      expect(results).toBeNull();
    });
  });

  describe('checkImageMeaningfulMissingAlt (WCAG 1.1.1)', () => {
    it('flags a meaningful image inside a link with empty alt=""', async () => {
      document.body.innerHTML =
        '<a href="/profile"><img id="photo" src="/img/user-photo.png" alt=""></a>';
      stubVisibleRects({ width: 120, height: 120 });
      stubComputedStyle({});

      const result = await checkImageMeaningfulMissingAlt(page);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('meaningful-image-missing-alt');
      expect(result!.kind).toBe('review');
      expect(result!.tags).toContain('wcag111');
      expect(result!.nodes).toHaveLength(1);
      expect(result!.nodes[0].target).toEqual(['img#photo']);
      expect(result!.nodes[0].html).toContain('empty alt');
    });

    it('flags a large meaningful image with a missing alt attribute', async () => {
      document.body.innerHTML = '<img id="diagram" src="/img/appeal.png">';
      stubVisibleRects({ width: 300, height: 200 });
      stubComputedStyle({});

      const result = await checkImageMeaningfulMissingAlt(page);
      expect(result).not.toBeNull();
      expect(result!.nodes[0].target).toEqual(['img#diagram']);
      expect(result!.nodes[0].html).toContain('missing alt');
    });

    it('ignores named, decorative, spacer and aria-hidden images', async () => {
      document.body.innerHTML = [
        '<img id="ok1" src="/img/logo.png" alt="Ontario Land Tribunal">',
        '<img id="ok2" src="/img/divider.png" alt="" role="presentation">',
        '<img id="ok3" src="/img/spacer.gif" alt="">',
        '<img id="ok4" src="/img/bg.png" alt="" aria-hidden="true">',
      ].join('');
      stubVisibleRects({ width: 120, height: 120 });
      stubComputedStyle({});

      const result = await checkImageMeaningfulMissingAlt(page);
      expect(result).toBeNull();
    });
  });

  describe('checkUndeclaredLanguage (WCAG 3.1.2)', () => {
    beforeEach(() => {
      document.documentElement.setAttribute('lang', 'en');
    });

    it('flags a French passage with no lang on an English page', async () => {
      document.body.innerHTML =
        "<p id=\"fr1\">Veuillez sélectionner votre type d'appel pour continuer avec votre demande.</p>";
      stubComputedStyle({});

      const result = await checkUndeclaredLanguage(page);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('undeclared-language');
      expect(result!.kind).toBe('review');
      expect(result!.tags).toContain('wcag312');
      expect(result!.nodes[0].target).toEqual(['p#fr1']);
    });

    it('ignores French that is correctly declared lang="fr" and English text', async () => {
      document.body.innerHTML = [
        '<p id="okfr" lang="fr">Veuillez remplir tous les champs obligatoires avant de soumettre.</p>',
        '<p id="oken">Please select your appeal type to continue with your request.</p>',
      ].join('');
      stubComputedStyle({});

      const result = await checkUndeclaredLanguage(page);
      expect(result).toBeNull();
    });

    it('flags a short French label whose words are not in the lexicon (two accented words)', async () => {
      // Real OLT case: accented French labels on an en-us page, none of whose
      // words are in FR_WORDS. The accented-word-count rule must catch them.
      document.body.innerHTML = [
        '<a id="fr-num">Num\u00e9ro de r\u00e9f\u00e9rence</a>',
        '<a id="fr-loc">Emplacement de la propri\u00e9t\u00e9 vis\u00e9e</a>',
      ].join('');
      stubComputedStyle({});

      const result = await checkUndeclaredLanguage(page);
      expect(result).not.toBeNull();
      const targets = result!.nodes.map((n) => n.target[0]);
      expect(targets).toContain('a#fr-num');
      expect(targets).toContain('a#fr-loc');
    });

    it('does not flag English text containing French-cognate words without diacritics', async () => {
      // The /en/parties/ and /en/help/ false-positive shapes: English sentences
      // that merely contain words also present in French (parties, documents,
      // tribunal). With no diacritics these must NOT be flagged.
      document.body.innerHTML = [
        '<p id="en1">Anyone that will be representing the appellant in the matter before the Ontario Land Tribunal.</p>',
        '<li id="en2">It is required that you include copies of documents as indicated in the documents checklist.</li>',
      ].join('');
      stubComputedStyle({});

      const result = await checkUndeclaredLanguage(page);
      expect(result).toBeNull();
    });

    it('flags an English passage with no lang on a French page (reverse direction)', async () => {
      // Direction-agnostic: an English run sitting under a French page default
      // must flag just as a French run under an English page does.
      document.documentElement.setAttribute('lang', 'fr');
      document.body.innerHTML =
        '<p id="en-rev">Please complete all required fields before submitting your appeal request.</p>';
      stubComputedStyle({});

      const result = await checkUndeclaredLanguage(page);
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('review');
      expect(result!.nodes[0].target).toEqual(['p#en-rev']);
      // Generalized surface string names the detected language, not a hardcoded one.
      expect(result!.description).toContain('English');
    });

    it('flags a Spanish passage with no lang on an English page (third language)', async () => {
      // Detector-driven coverage beyond the French diacritic class: Spanish
      // acute accents are not in the DIA set, so this can only flag via the
      // statistical detector — proving the probe is not French-specific.
      document.body.innerHTML =
        '<p id="es1">Esta p\u00e1gina contiene informaci\u00f3n importante sobre el proceso de apelaci\u00f3n ante el tribunal.</p>';
      stubComputedStyle({});

      const result = await checkUndeclaredLanguage(page);
      expect(result).not.toBeNull();
      expect(result!.nodes[0].target).toEqual(['p#es1']);
      expect(result!.description).toContain('Spanish');
    });
  });
});
