import type { AxeViolation, NormalizedViolation, MultiEngineResults, AxePass, AxeIncomplete, AxeInapplicable } from '../types/scan';
import type { AxeResults } from 'axe-core';
import { mapTagToPrinciple } from '../scoring/wcag-mapper';

/**
 * IBM Equal Access result item (IBaselineResult shape).
 * Defined locally to avoid tight coupling to IBM's internal types.
 */
export interface IbmReportResult {
  ruleId: string;
  value: [string, string]; // [eRulePolicy, eRuleConfidence]
  path: { [ns: string]: string };
  message: string;
  snippet: string;
  reasonId?: number | string;
  messageArgs?: string[];
  apiArgs?: unknown[];
  category?: string;
  level?: string;
  help?: string;
}

/**
 * Custom check result format (used by Phase 3 custom Playwright checks).
 */
export interface CustomCheckResult {
  id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical';
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: { html: string; target: string[] }[];
  /**
   * Marks the finding as a non-gating "needs review" note rather than a hard
   * violation. Defaults to 'violation' when omitted.
   */
  kind?: 'violation' | 'review';
}

/**
 * Serializable intermediate produced by the Alfa ACT-Rules runner (engine.ts).
 * Decoupled from Alfa's internal Outcome/EARL types so the normalizer stays
 * testable without the @siteimprove packages installed. The runner maps each
 * ACT outcome down to this flat shape:
 *   Outcome.Failed     -> outcome: 'failed'      (hard violation)
 *   Outcome.CantTell   -> outcome: 'cantTell'    (surfaced as kind: 'review')
 *   Outcome.Passed     -> dropped by the runner (not emitted)
 *   Outcome.Inapplicable -> dropped by the runner (not emitted)
 */
export interface AlfaRawOutcome {
  ruleId: string;
  outcome: 'failed' | 'cantTell' | 'passed' | 'inapplicable';
  impact: AxeViolation['impact'];
  html: string;
  target: string;
  message: string;
  helpUrl: string;
  tags: string[];
}

const IBM_LEVEL_TO_IMPACT: Record<string, AxeViolation['impact']> = {
  violation: 'critical',
  potentialviolation: 'serious',
  recommendation: 'moderate',
  potentialrecommendation: 'moderate',
  manual: 'minor',
};

/**
 * IBM levels that represent "needs review" findings rather than hard violations.
 * These are tagged kind: 'review' so they surface as non-gating SARIF notes.
 * The impact mapping above is left untouched so scoring is unchanged.
 */
const IBM_REVIEW_LEVELS = new Set(['potentialviolation', 'manual']);

const IMPACT_SEVERITY_ORDER: Record<string, number> = {
  critical: 4,
  serious: 3,
  moderate: 2,
  minor: 1,
};

/**
 * Extract the base URL (before # fragment) from the raw IBM help field.
 * Falls back to the /archives/latest/ URL pattern when help is not a valid URL.
 */
function extractIbmHelpUrl(rawHelp: string | undefined, ruleId: string): string {
  if (rawHelp) {
    try {
      const url = new URL(rawHelp);
      const ruleFile = url.pathname.split('/').pop();
      if (ruleFile) {
        return `https://able.ibm.com/rules/archives/latest/doc/en-US/${ruleFile}`;
      }
    } catch {
      // not a URL, fall through
    }
  }
  return `https://able.ibm.com/rules/archives/latest/doc/en-US/${ruleId}.html`;
}

/**
 * Normalize IBM Equal Access results to the unified NormalizedViolation format.
 */
export function normalizeIbmResults(ibmResults: IbmReportResult[]): NormalizedViolation[] {
  if (!ibmResults?.length) return [];

  return ibmResults
    .filter(r => {
      // Only include failures, not passes
      const confidence = r.value?.[1];
      return confidence !== 'PASS';
    })
    .map(r => {
      const level = r.level ?? mapIbmValueToLevel(r.value);
      const impact = IBM_LEVEL_TO_IMPACT[level] ?? 'moderate';
      const domPath = r.path?.dom ?? r.path?.aria ?? '';
      const tags = buildIbmTags(r);
      const kind: NormalizedViolation['kind'] = IBM_REVIEW_LEVELS.has(level) ? 'review' : 'violation';

      return {
        id: r.ruleId,
        impact,
        tags,
        description: r.message,
        help: r.message,
        helpUrl: extractIbmHelpUrl(r.help, r.ruleId),
        nodes: [{
          html: r.snippet || '',
          target: [domPath],
          impact: impact,
          failureSummary: r.message,
        }],
        principle: mapTagToPrinciple(tags),
        engine: 'ibm-equal-access' as const,
        kind,
      };
    });
}

/**
 * Normalize custom Playwright check results to the unified format.
 */
