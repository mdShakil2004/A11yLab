import type { Page } from 'playwright';
import path from 'node:path';
import { tabbable } from 'tabbable';
import { detectAll } from 'tinyld';
import type { CustomCheckResult } from './result-normalizer';

const AMBIGUOUS_LINK_TEXTS = new Set([
  'learn more', 'click here', 'more', 'here', 'read more',
  'continue', 'details', 'link',
]);

async function checkAmbiguousLinkText(page: Page): Promise<CustomCheckResult | null> {
  const nodes = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    const results: { html: string; target: string[] }[] = [];
    const ambiguous = new Set([
      'learn more', 'click here', 'more', 'here', 'read more',
      'continue', 'details', 'link',
    ]);
    for (const link of links) {
      const text = (link.innerText ?? '').trim().toLowerCase();
      if (text && ambiguous.has(text)) {
        results.push({
          html: link.outerHTML,
          target: [link.tagName.toLowerCase() + (link.className ? '.' + link.className.split(/\s+/).join('.') : '')],
        });
      }
    }
    return results;
  });

  if (!nodes.length) return null;

  return {
    id: 'ambiguous-link-text',
    impact: 'serious',
    description: 'Links must have descriptive text that conveys their purpose without surrounding context.',
    help: 'Avoid generic link text like "Learn More", "Click Here", etc.',
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html',
    tags: ['wcag2a', 'wcag244'],
    nodes,
  };
}

async function checkAriaCurrentPage(page: Page): Promise<CustomCheckResult | null> {
  const nodes = await page.evaluate(() => {
    const results: { html: string; target: string[] }[] = [];
    const navs = Array.from(document.querySelectorAll('nav'));
    const currentPath = window.location.pathname;
    const currentHref = window.location.href;

    for (const nav of navs) {
      const links = Array.from(nav.querySelectorAll('a[href]'));
      for (const link of links) {
        const href = link.getAttribute('href') ?? '';
        const resolvedHref = (link as HTMLAnchorElement).href;
        const isCurrentPage = href === currentPath || resolvedHref === currentHref;
        if (isCurrentPage && link.getAttribute('aria-current') !== 'page') {
          results.push({
            html: link.outerHTML,
            target: [link.tagName.toLowerCase() + (link.className ? '.' + link.className.split(/\s+/).join('.') : '')],
          });
        }
      }
    }
    return results;
  });

  if (!nodes.length) return null;

  return {
    id: 'aria-current-page',
    impact: 'moderate',
    description: 'Navigation links pointing to the current page should have aria-current="page".',
    help: 'Add aria-current="page" to navigation links that point to the current page.',
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html',
    tags: ['wcag2a', 'wcag131'],
    nodes,
  };
}

async function checkEmphasisStrongSemantics(page: Page): Promise<CustomCheckResult | null> {
  const nodes = await page.evaluate(() => {
    const results: { html: string; target: string[] }[] = [];
    const elements = Array.from(document.querySelectorAll('b, i'));

    for (const el of elements) {
      // Skip if aria-hidden (decorative use is fine)
      if (el.getAttribute('aria-hidden') === 'true') continue;
      // Skip if inside <code>, <pre>, or used as icon container (common pattern)
      if (el.closest('code, pre')) continue;

      results.push({
        html: el.outerHTML,
        target: [el.tagName.toLowerCase()],
      });
    }
    return results;
  });

  if (!nodes.length) return null;

  return {
    id: 'emphasis-strong-semantics',
    impact: 'minor',
    description: '<b> and <i> elements convey no semantic meaning. Use <strong> and <em> instead for meaningful emphasis.',
    help: 'Replace <b> with <strong> and <i> with <em> for semantic emphasis.',
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html',
    tags: ['best-practice'],
    nodes,
  };
}

async function checkDiscountPriceAccessibility(page: Page): Promise<CustomCheckResult | null> {
  const nodes = await page.evaluate(() => {
    const results: { html: string; target: string[] }[] = [];
    const strikethroughElements = Array.from(document.querySelectorAll('del, s, strike'));

    for (const el of strikethroughElements) {
      // Check for aria-label on the element itself
      if (el.getAttribute('aria-label')) continue;

      // Check for visually-hidden/sr-only adjacent context
      const parent = el.parentElement;
      if (parent) {
        const siblingText = parent.textContent?.toLowerCase() ?? '';
        const contextPatterns = ['original price', 'was', 'regular price', 'old price', 'previously'];
        if (contextPatterns.some(p => siblingText.includes(p))) continue;

        // Check for sr-only / visually-hidden class in siblings or children
        const srOnly = parent.querySelector('.sr-only, .visually-hidden, [class*="sr-only"], [class*="visually-hidden"]');
        if (srOnly) continue;
      }

      results.push({
        html: el.outerHTML,
        target: [el.tagName.toLowerCase()],
      });
    }
    return results;
  });

  if (!nodes.length) return null;

  return {
    id: 'discount-price-accessibility',
    impact: 'serious',
    description: 'Strikethrough pricing must provide screen reader context so users understand the visual meaning.',
    help: 'Add aria-label or visually-hidden text to indicate strikethrough pricing context.',
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html',
    tags: ['wcag2a', 'wcag131'],
    nodes,
  };
}

async function checkStickyElementOverlap(page: Page): Promise<CustomCheckResult | null> {
  const nodes = await page.evaluate(() => {
    const results: { html: string; target: string[] }[] = [];

    // Find all fixed/sticky elements
    const allElements = Array.from(document.querySelectorAll('*'));
    const stickyRects: DOMRect[] = [];
    for (const el of allElements) {
      const style = window.getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'sticky') {
        stickyRects.push(el.getBoundingClientRect());
      }
    }

    if (!stickyRects.length) return results;

    // Find focusable elements
    const focusable = Array.from(document.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    ));

    for (const el of focusable) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      for (const stickyRect of stickyRects) {
        const overlaps =
          rect.top < stickyRect.bottom &&
          rect.bottom > stickyRect.top &&
          rect.left < stickyRect.right &&
          rect.right > stickyRect.left;

        if (overlaps) {
          results.push({
            html: el.outerHTML,
            target: [el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(/\s+/).join('.') : '')],
          });
          break; // Only report each focusable element once
        }
      }
    }
    return results;
  });

  if (!nodes.length) return null;

  return {
    id: 'sticky-element-overlap',
    impact: 'serious',
    description: 'Focusable elements must not be obscured by fixed or sticky positioned elements.',
    help: 'Ensure focusable elements are not hidden behind sticky or fixed headers/footers.',
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html',
    tags: ['wcag2aa', 'wcag247'],
    nodes,
  };
}

/**
 * 3.3.1 / 3.3.3 support: every <form> must contain a submit control so it can
 * be operated without relying on scripting or implicit Enter-key submission.
 */
async function checkFormSubmitButton(page: Page): Promise<CustomCheckResult | null> {
  const nodes = await page.evaluate(() => {
    const results: { html: string; target: string[] }[] = [];
    const forms = Array.from(document.querySelectorAll('form'));
    for (const form of forms) {
      const hasSubmit = !!form.querySelector(
        'button[type="submit"], input[type="submit"], input[type="image"], button:not([type])'
      );
      if (hasSubmit) continue;
      results.push({
        html: form.outerHTML.slice(0, 400),
        target: ['form' + (form.id ? '#' + form.id : '')],
      });
    }
    return results;
  });
  if (!nodes.length) return null;
  return {
    id: 'form_submit_button_exists',
    impact: 'serious',
    description: 'Each form should contain an explicit submit control so it can be operated reliably.',
    help: 'Add a submit button (<button type="submit"> or <input type="submit">) to the form.',
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html',
    tags: ['wcag2a', 'wcag331'],
    nodes,
  };
}

