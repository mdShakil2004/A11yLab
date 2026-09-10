import { chromium, type BrowserContext, type Page, type FrameLocator } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getCompliance } from 'accessibility-checker';
import type { MultiEngineResults, ScanState, ScanAction } from '../types/scan';
import { normalizeAndMerge, mergeAcrossStates, type IbmReportResult, type AlfaRawOutcome } from './result-normalizer';
import { runCustomChecks } from './custom-checks';
import { createLogger } from '../logger';

const log = createLogger('scanner:engine');

// How many times to (re)drive the page into a named deep-crawl state before
// giving up on it for the run. Portal modals (e.g. the OLT /en/parties/ Add
// Party dialog) occasionally fail to open on the first attempt — the trigger's
// click handler isn't bound yet, or the same-origin form iframe renders a beat
// late — which used to drop ~50 in-modal findings and masquerade as a fix in
// the issue-count trend. A small bounded retry (with a clean re-navigation
// between attempts) absorbs that flake while still surrendering gracefully on a
// genuinely stale recipe. Bumped to 5: the async entity-lookup grid on
// /en/submit/ occasionally exceeds the wait budget on a given attempt, and the
// extra fresh re-navigations materially cut the residual flake seen in CI.
const STATE_APPLY_ATTEMPTS = 5;

// Lazily read the raw axe-core source from disk on first use.
// We cannot use axe.source because webpack/turbopack mangles the bundled
// axeFunction.toString(), producing a broken single-line script.
// We cannot use require.resolve because webpack transforms it into a
// numeric module ID even inside serverExternalPackages.
let _safeAxeSource: string | null = null;
function getSafeAxeSource(): string {
  if (!_safeAxeSource) {
    // Try common locations for axe-core in standalone and dev modes
    const candidates = [
      join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js'),
      join(__dirname, '..', '..', '..', 'node_modules', 'axe-core', 'axe.min.js'),
    ];
    const axeCorePath = candidates.find(p => existsSync(p));
    if (!axeCorePath) {
      throw new Error(`axe-core not found. Searched: ${candidates.join(', ')}`);
    }
    const rawAxeSource = readFileSync(axeCorePath, 'utf-8');
    _safeAxeSource = `(function(module, exports){${rawAxeSource}})(undefined, undefined);`;
  }
  return _safeAxeSource;
}

/**
 * Scan an already-navigated Playwright Page with axe-core only.
 * Used by the crawler where the crawler manages browser lifecycle and speed matters.
 * When includeSelector is provided, the scan is scoped to that subtree (used
 * for state scans of revealed content such as dialogs). When omitted, the full
 * document is scanned exactly as before.
 */
export async function scanPage(
  page: Page,
  includeSelector?: string,
): Promise<import('axe-core').AxeResults> {
  const builder = new AxeBuilder({ page, axeSource: getSafeAxeSource() })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa', 'best-practice'])
    .options({
      rules: {
        'p-as-heading': { enabled: true },
        'link-in-text-block': { enabled: true },
        'css-orientation-lock': { enabled: true },
      },
    });
  if (includeSelector) {
    builder.include(includeSelector);
  }
  return builder.analyze();
}

/**
 * Apply an ordered sequence of deterministic, data-only actions to drive a page
 * into a target UI state before scanning. Waiting is always selector-based
 * (waitForSelector) rather than a fixed timeout so scans stay deterministic.
 *
 * Frame context: a `{ frame: <selector chain> }` action activates a same-origin
 * iframe via Playwright's FrameLocator; every subsequent click/waitFor/fill then
 * resolves INSIDE that iframe (via frame.locator(...)) until another `{ frame }`
 * action changes it. `{ frame: '' }` resets back to the main frame. `press`
 * always uses the page-level keyboard, which routes to whatever element is
 * focused — including in-frame elements interacted with just before. Existing
 * main-frame recipes (no `frame` action) keep using page.* and are unchanged.
 */
export async function applyActions(page: Page, actions: ScanAction[]): Promise<void> {
  // null = main frame (page.* APIs); non-null = active same-origin iframe.
  let frame: FrameLocator | null = null;
  for (const action of actions) {
    if ('frame' in action) {
      frame = action.frame ? page.frameLocator(action.frame) : null;
    } else if ('click' in action) {
      if (frame) await frame.locator(action.click).click();
      else await page.click(action.click);
    } else if ('waitFor' in action) {
      if (frame) await frame.locator(action.waitFor).waitFor();
      else await page.waitForSelector(action.waitFor);
    } else if ('fill' in action) {
      if (frame) await frame.locator(action.fill.selector).fill(action.fill.value);
      else await page.fill(action.fill.selector, action.fill.value);
    } else if ('press' in action) {
      await page.keyboard.press(action.press);
    }
  }
}