export function normalizeCustomResults(customResults: CustomCheckResult[]): NormalizedViolation[] {
  if (!customResults?.length) return [];

  return customResults.map(r => ({
    id: r.id,
    impact: r.impact,
    tags: r.tags,
    description: r.description,
    help: r.help,
    helpUrl: r.helpUrl,
    nodes: r.nodes.map(n => ({
      html: n.html,
      target: n.target,
      impact: r.impact,
      failureSummary: r.description,
    })),
    principle: mapTagToPrinciple(r.tags),
    engine: 'custom' as const,
    kind: r.kind ?? 'violation',
  }));
}

/**
 * Normalize axe-core violations, adding the engine tag.
 */
export function normalizeAxeResults(axeViolations: AxeViolation[]): NormalizedViolation[] {
  if (!axeViolations?.length) return [];

  return axeViolations.map(v => ({
    ...v,
    engine: 'axe-core' as const,
  }));
}

/**
 * Normalize Alfa ACT-Rules outcomes to the unified NormalizedViolation format.
 * Only failing and "cant tell" outcomes are surfaced: 'failed' becomes a hard
 * violation, 'cantTell' becomes a non-gating kind: 'review' note (mirroring the
 * IBM potentialviolation/manual treatment). 'passed' and 'inapplicable' are
 * dropped by the runner before they reach here, but are filtered defensively.
 */
export function normalizeAlfa(alfaResults: AlfaRawOutcome[]): NormalizedViolation[] {
  if (!alfaResults?.length) return [];

  return alfaResults
    .filter(r => r.outcome === 'failed' || r.outcome === 'cantTell')
    .map(r => {
      const kind: NormalizedViolation['kind'] = r.outcome === 'cantTell' ? 'review' : 'violation';
      const tags = r.tags?.length ? r.tags : ['best-practice'];
      const impact = r.impact ?? 'moderate';

      return {
        id: r.ruleId,
        impact,
        tags,
        description: r.message,
        help: r.message,
        helpUrl: r.helpUrl,
        nodes: [{
          html: r.html || '',
          target: [r.target],
          impact,
          failureSummary: r.message,
        }],
        principle: mapTagToPrinciple(tags),
        engine: 'alfa' as const,
        kind,
      };
    });
}

/**
 * Deduplicate violations across engines.
 * Key: normalizeSelector(target[0]) + '|' + primaryWcagTag
 * When the same element is flagged for the same WCAG criterion by multiple engines,
 * keep the higher-severity finding.
 */
export function deduplicateViolations(violations: NormalizedViolation[]): NormalizedViolation[] {
  if (!violations?.length) return [];

  const dedupMap = new Map<string, NormalizedViolation>();

  for (const v of violations) {
    const wcagTag = getPrimaryWcagTag(v.tags);
    for (const node of v.nodes) {
      const selector = normalizeSelector(node.target[0] ?? '');
      const key = `${selector}|${wcagTag}`;

      // Store a SINGLE-node copy keyed by (selector, WCAG criterion). Keying per
      // node but storing the whole multi-node violation caused a quadratic
      // explosion downstream: an N-node violation produced N map entries each
      // still carrying all N nodes, so the SARIF generator (which emits one
      // result per node) emitted N×N results. Carrying only the matching node
      // keeps each finding represented exactly once.
      const existing = dedupMap.get(key);
      if (!existing) {
        dedupMap.set(key, { ...v, nodes: [node] });
      } else {
        const existingIsReview = existing.kind === 'review';
        const incomingIsReview = v.kind === 'review';
        if (existingIsReview !== incomingIsReview) {
          // A hard violation always wins over a "needs review" duplicate on the
          // same (selector, WCAG criterion) key, regardless of mapped severity.
          // The review duplicate is dropped so a single element/criterion is not
          // reported both ways.
          if (existingIsReview) {
            dedupMap.set(key, { ...v, nodes: [node] });
          }
        } else {
          // Same kind — keep higher severity
          const existingSeverity = IMPACT_SEVERITY_ORDER[existing.impact] ?? 0;
          const newSeverity = IMPACT_SEVERITY_ORDER[v.impact] ?? 0;
          if (newSeverity > existingSeverity) {
            dedupMap.set(key, { ...v, nodes: [node] });
          }
        }
      }
    }
  }

  return Array.from(dedupMap.values());
}

/**
 * Main orchestrator: normalize results from all engines and merge with deduplication.
 */