/**
 * 3.2.2 On Input (review): a select/input whose inline onchange handler
 * navigates or auto-submits without warning the user in advance is flagged for
 * manual review rather than treated as a hard failure.
 */
async function checkInputOnChange(page: Page): Promise<CustomCheckResult | null> {
  const nodes = await page.evaluate(() => {
    const results: { html: string; target: string[] }[] = [];
    const els = Array.from(document.querySelectorAll('select[onchange], input[onchange]'));
    for (const el of els) {
      const handler = (el.getAttribute('onchange') ?? '').toLowerCase();
      const navigates = /(location|\.submit\(|window\.open|\.href)/.test(handler);
      if (!navigates) continue;
      const labelText = (el.closest('label')?.textContent ?? '').toLowerCase();
      const hasAdvisory =
        el.hasAttribute('aria-describedby') ||
        !!el.getAttribute('title') ||
        /auto|submit|navigat|reload|refresh|jump/.test(labelText);
      if (hasAdvisory) continue;
      results.push({
        html: (el as HTMLElement).outerHTML.slice(0, 300),
        target: [el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')],
      });
    }
    return results;
  });
  if (!nodes.length) return null;
  return {
    id: 'input_onchange_review',
    impact: 'moderate',
    description: 'Changing a control\u2019s setting that automatically navigates or submits should warn the user in advance.',
    help: 'Provide advisory text before an onchange handler navigates or submits, or use an explicit activation control.',
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/on-input.html',
    tags: ['wcag32', 'wcag322'],
    nodes,
    kind: 'review',
  };
}

/**
 * 2.4.11 Focus Not Obscured (Minimum): when a tabbable element receives focus
 * it must not be entirely hidden by author-created content. Uses an
 * elementFromPoint occlusion test at the element's centre point.
 */
async function checkElementTabbableUnobscured(page: Page): Promise<CustomCheckResult | null> {
  const nodes = await page.evaluate(() => {
    const results: { html: string; target: string[] }[] = [];
    const tabbables = Array.from(document.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )) as HTMLElement[];
    for (const el of tabbables) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) continue;
      try { el.focus({ preventScroll: true }); } catch { continue; }
      const topEl = document.elementFromPoint(cx, cy);
      if (!topEl) continue;
      if (topEl === el || el.contains(topEl) || topEl.contains(el)) continue;
      results.push({
        html: el.outerHTML.slice(0, 300),
        target: [el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')],
      });
    }
    return results;
  });
  if (!nodes.length) return null;
  return {
    id: 'element_tabbable_unobscured',
    impact: 'serious',
    description: 'When a tabbable element receives keyboard focus it must not be entirely hidden by author-created content.',
    help: 'Ensure focused elements are not obscured by overlays, sticky headers, or other content.',
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html',
    tags: ['wcag22', 'wcag2411'],
    nodes,
  };
}

/**
 * 2.4.7 Focus Visible: keyboard-focusable elements must show a visible focus
 * indicator (outline or box-shadow) when focused.
 */
async function checkFocusVisible(page: Page): Promise<CustomCheckResult | null> {
  const nodes = await page.evaluate(() => {
    const results: { html: string; target: string[] }[] = [];
    const focusable = Array.from(document.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )) as HTMLElement[];
    for (const el of focusable) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      try { el.focus({ preventScroll: true }); } catch { continue; }
      if (document.activeElement !== el) continue;
      const s = window.getComputedStyle(el);
      const hasOutline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth || '0') > 0;
      const hasBoxShadow = s.boxShadow !== 'none' && s.boxShadow !== '';
      if (hasOutline || hasBoxShadow) continue;
      results.push({
        html: el.outerHTML.slice(0, 300),
        target: [el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')],
      });
    }
    return results;
  });
  if (!nodes.length) return null;
  return {
    id: 'focus-visible',
    impact: 'serious',
    description: 'Keyboard-focusable elements must have a visible focus indicator.',
    help: 'Provide a visible focus indicator (outline or box-shadow) when an element receives keyboard focus.',
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html',
    tags: ['wcag2aa', 'wcag247'],
    nodes,
  };
}

/**
 * 2.4.1 Bypass Blocks: a skip link that exists but never becomes visible when
 * it receives keyboard focus leaves sighted keyboard users unable to see it.
 */
async function checkSkipLinkFocusVisible(page: Page): Promise<CustomCheckResult | null> {
  const nodes = await page.evaluate(() => {
    const results: { html: string; target: string[] }[] = [];
    const anchors = Array.from(document.querySelectorAll('a[href^="#"]')) as HTMLAnchorElement[];
    const skipLinks = anchors.filter(a => {
      const t = (a.textContent ?? '').trim().toLowerCase();
      return /skip/.test(t) && /(content|main|nav|navigation)/.test(t);
    });
    for (const link of skipLinks) {
      try { link.focus({ preventScroll: true }); } catch { continue; }
      const s = window.getComputedStyle(link);
      const rect = link.getBoundingClientRect();
      const hidden =
        s.display === 'none' ||
        s.visibility === 'hidden' ||
        rect.width === 0 || rect.height === 0 ||
        rect.bottom < 0 || rect.right < 0 ||
        parseFloat(s.opacity || '1') === 0;
      if (!hidden) continue;
      results.push({
        html: link.outerHTML,
        target: [link.tagName.toLowerCase() + (link.id ? '#' + link.id : '')],
      });
    }
    return results;
  });
  if (!nodes.length) return null;
  return {
    id: 'skip-link-focus-visible',
    impact: 'moderate',
    description: 'A skip link must become visible when it receives keyboard focus.',
    help: 'Reveal skip links on focus (e.g. move them on-screen) instead of keeping them permanently hidden.',
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html',
    tags: ['wcag2a', 'wcag241'],
    nodes,
  };
}

/**
 * 3.2.2 On Input: links opening in a new tab/window via target="_blank" should
 * indicate the new-window behaviour visibly or to assistive technology.
 */
