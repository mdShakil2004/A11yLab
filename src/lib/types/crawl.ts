import type { ScanStatus, AxeNode, ScanState } from './scan';
import type { ScoreGrade, PrincipleScores, ImpactBreakdown } from './score';

// ---------- Crawl Core ----------

export type CrawlStatus = 'pending' | 'discovering' | 'scanning' | 'aggregating' | 'complete' | 'error' | 'cancelled';

export interface CrawlConfig {
  maxPages: number;          // default: 50, max: 200
  maxDepth: number;          // default: 3
  concurrency: number;       // default: 3, max: 5
  delayMs: number;           // default: 1000
  includePatterns: string[];
  excludePatterns: string[];
  respectRobotsTxt: boolean; // default: true
  followSitemaps: boolean;   // default: true
  domainStrategy: 'same-hostname' | 'same-domain'; // default: 'same-hostname'
}

export interface CrawlRequest {
  url: string;
  maxPages?: number;
  maxDepth?: number;
  concurrency?: number;
  delayMs?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
  respectRobotsTxt?: boolean;
  followSitemaps?: boolean;
  domainStrategy?: 'same-hostname' | 'same-domain';
}

export interface CrawlRecord {
  id: string;
  seedUrl: string;
  config: CrawlConfig;
  status: CrawlStatus;
  progress: number;
  message: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
  discoveredUrls: string[];
  pageIds: string[];            // references to ScanRecord IDs in store
  completedPageCount: number;
  failedPageCount: number;
  totalPageCount: number;
  siteScore?: SiteScoreResult;
  aggregatedViolations?: AggregatedViolation[];
  abortController?: AbortController; // for cancellation — not serialized
}

// ---------- Page Summary ----------

export interface PageSummary {
  pageId: string;
  url: string;
  score: number;
  grade: ScoreGrade;
  violationCount: number;
  passCount: number;
  status: ScanStatus;
  scannedAt: string;
}

// ---------- Aggregated Violations ----------

export interface AggregatedViolation {
  ruleId: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  description: string;
  help: string;
  helpUrl: string;
  principle: string;
  totalInstances: number;
  affectedPages: { url: string; pageId: string; nodeCount: number }[];
  tags?: string[];
  nodes?: AxeNode[];
}

// ---------- Site Score ----------

export interface SiteScoreResult {
  overallScore: number;
  grade: ScoreGrade;
  lowestPageScore: number;
  highestPageScore: number;
  medianPageScore: number;
  pageCount: number;
  principleScores: PrincipleScores;
  impactBreakdown: ImpactBreakdown;
  totalUniqueViolations: number;
  totalViolationInstances: number;
  totalPasses: number;
  aodaCompliant: boolean;
}

// ---------- Site Report ----------

export interface SiteReportData {
  seedUrl: string;
  scanDate: string;
  engineVersion: string;
  siteScore: SiteScoreResult;
  aggregatedViolations: AggregatedViolation[];
  pageSummaries: PageSummary[];
  config: CrawlConfig;
  aodaNote: string;
  disclaimer: string;
}

// ---------- Crawl Progress (SSE) ----------

export interface CrawlProgressEvent {
  status: CrawlStatus;
  progress: number;
  message: string;
  totalPages: number;
  completedPages: number;
  failedPages: number;
  currentPage?: string;
  pagesCompleted: PageSummary[];
}

// ---------- CI/CD Types ----------

export interface CiScanRequest {
  url: string;
  standard?: 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA';
  threshold?: ThresholdConfig;
  format?: 'json' | 'sarif' | 'junit';
  storageStatePath?: string;
  /**
   * Optional named UI states to scan in addition to the default DOM. When
   * omitted, scanning behaviour is unchanged (default DOM only).
   */
  states?: ScanState[];
}

export interface CiCrawlRequest extends CiScanRequest {
  maxPages?: number;
  maxDepth?: number;
  concurrency?: number;
  /**
   * Optional include patterns forwarded to the crawler's URL filter. When
   * omitted, no include filtering is applied (default behaviour unchanged).
   */
  includePatterns?: string[];
  /**
   * Optional exclude patterns forwarded to the crawler's URL filter. When
   * omitted, no exclude filtering is applied (default behaviour unchanged).
   */
  excludePatterns?: string[];
}

export interface ThresholdConfig {
  score?: number;                 // minimum score (0-100)
  maxViolations?: {
    critical?: number | null;
    serious?: number | null;
    moderate?: number | null;
    minor?: number | null;
  };
  failOnRules?: string[];         // axe rule IDs that must pass
  ignoreRules?: string[];         // axe rule IDs to exclude
}

export interface CiResult {
  passed: boolean;
  score: number;
  grade: ScoreGrade;
  url: string;
  timestamp: string;
  violationCount: number;
  thresholdEvaluation: ThresholdEvaluation;
  violations: CiViolationSummary[];
  /**
   * Deduped, in-scope list of page URLs discovered during a crawl. Only
   * populated by the crawl endpoint; single-page scans omit it. Used by CI
   * pipelines to drive a multi-engine scan loop over discovered URLs.
   */
  urls?: string[];
}

export interface ThresholdEvaluation {
  scorePassed: boolean;
  countPassed: boolean;
  rulePassed: boolean;
  details: string[];
}

export interface CiViolationSummary {
  ruleId: string;
  impact: string;
  description: string;
  instanceCount: number;
  helpUrl: string;
}

// Re-export Phase 1 types for convenience
export type { ScanStatus, ScanResults, ScanRecord } from './scan';
export type { ScoreResult, ScoreGrade, PrincipleScores, ImpactBreakdown } from './score';