export function normalizeAndMerge(
  axeResults: AxeResults,
  ibmResults: IbmReportResult[],
  customResults: CustomCheckResult[],
  alfaResults: AlfaRawOutcome[] = [],
): MultiEngineResults {
  const axeViolations = normalizeAxeResults(
    axeResults.violations.map(v => ({
      id: v.id,
      impact: (v.impact as AxeViolation['impact']) ?? 'minor',
      tags: v.tags,
      description: v.description,
      help: v.help,
      helpUrl: v.helpUrl,
      nodes: v.nodes.map(n => ({
        html: n.html,
        target: n.target.map(String),
        impact: n.impact ?? 'minor',
        failureSummary: n.failureSummary,
      })),
      principle: mapTagToPrinciple(v.tags),
    })),
  );

  const ibmViolations = normalizeIbmResults(ibmResults);
  const customViolations = normalizeCustomResults(customResults);
  const alfaViolations = normalizeAlfa(alfaResults);

  const allViolations = [...axeViolations, ...ibmViolations, ...customViolations, ...alfaViolations];
  const deduped = deduplicateViolations(allViolations);

  // Map passes, incomplete, inapplicable from axe (IBM doesn't have equivalent)
  const passes: AxePass[] = axeResults.passes.map(p => ({
    id: p.id,
    tags: p.tags,
    description: p.description,
    nodes: p.nodes.map(n => ({
      html: n.html,
      target: n.target.map(String),
    })),
  }));

  const incomplete: AxeIncomplete[] = axeResults.incomplete.map(i => ({
    id: i.id,
    impact: i.impact ?? null,
    tags: i.tags,
    description: i.description,
    help: i.help,
    helpUrl: i.helpUrl,
    nodes: i.nodes.map(n => ({
      html: n.html,
      target: n.target.map(String),
      impact: n.impact ?? 'minor',
      failureSummary: n.failureSummary,
    })),
  }));

  const inapplicable: AxeInapplicable[] = axeResults.inapplicable.map(ia => ({
    id: ia.id,
    tags: ia.tags,
    description: ia.description,
  }));

  const engineVersions: Record<string, string> = {
    'axe-core': axeResults.testEngine?.version ?? 'unknown',
  };

  if (ibmResults.length > 0) {
    engineVersions['ibm-equal-access'] = 'latest';
  }
  if (customResults.length > 0) {
    engineVersions['custom'] = '1.0.0';
  }
  if (alfaResults.length > 0) {
    engineVersions['alfa'] = 'latest';
  }

  return {
    violations: deduped,
    passes,
    incomplete,
    inapplicable,
    engineVersions,
  };
}

/**
 * Merge a default-DOM scan with one or more state scans into a single result
 * set. Cross-state duplicates are collapsed by (ruleId, target, message),
 * keeping the FIRST occurrence seen. The default-DOM scan is supplied first and
 * therefore always wins on duplicates, so a finding present in the base DOM is
 * never re-attributed to a state and the default-DOM result is left unchanged.
 *
 * Passes / incomplete / inapplicable are taken from the base scan only (state
 * scans are scoped re-runs and would otherwise inflate these counts).
 * engineVersions are unioned across all scans.
 */
export function mergeAcrossStates(
  base: MultiEngineResults,
  stateResults: MultiEngineResults[],
): MultiEngineResults {
  const seen = new Set<string>();
  const violations: NormalizedViolation[] = [];

  const addAll = (list: NormalizedViolation[]): void => {
    for (const v of list) {
      for (const node of v.nodes) {
        const target = normalizeSelector(node.target[0] ?? '');
        const key = `${v.id}\u0000${target}\u0000${v.description}`;
        if (seen.has(key)) continue;
        seen.add(key);
        violations.push(v.nodes.length === 1 ? v : { ...v, nodes: [node] });
      }
    }
  };

  // Base first so default-DOM findings win on duplicate keys.
  addAll(base.violations);
  for (const sr of stateResults) {
    addAll(sr.violations);
  }

  const engineVersions: Record<string, string> = { ...base.engineVersions };
  for (const sr of stateResults) {
    Object.assign(engineVersions, sr.engineVersions);
  }

  return {
    violations,
    passes: base.passes,
    incomplete: base.incomplete,
    inapplicable: base.inapplicable,
    engineVersions,
  };
}

// --- Internal helpers ---

function normalizeSelector(selector: string): string {
  return selector.trim().toLowerCase().replace(/\s+/g, ' ');
}

function getPrimaryWcagTag(tags: string[]): string {
  const wcag = tags.find(t => /^wcag\d{3,}$/.test(t));
  return wcag ?? tags[0] ?? 'unknown';
}

function mapIbmValueToLevel(value: [string, string]): string {
  const [policy, confidence] = value ?? [];
  if (confidence === 'FAIL' && policy === 'VIOLATION') return 'violation';
  if (confidence === 'POTENTIAL') return 'potentialviolation';
  if (confidence === 'MANUAL') return 'manual';
  if (policy === 'RECOMMENDATION') return 'recommendation';
  return 'recommendation';
}

function buildIbmTags(r: IbmReportResult): string[] {
  const tags: string[] = [];
  if (r.category) {
    tags.push(r.category);
  }
  // IBM category often aligns with WCAG principles: Accessibility, Design, Labeling, etc.
  // Add a generic wcag tag if none present
  if (!tags.some(t => /^wcag/.test(t))) {
    tags.push('best-practice');
  }
  return tags;
}