async function checkNewTabIndication(page: Page): Promise<CustomCheckResult | null> {
  const nodes = await page.evaluate(() => {
    const results: { html: string; target: string[] }[] = [];
    const anchors = Array.from(document.querySelectorAll('a[target="_blank"]')) as HTMLAnchorElement[];
    for (const a of anchors) {
      const text = (a.textContent ?? '').toLowerCase();
      const aria = (a.getAttribute('aria-label') ?? '').toLowerCase();
      const title = (a.getAttribute('title') ?? '').toLowerCase();
      const combined = `${text} ${aria} ${title}`;
      const mentionsNewWindow = /(new (tab|window)|opens in|external|\(opens)/.test(combined);
      const hasIconHint = !!a.querySelector('svg, img[alt], [class*="external"], [class*="new-window"]');
      if (mentionsNewWindow || hasIconHint) continue;
      results.push({
        html: a.outerHTML.slice(0, 300),
        target: [a.tagName.toLowerCase() + (a.id ? '#' + a.id : '')],
      });
    }
    return results;
  });
  if (!nodes.length) return null;
  return {
    id: 'new-tab-indication',
    impact: 'moderate',
    description: 'Links that open in a new tab or window should indicate this to the user in advance.',
    help: 'Add visible or assistive-technology text (e.g. "(opens in new tab)") to target="_blank" links.',
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/on-input.html',
    tags: ['wcag2a', 'wcag322'],
    nodes,
  };
}

/**
 * 1.4.10 Reflow: at a 320 CSS pixel width content must not require horizontal
 * scrolling. Resizes the viewport, measures document overflow, then restores
 * the original viewport.
 */
async function checkReflow(page: Page): Promise<CustomCheckResult | null> {
  const original = page.viewportSize();
  try {
    await page.setViewportSize({ width: 320, height: 1024 });
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      const horizontal = doc.scrollWidth - doc.clientWidth;
      if (horizontal <= 1) return null;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    if (!overflow) return null;
    return {
      id: 'reflow',
      impact: 'serious',
      description: 'Content must reflow to a 320 CSS pixel width without requiring two-dimensional scrolling.',
      help: 'Avoid fixed-width layouts; ensure content reflows so no horizontal scrolling is needed at 320px.',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/reflow.html',
      tags: ['wcag2aa', 'wcag1410'],
      nodes: [{
        html: `<html data-scroll-width="${overflow.scrollWidth}" data-client-width="${overflow.clientWidth}">`,
        target: ['html'],
      }],
    };
  } finally {
    try {
      if (original) await page.setViewportSize(original);
    } catch {
      // Restoring the viewport is best-effort and must not mask the result.
    }
  }
}

/**
 * 3.3.2 Labels or Instructions: required fields must convey their required
 * status both programmatically (required / aria-required) and visibly (e.g. a
 * "*" or "(required)" in the associated label).
 */
async function checkRequiredFieldIndication(page: Page): Promise<CustomCheckResult | null> {
  const nodes = await page.evaluate(() => {
    const results: { html: string; target: string[] }[] = [];
    const fields = Array.from(document.querySelectorAll(
      'input[required], select[required], textarea[required], [aria-required="true"]'
    )) as HTMLElement[];
    for (const field of fields) {
      const hasProgrammatic =
        field.getAttribute('aria-required') === 'true' || field.hasAttribute('required');
      const id = field.getAttribute('id');
      let labelText = '';
      if (id) {
        const lbl = document.querySelector(`label[for="${id}"]`);
        if (lbl) labelText += ' ' + (lbl.textContent ?? '');
      }
      const wrappingLabel = field.closest('label');
      if (wrappingLabel) labelText += ' ' + (wrappingLabel.textContent ?? '');
      const ariaLabel = field.getAttribute('aria-label');
      if (ariaLabel) labelText += ' ' + ariaLabel;
      const hasVisible = /\*|\(required\)|required/i.test(labelText);
      if (hasProgrammatic && hasVisible) continue;
      results.push({
        html: field.outerHTML.slice(0, 300),
        target: [field.tagName.toLowerCase() + (id ? '#' + id : '')],
      });
    }
    return results;
  });
  if (!nodes.length) return null;
  return {
    id: 'required-field-indication',
    impact: 'moderate',
    description: 'Required form fields must indicate that they are required, both programmatically and visibly.',
    help: 'Mark required fields with aria-required (or required) and a visible indication such as "*" or "(required)".',
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html',
    tags: ['wcag2a', 'wcag332'],
    nodes,
  };
}

/**
 * 2.4.3 Focus Order: an open modal dialog must keep keyboard focus inside it.
 * This static heuristic flags an open modal whose surrounding background
 * content is still focusable (not inert and not aria-hidden), which means
 * Tab/Shift+Tab can escape the dialog into the background instead of cycling
 * within it.
 */
async function checkFocusTrap(page: Page): Promise<CustomCheckResult | null> {
  const nodes = await page.evaluate(() => {
    const results: { html: string; target: string[] }[] = [];
    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const isVisible = (el: Element): boolean => {
      const s = window.getComputedStyle(el as HTMLElement);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      const rect = (el as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    // Explicitly-declared modals: aria-modal="true" or a native open <dialog>.
    const explicitModals = Array.from(
      document.querySelectorAll('[role="dialog"][aria-modal="true"], [aria-modal="true"], dialog[open]')
    );
    // Implicitly-modal dialogs: role="dialog" WITHOUT aria-modal that still own a
    // backdrop (own data-backdrop attribute, or a visible .modal-backdrop overlay
    // in the document). Omitting aria-modal is itself a focus-management defect,
    // and such a dialog still must trap focus, so it is in scope for 2.4.3.
    const backdropPresent = Array.from(
      document.querySelectorAll('.modal-backdrop, [class*="backdrop"]')
    ).some(isVisible);
    const implicitModals = Array.from(document.querySelectorAll('[role="dialog"]')).filter((el) => {
      if ((el as HTMLElement).getAttribute('aria-modal') === 'true') return false; // already in explicitModals
      return (el as HTMLElement).hasAttribute('data-backdrop') || backdropPresent;
    });
    const dialogs = Array.from(new Set([...explicitModals, ...implicitModals])).filter(isVisible);

    for (const dialog of dialogs) {
      const background = Array.from(document.querySelectorAll(FOCUSABLE)).filter((el) => {
        if (dialog.contains(el)) return false;
        // Background that is properly removed from the tab order is fine.
        if ((el as HTMLElement).closest('[inert]')) return false;
        if ((el as HTMLElement).closest('[aria-hidden="true"]')) return false;
        return isVisible(el);
      });
      if (background.length === 0) continue;
      results.push({
        html: (dialog as HTMLElement).outerHTML.slice(0, 300),
        target: [dialog.tagName.toLowerCase() + (dialog.id ? '#' + dialog.id : '')],
      });
    }
    return results;
  });
  if (!nodes.length) return null;
  return {
    id: 'focus-trap',
    impact: 'serious',
    description: 'An open modal dialog must trap keyboard focus so Tab and Shift+Tab cycle within it and cannot reach background content.',
    help: 'Keep focus inside open modal dialogs by making background content inert or aria-hidden, and return focus to the opener on close.',
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html',
    tags: ['wcag2a', 'wcag243'],
    nodes,
  };
}

/**
 * 4.1.3 Status Messages: dynamically presented status text (toasts, inline
 * success/error banners) must be programmatically exposed via role="status",
 * role="alert", or an aria-live region so assistive technology announces it
 * without a focus change. Reported as a "needs review" finding because static
 * analysis cannot confirm the text is presented dynamically.
 */
async function checkStatusMessage(page: Page): Promise<CustomCheckResult | null> {
  const nodes = await page.evaluate(() => {
    const results: { html: string; target: string[] }[] = [];
    const STATUS_HINT = /(toast|snackbar|notification|flash|alert|status|banner|message|success|error)/i;

    const candidates = Array.from(document.querySelectorAll('[class],[id]')) as HTMLElement[];
    for (const el of candidates) {
      const hint = `${el.className} ${el.id}`;
      if (!STATUS_HINT.test(hint)) continue;

      const text = (el.textContent ?? '').trim();
      if (!text) continue;

      const s = window.getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;

      // Skip when the element or an ancestor already exposes a live region.
      const role = el.getAttribute('role');
      const hasRole = role === 'status' || role === 'alert';
      const hasLive =
        el.hasAttribute('aria-live') || !!el.closest('[role="status"],[role="alert"],[aria-live]');
      if (hasRole || hasLive) continue;

      // Avoid flagging large layout containers; only leaf-ish text blocks.
      if (el.querySelector('[class],[id]')) continue;

      results.push({
        html: el.outerHTML.slice(0, 300),
        target: [el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')],
      });
    }
    return results;
  });
  if (!nodes.length) return null;
  return {
    id: 'status-message',
    impact: 'moderate',
    description: 'Status messages should be exposed to assistive technology via role="status", role="alert", or an aria-live region.',
    help: 'Add role="status"/role="alert" or aria-live to dynamically presented status text so it is announced without moving focus.',
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html',
    tags: ['wcag2aa', 'wcag413'],
    nodes,
    kind: 'review',
  };
}

/**
 * 3.3.1 Error Identification: a form field flagged as invalid
 * (aria-invalid="true") must have its error described in text and associated
 * programmatically via aria-describedby or aria-errormessage.
 */
async function checkInlineError(page: Page): Promise<CustomCheckResult | null> {
  const nodes = await page.evaluate(() => {
    const results: { html: string; target: string[] }[] = [];
    const fields = Array.from(
      document.querySelectorAll('[aria-invalid="true"]')
    ) as HTMLElement[];

    const describedText = (el: HTMLElement): string => {
      const ids = `${el.getAttribute('aria-describedby') ?? ''} ${el.getAttribute('aria-errormessage') ?? ''}`
        .split(/\s+/)
        .filter(Boolean);
      let text = '';
      for (const id of ids) {
        const ref = document.getElementById(id);
        if (ref) text += ' ' + (ref.textContent ?? '');
      }
      return text.trim();
    };

    for (const field of fields) {
      const text = describedText(field);
      if (text) continue;
      results.push({
        html: field.outerHTML.slice(0, 300),
        target: [field.tagName.toLowerCase() + (field.id ? '#' + field.id : '')],
      });
    }
    return results;
  });
  if (!nodes.length) return null;
  return {
    id: 'inline-error',
    impact: 'serious',
    description: 'Form fields marked invalid must identify the error in text and associate it programmatically.',
    help: 'Provide a text error message and link it to the invalid field with aria-describedby or aria-errormessage.',
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html',
    tags: ['wcag2a', 'wcag331'],
    nodes,
  };
}

/**
 * 2.1.1 / 2.1.2 / 2.4.3 / 2.4.7 keyboard & focus order. Uses the `tabbable`
 * package as the expected-tab-order oracle and diffs it against DOM source
 * order, while also flagging positive tabindex, off-screen focus targets,
 * inline keyboard traps, a missing skip link, and focusable elements with no
 * visible focus indicator. Returns one CustomCheckResult per finding type.
 *
 * Under the happy-dom test harness `page.evaluate` runs this callback in Node,
 * where the module-level `tabbable` import is in scope. `displayCheck: 'full'`
 * is attempted first (correct in a live Chromium page) and falls back to
 * `'none'` because happy-dom/jsdom lack full layout. The call is wrapped in
 * try/catch so a missing oracle in a serialized browser context degrades to
 * the DOM-only checks instead of throwing.
 */
async function checkTabOrder(page: Page): Promise<CustomCheckResult[] | null> {
  const findings = await page.evaluate(() => {
    interface Finding {
      html: string;
      target: string[];
    }
    const out: Record<string, Finding[]> = {
      'focus-order-mismatch': [],
      'keyboard-trap': [],
      'offscreen-focus': [],
      'positive-tabindex': [],
      'missing-skip-link': [],
      'focus-not-visible': [],
    };
    const node = (el: Element): Finding => ({
      html: (el as HTMLElement).outerHTML.slice(0, 300),
      target: [el.tagName.toLowerCase() + ((el as HTMLElement).id ? '#' + (el as HTMLElement).id : '')],
    });

    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]';
    const focusables = Array.from(document.querySelectorAll(FOCUSABLE)) as HTMLElement[];

    // positive-tabindex: any tabindex greater than zero distorts the natural order.
    for (const el of focusables) {
      const ti = parseInt(el.getAttribute('tabindex') ?? '', 10);
      if (Number.isFinite(ti) && ti > 0) out['positive-tabindex'].push(node(el));
    }

    // keyboard-trap: an inline keydown handler that swallows Tab cannot be escaped.
    for (const el of focusables) {
      const kd = (el.getAttribute('onkeydown') ?? '').toLowerCase();
      if (/preventdefault/.test(kd) && /tab|keycode\s*[=<>!]*\s*9|key\s*[=<>!]*\s*['"]?tab/.test(kd)) {
        out['keyboard-trap'].push(node(el));
      }
    }

    // missing-skip-link: a navigation-heavy page needs a bypass mechanism.
    const hasNav = !!document.querySelector('nav, [role="navigation"]');
    const linkCount = document.querySelectorAll('a[href]').length;
    const hasSkip = Array.from(document.querySelectorAll('a[href^="#"]')).some((a) =>
      /skip/.test((a.textContent ?? '').toLowerCase())
    );
    if (!hasSkip && (hasNav || linkCount >= 5)) {
      out['missing-skip-link'].push({ html: '<body>', target: ['body'] });
    }

    // Expected tab order via the tabbable oracle (module-scope import; available
    // under the happy-dom test harness which runs this callback in Node).
    let expected: HTMLElement[] = [];
    try {
      try {
        expected = tabbable(document.body, { displayCheck: 'full' }) as HTMLElement[];
        if (!expected.length) {
          expected = tabbable(document.body, { displayCheck: 'none' }) as HTMLElement[];
        }
      } catch {
        expected = tabbable(document.body, { displayCheck: 'none' }) as HTMLElement[];
      }
    } catch {
      expected = [];
    }

    if (expected.length) {
      // focus-order-mismatch: tabbable order diverges from DOM source order.
      const orderIndex = new Map<Element, number>();
      Array.from(document.querySelectorAll('*')).forEach((el, i) => orderIndex.set(el, i));
      const sourceOrder = [...expected].sort(
        (a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0)
      );
      for (let i = 0; i < expected.length; i++) {
        if (expected[i] !== sourceOrder[i]) out['focus-order-mismatch'].push(node(expected[i]));
      }

      const isSkip = (el: Element): boolean =>
        el.tagName === 'A' && /skip/.test((el.textContent ?? '').toLowerCase());

      for (const el of expected) {
        const rect = el.getBoundingClientRect();
        // offscreen-focus: a real tab stop sitting entirely off the viewport.
        // Skip links are intentionally off-screen until focused, so exclude them.
        if (!isSkip(el)) {
          const off =
            rect.right < 0 ||
            rect.bottom < 0 ||
            rect.left > window.innerWidth ||
            rect.top > window.innerHeight;
          if (off) out['offscreen-focus'].push(node(el));
        }
        // focus-not-visible: focusable element with no outline/box-shadow on focus.
        if (rect.width === 0 || rect.height === 0) continue;
        try {
          el.focus({ preventScroll: true });
        } catch {
          continue;
        }
        if (document.activeElement !== el) continue;
        const s = window.getComputedStyle(el);
        const hasOutline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth || '0') > 0;
        const hasBoxShadow = s.boxShadow !== 'none' && s.boxShadow !== '';
        if (!hasOutline && !hasBoxShadow) out['focus-not-visible'].push(node(el));
      }
    }

    return out;
  });

  const META: Record<
    string,
    {
      impact: CustomCheckResult['impact'];
      description: string;
      help: string;
      helpUrl: string;
      tags: string[];
    }
  > = {
    'focus-order-mismatch': {
      impact: 'serious',
      description: 'The keyboard tab order does not match the logical reading / DOM order.',
      help: 'Avoid positive tabindex values; order content so the DOM sequence matches the visual reading order.',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html',
      tags: ['wcag2a', 'wcag243'],
    },
    'keyboard-trap': {
      impact: 'critical',
      description: 'Keyboard focus can become trapped because a key handler prevents Tab from moving focus away.',
      help: 'Do not preventDefault on Tab; ensure users can move focus away from every component with the keyboard.',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html',
      tags: ['wcag2a', 'wcag212'],
    },
    'offscreen-focus': {
      impact: 'serious',
      description: 'A keyboard tab stop is positioned entirely off-screen, so focus appears to vanish.',
      help: 'Remove off-screen elements from the tab order, or bring them on-screen when they receive focus.',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html',
      tags: ['wcag2a', 'wcag211'],
    },
    'positive-tabindex': {
      impact: 'moderate',
      description: 'A positive tabindex value overrides the natural tab order and is error-prone.',
      help: 'Use tabindex="0" or rely on DOM order instead of positive tabindex values.',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html',
      tags: ['wcag2a', 'wcag243'],
    },
    'missing-skip-link': {
      impact: 'moderate',
      description: 'A navigation-heavy page provides no skip link to bypass repeated blocks of content.',
      help: 'Add a "Skip to main content" link as the first focusable element on the page.',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html',
      tags: ['wcag2a', 'wcag241'],
    },
    'focus-not-visible': {
      impact: 'serious',
      description: 'A keyboard-focusable element shows no visible focus indicator when focused.',
      help: 'Provide a visible focus indicator (outline or box-shadow) for every focusable element.',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html',
      tags: ['wcag2aa', 'wcag247'],
    },
  };

  const results: CustomCheckResult[] = [];
  for (const id of Object.keys(META)) {
    const nodes = findings[id];
    if (nodes && nodes.length) {
      results.push({ id, ...META[id], nodes });
    }
  }
  return results.length ? results : null;
}

/**
 * 4.1.2 Name, Role, Value: a control's accessible name must be human-readable
 * and must not leak developer / internal identifiers (for example
 * "InsertButton_label", a GUID, or an underscore-delimited control id). This is
 * the audit's heaviest WCAG criterion, so it gets a dedicated probe.
 */
async function checkAccessibleNameLeak(page: Page): Promise<CustomCheckResult | null> {
  const nodes = await page.evaluate(() => {
    const results: { html: string; target: string[] }[] = [];
    const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const leaky = (raw: string): boolean => {
      const name = raw.trim();
      if (!name) return false;
      if (/_label\b/i.test(name)) return true;
      if (GUID.test(name)) return true;
      // A single whitespace-free token containing an underscore is an internal id.
      if (!/\s/.test(name) && /[A-Za-z0-9]_[A-Za-z0-9]/.test(name)) return true;
      return false;
    };
    const accName = (el: Element): string => {
      const aria = el.getAttribute('aria-label');
      if (aria) return aria;
      const labelledby = el.getAttribute('aria-labelledby');
      if (labelledby) {
        const txt = labelledby
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
        if (txt) return txt;
      }
      const id = el.getAttribute('id');
      if (id) {
        try {
          const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (lbl?.textContent?.trim()) return lbl.textContent;
        } catch {
          // invalid selector or missing CSS API: ignore and fall through
        }
      }
      const wrapping = el.closest('label');
      if (wrapping?.textContent?.trim()) return wrapping.textContent;
      const alt = el.getAttribute('alt');
      if (alt) return alt;
      const title = el.getAttribute('title');
      if (title) return title;
      return el.textContent ?? '';
    };

    const controls = Array.from(
      document.querySelectorAll(
        'a[href], button, input, select, textarea, [role="button"], [role="link"], [tabindex]'
      )
    );
    for (const el of controls) {
      if (leaky(accName(el))) {
        results.push({
          html: (el as HTMLElement).outerHTML.slice(0, 300),
          target: [el.tagName.toLowerCase() + ((el as HTMLElement).id ? '#' + (el as HTMLElement).id : '')],
        });
      }
    }
    return results;
  });
  if (!nodes.length) return null;
  return {
    id: 'accessible-name-leak',
    impact: 'serious',
    description:
      'A control\u2019s accessible name leaks a developer or internal identifier instead of human-readable text.',
    help: 'Provide a clear, human-readable accessible name; do not expose control ids, GUIDs, or "*_label" tokens.',
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
    tags: ['wcag2a', 'wcag412'],
    nodes,
  };
}

/**
 * 2.4.6 Headings and Labels: headings must be descriptive and useful. Flags
 * repeated heading text and ARIA headings (role="heading") that omit a semantic
 * level. Unique, well-levelled headings pass.
 */
async function checkDuplicateHeading(page: Page): Promise<CustomCheckResult | null> {
  const nodes = await page.evaluate(() => {
    const results: { html: string; target: string[] }[] = [];
    const node = (el: Element) => ({
      html: (el as HTMLElement).outerHTML.slice(0, 300),
      target: [el.tagName.toLowerCase() + ((el as HTMLElement).id ? '#' + (el as HTMLElement).id : '')],
    });
    const headings = Array.from(
      document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')
    );
    const seen = new Set<string>();
    for (const h of headings) {
      // missing semantic level on an ARIA heading
      if (h.getAttribute('role') === 'heading' && !h.getAttribute('aria-level')) {
        results.push(node(h));
        continue;
      }
      const text = (h.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!text) continue;
      if (seen.has(text)) {
        results.push(node(h));
      } else {
        seen.add(text);
      }
    }
    return results;
  });
  if (!nodes.length) return null;
  return {
    id: 'duplicate-heading',
    impact: 'moderate',
    description:
      'Headings should be descriptive and not repeat the same text, and ARIA headings must declare a level.',
    help: 'Use unique, descriptive heading text and give role="heading" elements an aria-level.',
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html',
    tags: ['wcag2aa', 'wcag246'],
    nodes,
  };
}

/**
 * Run all custom Playwright-based accessibility checks on a page.
 * Each check is independently wrapped in try/catch for resilience.
 */
/**
 * OCR probe: detects "images of text" (WCAG 1.4.5) and low-contrast rendered text
 * (WCAG 1.4.3) by screenshotting suspect visual regions and running them through
 * Tesseract.js.
 *
 * Performance / worker lifecycle (D.3):
 *  - A SINGLE Tesseract worker is created lazily, only AFTER at least one suspect
 *    region is found, and is REUSED across every region on the page.
 *  - The worker is always torn down in the `finally` block (even on error), so a
 *    failed `recognize()` never leaks a native worker/process.
 *  - Region count is capped by MAX_REGIONS. Worst-case latency for the probe is
 *    roughly `regions * recognize_latency`; the cap keeps a single page well
 *    within the weekly scan time budget even on text-heavy marketing pages.
 *  - A per-page worker (vs. a cross-page singleton) is chosen deliberately: the
 *    scanner orchestration exposes no end-of-run teardown hook, so binding the
 *    worker lifetime to this function guarantees cleanup.
 *  - On ANY failure (missing language data, screenshot failure, decode failure)
 *    the probe degrades gracefully — it emits whatever it gathered, or null.
 */
async function checkImageOfText(page: Page): Promise<CustomCheckResult[] | null> {
  const MAX_REGIONS = 12;

  // Step 1 (in-page): tag and collect suspect regions. Runs entirely in the
  // browser and returns only serializable descriptors.
  const regions = (await page.evaluate((max: number) => {
    const out: {
      selector: string;
      regionType: 'img' | 'canvas' | 'background';
      html: string;
      target: string[];
    }[] = [];

    const visible = (el: Element, minW: number, minH: number): boolean => {
      const rect = el.getBoundingClientRect();
      if (rect.width < minW || rect.height < minH) return false;
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (parseFloat(cs.opacity || '1') <= 0) return false;
      return true;
    };

    const sentenceLike = (text: string): boolean => {
      const t = (text || '').trim();
      if (!t) return false;
      const words = t.split(/\s+/).filter(Boolean);
      return words.length >= 4 || (t.length >= 25 && /\s/.test(t));
    };

    const target = (el: Element): string[] => [
      el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''),
    ];
    const snippet = (el: Element): string => el.outerHTML.slice(0, 300);

    let idx = 0;
    const claim = (el: Element, regionType: 'img' | 'canvas' | 'background') => {
      if (out.length >= max) return;
      if (el.hasAttribute('data-a11y-ocr')) return;
      el.setAttribute('data-a11y-ocr', String(idx));
      out.push({
        selector: `[data-a11y-ocr="${idx}"]`,
        regionType,
        html: snippet(el),
        target: target(el),
      });
      idx++;
    };

    // (a) <img> whose alt text reads like a sentence — a classic image-of-text smell.
    for (const img of Array.from(document.querySelectorAll('img'))) {
      if (out.length >= max) break;
      if (!sentenceLike(img.getAttribute('alt') || '')) continue;
      if (!visible(img, 8, 8)) continue;
      claim(img, 'img');
    }

    // (b) <canvas> — text is commonly painted onto canvases.
    for (const canvas of Array.from(document.querySelectorAll('canvas'))) {
      if (out.length >= max) break;
      if (!visible(canvas, 8, 8)) continue;
      claim(canvas, 'canvas');
    }

    // (c) Elements with a CSS background-image large enough to plausibly carry text.
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      if (out.length >= max) break;
      if (el.hasAttribute('data-a11y-ocr')) continue;
      const bg = window.getComputedStyle(el).backgroundImage || '';
      if (!bg.includes('url(')) continue;
      if (!visible(el, 60, 20)) continue;
      claim(el, 'background');
    }

    return out;
  }, MAX_REGIONS)) ?? [];

  // Guard BEFORE any worker/screenshot work: no suspect regions => no OCR at all.
  if (!Array.isArray(regions) || regions.length === 0) {
    return null;
  }

  // Minimal structural shapes for the Tesseract.js v7 result (no flat data.words;
  // words live under blocks[].paragraphs[].lines[].words[] and require {blocks:true}).
  interface OcrBbox { x0: number; y0: number; x1: number; y1: number }
  interface OcrWordRaw { text: string; confidence: number; bbox: OcrBbox }
  interface OcrPage {
    blocks?:
      | {
          paragraphs?:
            | { lines?: { words?: OcrWordRaw[] }[] }[]
            | null;
        }[]
      | null;
  }
  interface OcrWorkerLike {
    recognize(
      image: Buffer,
      options?: unknown,
      output?: unknown,
    ): Promise<{ data: OcrPage }>;
    terminate(): Promise<void>;
  }

  const extractWords = (data: OcrPage): OcrWordRaw[] => {
    const words: OcrWordRaw[] = [];
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const line of para.lines ?? []) {
          for (const w of line.words ?? []) {
            words.push(w);
          }
        }
      }
    }
    return words;
  };

  const perceptualLum = (r: number, g: number, b: number): number =>
    0.2126 * r + 0.7152 * g + 0.0722 * b;

  const imageOfTextNodes: CustomCheckResult['nodes'] = [];
  const contrastNodes: CustomCheckResult['nodes'] = [];
  let worker: OcrWorkerLike | null = null;

  try {
    const tesseract = await import('tesseract.js');
    const { PNG } = await import('pngjs');
    const wcag = await import('wcag-contrast');

    const langPath =
      process.env.TESSERACT_LANG_PATH ?? path.join(process.cwd(), 'tessdata');

    // Single, reused worker for every region on this page.
    worker = (await tesseract.createWorker('eng', 1, {
      langPath,
      cachePath: langPath,
      gzip: true,
      cacheMethod: 'none',
    })) as unknown as OcrWorkerLike;

    for (const region of regions) {
      const handle = await page.$(region.selector);
      if (!handle) continue;

      let buf: Buffer;
      try {
        buf = (await handle.screenshot({ type: 'png' })) as Buffer;
      } catch {
        continue; // screenshot failed (detached / zero-size) — skip region
      }

      let recognized: { data: OcrPage };
      try {
        recognized = await worker.recognize(buf, {}, { blocks: true });
      } catch {
        continue; // OCR failed for this region — skip
      }

      const words = extractWords(recognized.data).filter(
        (w) => w.confidence >= 70 && /[A-Za-z]{2,}/.test(w.text || ''),
      );
      if (words.length === 0) continue;

      // Confident, word-like text recovered from a visual => image-of-text.
      imageOfTextNodes.push({ html: region.html, target: region.target });

      // Sample the decoded text pixels to estimate rendered text contrast.
      let png: { width: number; height: number; data: Buffer } | null;
      try {
        png = PNG.sync.read(buf) as {
          width: number;
          height: number;
          data: Buffer;
        };
      } catch {
        png = null;
      }
      if (!png) continue;

      let worstRatio = Number.POSITIVE_INFINITY;
      let worstLarge = false;
      let anyFail = false;

      for (const w of words) {
        const x0 = Math.max(0, Math.floor(w.bbox.x0));
        const y0 = Math.max(0, Math.floor(w.bbox.y0));
        const x1 = Math.min(png.width, Math.ceil(w.bbox.x1));
        const y1 = Math.min(png.height, Math.ceil(w.bbox.y1));
        if (x1 <= x0 || y1 <= y0) continue;

        const pixels: [number, number, number][] = [];
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * png.width + x) * 4;
            const a = png.data[i + 3];
            if (a < 16) continue; // skip transparent
            pixels.push([png.data[i], png.data[i + 1], png.data[i + 2]]);
          }
        }
        if (pixels.length < 16) continue;

        const lums = pixels
          .map((p) => perceptualLum(p[0], p[1], p[2]))
          .sort((a, b) => a - b);
        const median = lums[Math.floor(lums.length / 2)];

        const dark: [number, number, number][] = [];
        const light: [number, number, number][] = [];
        for (const p of pixels) {
          if (perceptualLum(p[0], p[1], p[2]) <= median) dark.push(p);
          else light.push(p);
        }
        if (dark.length === 0 || light.length === 0) continue;

        const mean = (group: [number, number, number][]): number[] => {
          const sum = group.reduce(
            (acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]],
            [0, 0, 0],
          );
          return [
            Math.round(sum[0] / group.length),
            Math.round(sum[1] / group.length),
            Math.round(sum[2] / group.length),
          ];
        };

        const ratio = wcag.rgb(mean(dark), mean(light));
        const isLarge = w.bbox.y1 - w.bbox.y0 >= 24;
        const threshold = isLarge ? 3.0 : 4.5;
        if (ratio < threshold) {
          anyFail = true;
          if (ratio < worstRatio) {
            worstRatio = ratio;
            worstLarge = isLarge;
          }
        }
      }

      if (anyFail) {
        const detail =
          `<div data-region="${region.regionType}" ` +
          `data-contrast-ratio="${worstRatio.toFixed(2)}" ` +
          `data-large-text="${worstLarge}">${region.html}</div>`;
        contrastNodes.push({
          html: detail.slice(0, 300),
          target: region.target,
        });
      }
    }
  } catch {
    // Graceful degradation: emit whatever was gathered before the failure.
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        // ignore teardown errors
      }
    }
    try {
      await page.evaluate(() => {
        document
          .querySelectorAll('[data-a11y-ocr]')
          .forEach((el) => el.removeAttribute('data-a11y-ocr'));
      });
    } catch {
      // ignore cleanup errors
    }
  }

  const results: CustomCheckResult[] = [];
  if (imageOfTextNodes.length > 0) {
    results.push({
      id: 'image-of-text',
      impact: 'serious',
      description:
        'Visual regions appear to contain text baked into an image, canvas, or background rather than real, selectable text.',
      help: 'Use actual text styled with CSS instead of images of text. Images of text cannot be resized, recolored, translated, or read reliably by assistive technology.',
      helpUrl:
        'https://www.w3.org/WAI/WCAG22/Understanding/images-of-text.html',
      tags: ['wcag2aa', 'wcag145'],
      kind: 'review',
      nodes: imageOfTextNodes,
    });
  }
  if (contrastNodes.length > 0) {
    results.push({
      id: 'rendered-text-contrast',
      impact: 'serious',
      description:
        'Text rendered into an image or canvas appears to fall below the WCAG AA contrast minimum.',
      help: 'Ensure text contrast is at least 4.5:1 (3:1 for large text). Prefer real text over baked-in text so contrast can be verified and adjusted.',
      helpUrl:
        'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html',
      tags: ['wcag2aa', 'wcag143'],
      kind: 'review',
      nodes: contrastNodes,
    });
  }
  return results.length > 0 ? results : null;
}

