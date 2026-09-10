import type { ScoreResult } from './score';

export type ScanStatus = 'pending' | 'navigating' | 'scanning' | 'scoring' | 'complete' | 'error';

/**
 * A single deterministic, data-only interaction applied to a page before
 * scanning a state. Every variant is a plain data recipe — no executable
 * strings — so it can be safely accepted from untrusted API callers.
 * Waiting is always selector-based (waitFor), never a fixed timeout.
 *
 * Frame context: `{ frame: <selector chain> }` activates a same-origin iframe
 * (resolved via Playwright FrameLocator); every subsequent click/waitFor/fill
 * then resolves INSIDE that iframe until another `{ frame }` action changes it.
 * `{ frame: '' }` resets back to the main frame. `press` always targets the
 * page-level keyboard (which routes to whatever element is focused, including
 * in-frame elements). All existing single-key shapes are unchanged and remain
 * fully backward compatible — main-frame recipes need no `frame` action.
 */
export type ScanAction =
  | { click: string }
  | { waitFor: string }
  | { fill: { selector: string; value: string } }
  | { press: string }
  | { frame: string };

/**
 * A named UI state to scan in addition to the default DOM. The ordered
 * actions are applied to drive the page into the state; when includeSelector
 * is set, engine scans for the state are scoped to that subtree.
 */
export interface ScanState {
  name: string;
  actions: ScanAction[];
  includeSelector?: string;
}

export interface ScanRequest {
  url: string;
}

export interface ScanRecord {
  id: string;
  url: string;
  status: ScanStatus;
  progress: number;
  message: string;
  startedAt: string;
  completedAt?: string;
  results?: ScanResults;
  error?: string;
}

export interface ScanResults {
  url: string;
  timestamp: string;
  engineVersion: string;
  violations: AxeViolation[];
  passes: AxePass[];
  incomplete: AxeIncomplete[];
  inapplicable: AxeInapplicable[];
  score: ScoreResult;
}

export interface AxeViolation {
  id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical';
  tags: string[];
  description: string;
  help: string;
  helpUrl: string;
  nodes: AxeNode[];
  principle?: string;
  engine?: 'axe-core' | 'ibm-equal-access' | 'custom' | 'alfa';
  /**
   * Classifies a finding as a hard violation or a "needs review" item.
   * IBM potentialviolation/manual levels and axe incomplete results are 'review';
   * everything else is treated as 'violation'. Defaults to 'violation' when absent.
   */
  kind?: 'violation' | 'review';
}

export interface NormalizedViolation extends AxeViolation {
  engine: 'axe-core' | 'ibm-equal-access' | 'custom' | 'alfa';
  /**
   * Name of the UI state in which this finding was detected (e.g.
   * 'add-party-modal'). Absent for findings from the default DOM scan.
   */
  state?: string;
}

/**
 * A "needs review" finding surfaced into SARIF as a non-gating note.
 * Sourced from IBM potentialviolation/manual results and axe incomplete results.
 */
export interface ReviewItem {
  engine: 'axe-core' | 'ibm-equal-access' | 'custom' | 'alfa';
  ruleId: string;
  impact: string | null;
  message: string;
  helpUrl: string;
  tags: string[];
  nodes: AxeNode[];
}

export interface MultiEngineResults {
  violations: NormalizedViolation[];
  passes: AxePass[];
  incomplete: AxeIncomplete[];
  inapplicable: AxeInapplicable[];
  engineVersions: Record<string, string>;
}

export interface AxeNode {
  html: string;
  target: string[];
  impact: string;
  failureSummary?: string;
}

export interface AxePass {
  id: string;
  tags: string[];
  description: string;
  nodes: { html: string; target: string[] }[];
}

export interface AxeIncomplete {
  id: string;
  impact: string | null;
  tags: string[];
  description: string;
  help: string;
  helpUrl: string;
  nodes: AxeNode[];
}

export interface AxeInapplicable {
  id: string;
  tags: string[];
  description: string;
}

// Re-export score types for convenience
export type { ScoreResult, ScoreGrade, PrincipleScores, PrincipleScore, ImpactBreakdown } from './score';