/**
 * Run IBM Equal Access scan in an isolated page to prevent its ACE engine
 * injection from corrupting the main page's JS context.
 */
async function runIbmScan(
  context: BrowserContext,
  url: string,
  actions?: ScanAction[],
): Promise<IbmReportResult[]> {
  let ibmPage: Page | null = null;
  try {
    ibmPage = await context.newPage();
    await ibmPage.goto(url, { waitUntil: 'load', timeout: 30000 }).catch(() =>
      ibmPage!.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {})
    );
    // Reproduce the target state in IBM's isolated page so its scan matches the
    // state-applied DOM. Action failures must not crash the IBM scan.
    if (actions?.length) {
      await applyActions(ibmPage, actions).catch(() => {});
    }
    const result = await getCompliance(ibmPage, url);
    if (result && 'report' in result && result.report && 'results' in result.report) {
      return (result.report.results as IbmReportResult[]) ?? [];
    }
    return [];
  } catch {
    // Graceful degradation — IBM scan failure must not crash the entire scan
    return [];
  } finally {
    await ibmPage?.close().catch(() => {});
  }
}

/**
 * Coerce Alfa's outcome representation (enum value, string, or wrapped object)
 * into the flat union the normalizer understands. Defensive against version
 * drift in how @siteimprove/alfa-act spells its Outcome values.
 */
function coerceAlfaOutcome(value: unknown): AlfaRawOutcome['outcome'] {
  const s = String(value).toLowerCase();
  if (s.includes('fail')) return 'failed';
  if (s.includes('cant')) return 'cantTell';
  if (s.includes('pass')) return 'passed';
  return 'inapplicable';
}

/**
 * Run the Alfa ACT-Rules engine in an isolated page and return a flat,
 * serializable outcome list for the normalizer.
 *
 * SPIKE / GUARDED NO-OP: the @siteimprove/alfa-* packages are declared as
 * optionalDependencies behind GitHub Packages auth, so they may be absent. The
 * dynamic import is wrapped in try/catch and resolves to [] when the packages
 * are not installed (or the audit throws), so the other three engines still
 * produce a full result set. The audit-execution path below is best-effort and
 * MUST be validated/pinned against a resolved package version once a
 * read:packages token is available.
 */
async function runAlfa(
  context: BrowserContext,
  url: string,
  actions?: ScanAction[],
): Promise<AlfaRawOutcome[]> {
  let alfaPage: Page | null = null;
  try {
    // Dynamic import keeps the build green when the packages are unavailable.
    const [{ Audit }, rulesModule, { Playwright }] = await Promise.all([
      import('@siteimprove/alfa-act'),
      import('@siteimprove/alfa-rules'),
      import('@siteimprove/alfa-playwright'),
    ]);

    alfaPage = await context.newPage();
    await alfaPage.goto(url, { waitUntil: 'load', timeout: 30000 }).catch(() =>
      alfaPage!.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {})
    );
    if (actions?.length) {
      await applyActions(alfaPage, actions).catch(() => {});
    }

    const handle = await alfaPage.evaluateHandle(() => document);
    const alfaDocument = await Playwright.toPage(handle);
    const rules = (rulesModule as { default?: unknown }).default ?? rulesModule;
    const outcomes = await Audit.of(alfaDocument, rules).evaluate();

    const out: AlfaRawOutcome[] = [];
    for (const outcome of outcomes) {
      const value = coerceAlfaOutcome(outcome.outcome);
      if (value === 'passed' || value === 'inapplicable') continue;
      const ruleId = outcome.rule?.uri ?? 'alfa-rule';
      out.push({
        ruleId,
        outcome: value,
        impact: 'moderate',
        html: '',
        target: '',
        message: `Alfa ACT-Rules outcome (${value}) for ${ruleId}`,
        helpUrl: ruleId,
        tags: ['best-practice'],
      });
    }
    return out;
  } catch {
    // Alfa not installed or audit failed — degrade to a no-op so axe, IBM, and
    // the custom checks still return a complete result set.
    return [];
  } finally {
    await alfaPage?.close().catch(() => {});
  }
}
async function navigateTo(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  } catch (navError: unknown) {
    if (navError instanceof Error && navError.message.includes('Timeout')) {
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    } else {
      throw navError;
    }
  }
}

/**
 * Run all scan engines. axe-core and custom checks share the main page;
 * IBM Equal Access runs in a separate isolated page to avoid context corruption.
 * When includeSelector is provided, the axe scan is scoped to that subtree.
 */