/**
 * WCAG 1.1.1 (Non-text Content) — meaningful image with no accessible name.
 *
 * Closes a gap left by axe-core's `image-alt`, which treats `alt=""` as a valid
 * (decorative) author declaration and never flags it. An informative image that
 * is deliberately given an EMPTY alt is silently dropped from the accessibility
 * tree, so a screen reader user loses the meaning entirely. This probe flags a
 * visible, meaningfully-sized image (or one inside a link/button) that carries
 * NO accessible name — distinguishing a truly missing `alt` from an empty
 * `alt=""` so reviewers can tell remediation apart. Decorative signals
 * (role=presentation/none, aria-hidden, spacer/pixel/tracking src patterns, and
 * sub-24px images outside links) are excluded to keep noise down.
 *
 * Tagged kind: 'review' because "conveys meaning" is a human judgement; the
 * probe surfaces the candidate, a person confirms.
 */
async function checkImageMeaningfulMissingAlt(
  page: Page,
): Promise<CustomCheckResult | null> {
  const nodes = await page.evaluate(() => {
    const DECORATIVE_SRC =
      /(spacer|pixel|blank|transparent|1x1|shim|dot|clear|tracking|beacon)\b/i;
    const out: { html: string; target: string[] }[] = [];
    const imgs = Array.from(
      document.querySelectorAll<HTMLElement>('img, input[type="image"]'),
    );
    for (const el of imgs) {
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (parseFloat(cs.opacity || '1') <= 0) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      const role = (el.getAttribute('role') || '').toLowerCase();
      if (role === 'presentation' || role === 'none') continue;
      const rect = el.getBoundingClientRect();
      const inLink = !!el.closest('a[href], button');
      const bigEnough = rect.width >= 24 && rect.height >= 24;
      if (!bigEnough && !inLink) continue;
      const src = el.getAttribute('src') || '';
      if (DECORATIVE_SRC.test(src)) continue;
      const altAttr = el.getAttribute('alt');
      const hasName =
        (altAttr != null && altAttr.trim() !== '') ||
        (el.getAttribute('aria-label') || '').trim() !== '' ||
        !!el.getAttribute('aria-labelledby') ||
        (el.getAttribute('title') || '').trim() !== '';
      if (hasName) continue;
      const kind = altAttr == null ? 'missing alt attribute' : 'empty alt=""';
      const selector =
        el.tagName.toLowerCase() +
        (el.id ? '#' + el.id : src ? `[src="${src}"]` : '');
      out.push({
        html: `<!-- ${kind} --> ${el.outerHTML.slice(0, 240)}`,
        target: [selector],
      });
    }
    return out;
  });

  if (!nodes || nodes.length === 0) return null;
  return {
    id: 'meaningful-image-missing-alt',
    impact: 'serious',
    description:
      'A visible, meaningful image has no accessible name (missing or empty alt). ' +
      'Screen reader users cannot perceive the information it conveys.',
    help: 'Give informative images a descriptive alt; only use alt="" for purely decorative images.',
    helpUrl:
      'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
    tags: ['wcag2a', 'wcag111'],
    kind: 'review',
    nodes,
  };
}

