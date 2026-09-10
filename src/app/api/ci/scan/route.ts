import { NextRequest, NextResponse } from 'next/server';
import { scanUrl } from '@/lib/scanner/engine';
import { parseAxeResults } from '@/lib/scanner/result-parser';
import { evaluateThreshold, getDefaultThreshold } from '@/lib/ci/threshold';
import { formatSarif } from '@/lib/ci/formatters/sarif';
import { formatJunit } from '@/lib/ci/formatters/junit';
import type { CiScanRequest, CiResult, CiViolationSummary } from '@/lib/types/crawl';
import type { ReviewItem, ScanState, ScanAction } from '@/lib/types/scan';
import { trackScanStart, trackScanComplete, trackScanError } from '@/lib/telemetry';
import { createLogger } from '@/lib/logger';

const log = createLogger('api:ci:scan');

function isValidScanUrl(input: string): boolean {
  if (!input || typeof input !== 'string' || input.length > 2048) return false;

  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const hostname = parsed.hostname;

  // Block private/internal IPs (SSRF prevention)
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname.startsWith('fc') ||
    hostname.startsWith('fd') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return false;
  }

  return true;
}

// Bounds chosen to keep a single scan request from driving an unbounded number
// of Playwright interactions (DoS / resource-exhaustion guard).
const MAX_STATES = 20;
const MAX_ACTIONS_PER_STATE = 30;
const ALLOWED_ACTION_KEYS = new Set(['click', 'waitFor', 'fill', 'press', 'frame']);

function isValidAction(action: unknown): action is ScanAction {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return false;
  const keys = Object.keys(action as Record<string, unknown>);
  // Each action is a single-key discriminated union member.
  if (keys.length !== 1) return false;
  const [key] = keys;
  if (!ALLOWED_ACTION_KEYS.has(key)) return false;
  const value = (action as Record<string, unknown>)[key];

  if (key === 'fill') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const fill = value as Record<string, unknown>;
    const fillKeys = Object.keys(fill);
    if (fillKeys.length !== 2) return false;
    return typeof fill.selector === 'string' && typeof fill.value === 'string';
  }

  // click / waitFor / press all take a single string.
  return typeof value === 'string';
}

/**
 * Validates an optional `states` payload. Returns the typed states when valid,
 * or an error string describing the first problem found. Rejects oversized or
 * malformed input so attacker-controlled JSON cannot drive unbounded browser
 * automation.
 */
function validateStates(
  input: unknown,
): { ok: true; states?: ScanState[] } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true };
  if (!Array.isArray(input)) return { ok: false, error: '"states" must be an array.' };
  if (input.length > MAX_STATES) {
    return { ok: false, error: `"states" may contain at most ${MAX_STATES} entries.` };
  }

  for (const state of input) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return { ok: false, error: 'Each state must be an object.' };
    }
    const s = state as Record<string, unknown>;
    if (typeof s.name !== 'string' || s.name.length === 0) {
      return { ok: false, error: 'Each state requires a non-empty "name".' };
    }
    if (!Array.isArray(s.actions)) {
      return { ok: false, error: `State "${s.name}" requires an "actions" array.` };
    }
    if (s.actions.length > MAX_ACTIONS_PER_STATE) {
      return { ok: false, error: `State "${s.name}" exceeds ${MAX_ACTIONS_PER_STATE} actions.` };
    }
    for (const action of s.actions) {
      if (!isValidAction(action)) {
        return { ok: false, error: `State "${s.name}" contains an invalid action.` };
      }
    }
    if (s.includeSelector !== undefined && typeof s.includeSelector !== 'string') {
      return { ok: false, error: `State "${s.name}" has an invalid "includeSelector".` };
    }
  }

  return { ok: true, states: input as ScanState[] };
}

export async function POST(request: NextRequest) {
  let body: CiScanRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { url } = body;

  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  if (!isValidScanUrl(url)) {
    return NextResponse.json({ error: 'Invalid URL. Only public HTTP/HTTPS URLs are allowed.' }, { status: 400 });
  }

  const statesValidation = validateStates(body.states);
  if (!statesValidation.ok) {
    return NextResponse.json({ error: statesValidation.error }, { status: 400 });
  }
  const states = statesValidation.states;

  log.info('CI scan requested', { url: url.trim(), format: body.format ?? 'json' });
  const startTime = Date.now();
  const span = trackScanStart('ci-scan', url.trim());
  try {
    // Synchronous scan — blocks until complete
    const auth = body.storageStatePath ? { storageState: body.storageStatePath } : undefined;
    const rawResults = await scanUrl(url.trim(), undefined, auth, states);
    const results = parseAxeResults(url.trim(), rawResults);

    // Threshold evaluation
    const thresholdConfig = body.threshold ?? getDefaultThreshold();
    const thresholdEvaluation = evaluateThreshold(
      results.score.overallScore,
      results.violations,
      thresholdConfig
    );

    // Build violation summaries
    const violations: CiViolationSummary[] = results.violations.map((v) => ({
      ruleId: v.id,
      impact: v.impact,
      description: v.description,
      instanceCount: v.nodes.length,
      helpUrl: v.helpUrl,
    }));

    const ciResult: CiResult = {
      passed: thresholdEvaluation.scorePassed && thresholdEvaluation.countPassed && thresholdEvaluation.rulePassed,
      score: results.score.overallScore,
      grade: results.score.grade,
      url: url.trim(),
      timestamp: new Date().toISOString(),
      violationCount: results.violations.length,
      thresholdEvaluation,
      violations,
    };

    // Format response
    const format = body.format ?? 'json';

    trackScanComplete(span, 'ci-scan', url.trim(), Date.now() - startTime, ciResult.score, ciResult.violationCount);

    if (format === 'sarif') {
      const hardViolations = results.violations.filter((v) => v.kind !== 'review');
      const reviewViolations = results.violations.filter((v) => v.kind === 'review');
      const reviewItems: ReviewItem[] = [
        ...reviewViolations.map((v) => ({
          engine: v.engine ?? 'ibm-equal-access',
          ruleId: v.id,
          impact: v.impact,
          message: v.help || v.description,
          helpUrl: v.helpUrl,
          tags: v.tags,
          nodes: v.nodes,
        })),
        ...results.incomplete.map((i) => ({
          engine: 'axe-core' as const,
          ruleId: i.id,
          impact: i.impact,
          message: i.help || i.description,
          helpUrl: i.helpUrl,
          tags: i.tags,
          nodes: i.nodes,
        })),
      ];
      const sarifOutput = formatSarif(url.trim(), hardViolations, results.engineVersion, reviewItems);
      return new NextResponse(sarifOutput, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (format === 'junit') {
      const junitOutput = formatJunit(ciResult);
      return new NextResponse(junitOutput, {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      });
    }

    return NextResponse.json(ciResult);
  } catch (error) {
    trackScanError(span, 'ci-scan', url.trim(), error instanceof Error ? error.message : 'Scan failed');
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Scan failed' },
      { status: 500 }
    );
  }
}