export async function multiEngineScan(
  page: Page,
  url: string,
  context?: BrowserContext,
  includeSelector?: string,
): Promise<MultiEngineResults> {
  const axeResults = await scanPage(page, includeSelector);
  const customResults = await runCustomChecks(page);

  // IBM scan runs in an isolated page if a context is available
  const ibmResults = context
    ? await runIbmScan(context, url)
    : [];

  // Alfa ACT-Rules runs in its own isolated page; guarded no-op when absent.
  const alfaResults = context
    ? await runAlfa(context, url)
    : [];

  return normalizeAndMerge(axeResults, ibmResults, customResults, alfaResults);
}

/**
 * Scan the default DOM and then each named UI state. Each state is reached by
 * applying its deterministic actions to the live page, after which all three
 * engines are re-run (axe scoped via includeSelector when present) and the
 * findings are tagged with the state name. Findings are merged across states
 * with the default-DOM scan winning on duplicates, so the default-DOM result
 * set is never altered by state scanning.
 */
export async function multiEngineScanWithStates(
  page: Page,
  url: string,
  context: BrowserContext | undefined,
  states: ScanState[],
): Promise<MultiEngineResults> {
  // Default DOM scan first — produces untagged findings.
  const base = await multiEngineScan(page, url, context);

  const stateResults: MultiEngineResults[] = [];
  for (const state of states) {
    // Resilience + flake tolerance: a single malformed/stale state recipe (a
    // selector that no longer exists) must NOT abort the whole URL scan, and a
    // transient miss (portal JS not yet bound to the trigger, a modal iframe
    // that renders a beat late, nav jitter) must NOT permanently drop the
    // state's findings for the run. On the OLT /en/parties/ Add Party modal that
    // silent skip loses ~50 in-modal findings and shows up as a bogus ~-50 swing
    // in the trend. Retry the full action sequence a few times, re-navigating to
    // a clean DOM between attempts so a half-open modal from a failed attempt
    // can't poison the next one. Only log + skip after every attempt fails.
    let applied = false;
    for (let attempt = 1; attempt <= STATE_APPLY_ATTEMPTS; attempt++) {
      try {
        await applyActions(page, state.actions);
        applied = true;
        if (attempt > 1) {
          log.info('state applied after retry', { state: state.name, url, attempt });
        }
        break;
      } catch (err) {
        log.warn('state apply attempt failed', {
          state: state.name,
          url,
          attempt,
          maxAttempts: STATE_APPLY_ATTEMPTS,
          error: err instanceof Error ? err.message : String(err),
        });
        if (attempt < STATE_APPLY_ATTEMPTS) {
          // Reset to a clean DOM before the next attempt. Best-effort: if the
          // re-navigation itself fails, the retry simply starts from wherever
          // the page landed.
          await navigateTo(page, url).catch(() => {});
        }
      }
    }
    if (!applied) {
      log.warn('skipping state: applyActions failed after retries', {
        state: state.name,
        url,
        attempts: STATE_APPLY_ATTEMPTS,
      });
      continue;
    }
    // Let async-loaded state content (e.g. entity-lookup grids fetched via XHR
    // after the modal opens) settle before scanning, so contrast/axe/IBM see
    // the fully rendered DOM. Bounded and best-effort: never block the scan.
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const axeResults = await scanPage(page, state.includeSelector);
    const customResults = await runCustomChecks(page);
    const ibmResults = context ? await runIbmScan(context, url, state.actions) : [];
    const alfaResults = context ? await runAlfa(context, url, state.actions) : [];
    const merged = normalizeAndMerge(axeResults, ibmResults, customResults, alfaResults);
    stateResults.push({
      ...merged,
      violations: merged.violations.map((v) => ({ ...v, state: state.name })),
    });
  }

  return mergeAcrossStates(base, stateResults);
}

/**
 * Optional authentication for an authenticated scan session.
 */
export interface ScanAuthOptions {
  storageState?: string | Awaited<ReturnType<BrowserContext['storageState']>>;
  extraHTTPHeaders?: Record<string, string>;
  cookies?: import('playwright').Cookie[];
}

/**
 * Backward-compatible wrapper: launches browser, navigates, scans, closes.
 * Used by Phase 1 single-page scan API.
 */
export async function scanUrl(
  url: string,
  onProgress?: (status: string, progress: number) => void,
  auth?: ScanAuthOptions,
  states?: ScanState[]
) {
  onProgress?.('navigating', 10);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1024 },
    ...(auth?.storageState ? { storageState: auth.storageState } : {}),
    ...(auth?.extraHTTPHeaders ? { extraHTTPHeaders: auth.extraHTTPHeaders } : {}),
  });
  if (auth?.cookies?.length) {
    await context.addCookies(auth.cookies);
  }
  const page = await context.newPage();

  try {
    await navigateTo(page, url);
    onProgress?.('scanning', 40);

    const results = states?.length
      ? await multiEngineScanWithStates(page, url, context, states)
      : await multiEngineScan(page, url, context);

    onProgress?.('scoring', 80);
    return results;
  } finally {
    await browser.close();
  }
}