/**
 * Configuration for {@link checkUndeclaredLanguage}. All fields are optional so
 * the probe keeps working with its English/French defaults when called with no
 * config (e.g. from {@link runCustomChecks}).
 */
interface UndeclaredLanguageConfig {
  /**
   * Declared language to assume when neither the text run nor `<html>` carries a
   * `lang` attribute. Lets a site whose default language is not English avoid
   * false positives without overloading the WCAG 3.1.1 (document language) gate.
   */
  pageLangFallback?: string;
  /**
   * Restrict detector-driven flagging to these ISO 639-1 languages (e.g.
   * `['fr', 'es']`). When undefined, any detected language that disagrees with
   * the declared language is eligible to flag.
   */
  targets?: string[];
  /** Minimum trimmed run length to consider. Default 12. */
  minLen?: number;
  /** Minimum detector confidence (0-1) to flag a disagreement. Default 0.5. */
  confidence?: number;
}

/**
 * Language of the diacritic class (DIA) below. The accented-word heuristic is a
 * deliberately French-specific safety net: statistical detectors are unreliable
 * on very short labels (e.g. "Numéro de référence"), so two or more separately
 * accented words flag as this language regardless of detector confidence. See
 * the repo accessibility-pipeline notes (DD-03 / ID-06) — this OR-branch must
 * stay independent so no short FR-under-EN label is ever lost.
 */
const DIACRITIC_LANG = 'fr';

const UNDECLARED_LANG_NAMES: Record<string, string> = {
  fr: 'French',
  en: 'English',
  es: 'Spanish',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
};

function undeclaredLangLabel(code: string): string {
  return UNDECLARED_LANG_NAMES[code] || code.toUpperCase();
}

/**
 * WCAG 3.1.2 (Language of Parts) — a foreign-language run not declared with lang.
 *
 * axe-core's `valid-lang` only validates the VALUE of a lang attribute that is
 * already present; it has no signal for a passage whose language differs from
 * the surrounding declared language (French under an English page, English under
 * a French page, Spanish under either) with no matching `lang` ancestor. This
 * probe walks the visible text runs, returns each candidate run with its nearest
 * declared language, then runs a statistical detector (tinyld) in Node and flags
 * any run whose detected language disagrees with the effective declared language
 * above a confidence threshold.
 *
 * Direction-agnostic and language-agnostic via {@link UndeclaredLanguageConfig}.
 * A cheap diacritic/length pre-filter decides which runs are worth detecting,
 * and an INDEPENDENT accented-word heuristic (plus the original French lexicon)
 * still flags short accented French labels that statistical detectors miss.
 * Tagged kind: 'review' because language identification is heuristic.
 */
async function checkUndeclaredLanguage(
  page: Page,
  config: UndeclaredLanguageConfig = {},
): Promise<CustomCheckResult | null> {
  const minLen = config.minLen ?? 12;
  const confidence = config.confidence ?? 0.5;
  const targets = config.targets;
  const pageLangFallback = (config.pageLangFallback ?? '').toLowerCase();

  // The DOM walk only collects candidate runs + their effective declared
  // language; statistical detection runs Node-side below (tinyld trigram data
  // does not serialize into the page context).
  const candidates = await page.evaluate(
    (opts: { minLen: number; pageLangFallback: string }) => {
      const FR_WORDS = new Set([
        'vous','pour','avec','veuillez','votre','vos','être','sont','dans','les',
        'des','une','aux','connexion','déposer','ministère','courriel','demande',
        'sélectionner','obligatoire','obligatoires','soumettre','remplir','champs',
        'appel','continuer','procureur','général','nous','êtes','sera','sans',
        // Diacritic-bearing French tokens (cannot collide with English words, so
        // they are safe to match on a single hit alongside the DIA gate).
        'numéro','référence','municipalité','emplacement','propriété','visée',
        'paiement','référencé','déposé','téléverser','téléversé','propriétés',
      ]);
      const DIA = /[àâäçéèêëîïôöûùüÿœæ]/i;
      const pageLang = (
        document.documentElement.getAttribute('lang') || ''
      ).toLowerCase();
      const out: {
        text: string;
        target: string[];
        effective: string;
        accentedWords: number;
        frHits: number;
        hasDia: boolean;
      }[] = [];
      const seen = new Set<Element>();
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = (node.nodeValue || '').trim();
        if (text.length < opts.minLen) continue;
        const owner = (node as Text).parentElement;
        if (!owner) continue;
        const ownerTag = owner.tagName;
        if (ownerTag === 'SCRIPT' || ownerTag === 'STYLE') continue;
        const cs = window.getComputedStyle(owner);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        // Unicode-aware tokenizer so non-French accented scripts stay intact.
        const words = text.toLowerCase().match(/[\p{L}']+/gu) || [];
        const accentedWords = words.filter((w) => DIA.test(w)).length;
        const frHits = words.filter((w) => FR_WORDS.has(w)).length;
        // Cheap diacritic/length pre-filter: only runs with an accented word or
        // at least four words are worth detecting (statistical detectors are
        // unreliable on 1-3 word non-accented fragments).
        if (accentedWords < 1 && words.length < 4) continue;
        let el: Element | null = owner;
        let langOwner: string | null = null;
        while (el) {
          const l = el.getAttribute('lang') || el.getAttribute('xml:lang');
          if (l) {
            langOwner = l.toLowerCase();
            break;
          }
          el = el.parentElement;
        }
        const effective = (
          langOwner || pageLang || opts.pageLangFallback || ''
        ).toLowerCase();
        if (seen.has(owner)) continue;
        seen.add(owner);
        const selector =
          owner.tagName.toLowerCase() + (owner.id ? '#' + owner.id : '');
        out.push({
          text: text.slice(0, 400),
          target: [selector],
          effective,
          accentedWords,
          frHits,
          hasDia: DIA.test(text),
        });
        if (out.length >= 150) break;
      }
      return out;
    },
    { minLen, pageLangFallback },
  );

  if (!candidates || candidates.length === 0) return null;

  const nodes: { html: string; target: string[] }[] = [];
  const detectedLangs = new Set<string>();
  for (const c of candidates) {
    const eff = c.effective;
    // Independent French diacritic safety net (DD-03): preserved exactly from
    // the original probe so no FR-under-EN short-label flag is ever lost. The
    // !startsWith(DIACRITIC_LANG) guard is intrinsic to the French DIA class,
    // not the general detection target (which is now the detector below).
    const accentFlag = c.accentedWords >= 2 && !eff.startsWith(DIACRITIC_LANG);
    const lexiconFlag =
      ((c.hasDia && c.frHits >= 1) || c.frHits >= 2) &&
      !eff.startsWith(DIACRITIC_LANG);

    // General, direction-agnostic detection: flag when the detected language
    // disagrees with the declared language at or above the confidence floor.
    let detectFlag = false;
    let detectedLang = '';
    if (eff) {
      const ranked = detectAll(c.text);
      const top = ranked && ranked[0];
      if (top && top.accuracy >= confidence) {
        const lang = top.lang.toLowerCase();
        const inTargets = !targets || targets.includes(lang);
        if (inTargets && lang && !eff.startsWith(lang)) {
          detectFlag = true;
          detectedLang = lang;
        }
      }
    }

    if (!detectFlag && !accentFlag && !lexiconFlag) continue;
    const lang = detectedLang || DIACRITIC_LANG;
    detectedLangs.add(lang);
    nodes.push({
      html:
        `<!-- ${undeclaredLangLabel(lang)} text not declared lang="${lang}" -->\n` +
        c.text.slice(0, 120),
      target: c.target,
    });
    if (nodes.length >= 25) break;
  }

  if (nodes.length === 0) return null;

  const langLabels = [...detectedLangs].map(undeclaredLangLabel);
  const langPhrase =
    langLabels.length === 1
      ? langLabels[0]
      : langLabels.slice(0, -1).join(', ') +
        ' or ' +
        langLabels[langLabels.length - 1];
  const exampleLang = [...detectedLangs][0] || DIACRITIC_LANG;
  return {
    id: 'undeclared-language',
    impact: 'moderate',
    description:
      `A passage that appears to be in ${langPhrase} is not declared with a matching ` +
      'lang attribute, so assistive technology may pronounce it using the wrong language.',
    help: `Mark foreign-language passages with the matching lang attribute (e.g. lang="${exampleLang}").`,
    helpUrl:
      'https://www.w3.org/WAI/WCAG22/Understanding/language-of-parts.html',
    tags: ['wcag2aa', 'wcag312'],
    kind: 'review',
    nodes,
  };
}

export async function runCustomChecks(page: Page): Promise<CustomCheckResult[]> {
  const checks: Array<
    (page: Page) => Promise<CustomCheckResult | CustomCheckResult[] | null>
  > = [
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
    checkTabOrder,
    checkAccessibleNameLeak,
    checkDuplicateHeading,
    checkImageOfText,
    checkImageMeaningfulMissingAlt,
    checkUndeclaredLanguage,
  ];
  const results: CustomCheckResult[] = [];
  for (const check of checks) {
    try {
      const result = await check(page);
      const items = Array.isArray(result) ? result : result ? [result] : [];
      for (const item of items) {
        if (item.nodes.length > 0) {
          results.push(item);
        }
      }
    } catch {
      // Individual check failures should not block other checks
    }
  }
  return results;
}

// Exported for testing
export {
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
  checkTabOrder,
  checkAccessibleNameLeak,
  checkDuplicateHeading,
  checkImageOfText,
  checkImageMeaningfulMissingAlt,
  checkUndeclaredLanguage,
  AMBIGUOUS_LINK_TEXTS,
};
