import type { ScanRecord } from '../types/scan';
import type { ScoreGrade, PrincipleScores, ImpactBreakdown } from '../types/score';
import type { SiteScoreResult, AggregatedViolation, PageSummary } from '../types/crawl';
import { mapTagToPrinciple } from './wcag-mapper';

function getGrade(score: number): ScoreGrade {
  if (score >= 90) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}

function getCompletedPages(pageRecords: ScanRecord[]): ScanRecord[] {
  return pageRecords.filter(
    (p) => p.status === 'complete' && p.results != null
  );
}

export function calculateSiteScore(pageRecords: ScanRecord[]): SiteScoreResult {
  const completed = getCompletedPages(pageRecords);

  if (completed.length === 0) {
    return {
      overallScore: 0,
      grade: 'F',
      lowestPageScore: 0,
      highestPageScore: 0,
      medianPageScore: 0,
      pageCount: 0,
      principleScores: emptyPrincipleScores(),
      impactBreakdown: emptyImpactBreakdown(),
      totalUniqueViolations: 0,
      totalViolationInstances: 0,
      totalPasses: 0,
      aodaCompliant: true,
    };
  }

  const pageScores = completed.map((p) => p.results!.score.overallScore);
  const sorted = [...pageScores].sort((a, b) => a - b);

  const overallScore = Math.round(
    pageScores.reduce((sum, s) => sum + s, 0) / pageScores.length
  );
  const lowestPageScore = Math.min(...pageScores);
  const highestPageScore = Math.max(...pageScores);
  const medianPageScore =
    sorted.length % 2 === 1
      ? sorted[Math.floor(sorted.length / 2)]
      : Math.round(
          (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        );

  // Aggregate principle scores across all pages
  const principleData: Record<string, { violations: number; passes: number }> = {
    perceivable: { violations: 0, passes: 0 },
    operable: { violations: 0, passes: 0 },
    understandable: { violations: 0, passes: 0 },
    robust: { violations: 0, passes: 0 },
  };

  const impactBreakdown: ImpactBreakdown = {
    critical: { passed: 0, failed: 0 },
    serious: { passed: 0, failed: 0 },
    moderate: { passed: 0, failed: 0 },
    minor: { passed: 0, failed: 0 },
  };

  const uniqueRuleIds = new Set<string>();
  let totalViolationInstances = 0;
  let totalPasses = 0;
  let allPagesClean = true;

  for (const page of completed) {
    const results = page.results!;

    if (results.violations.length > 0) {
      allPagesClean = false;
    }

    totalPasses += results.passes.length;

    for (const violation of results.violations) {
      uniqueRuleIds.add(violation.id);
      totalViolationInstances += violation.nodes.length;

      const impact = violation.impact || 'minor';
      if (impact in impactBreakdown) {
        impactBreakdown[impact as keyof ImpactBreakdown].failed++;
      }

      const principle = mapTagToPrinciple(violation.tags);
      if (principle in principleData) {
        principleData[principle].violations++;
      }
    }

    for (const pass of results.passes) {
      impactBreakdown.minor.passed++;
      const principle = mapTagToPrinciple(pass.tags);
      if (principle in principleData) {
        principleData[principle].passes++;
      }
    }
  }

  const principleScores: PrincipleScores = {
    perceivable: computePrincipleScore(principleData.perceivable),
    operable: computePrincipleScore(principleData.operable),
    understandable: computePrincipleScore(principleData.understandable),
    robust: computePrincipleScore(principleData.robust),
  };

  return {
    overallScore,
    grade: getGrade(overallScore),
    lowestPageScore,
    highestPageScore,
    medianPageScore,
    pageCount: completed.length,
    principleScores,
    impactBreakdown,
    totalUniqueViolations: uniqueRuleIds.size,
    totalViolationInstances,
    totalPasses,
    aodaCompliant: allPagesClean,
  };
}

export function aggregateViolations(
  pageRecords: ScanRecord[]
): AggregatedViolation[] {
  const completed = getCompletedPages(pageRecords);
  const ruleMap = new Map<string, AggregatedViolation>();

  for (const page of completed) {
    for (const violation of page.results!.violations) {
      const existing = ruleMap.get(violation.id);
      const nodeCount = violation.nodes.length;

      if (existing) {
        existing.totalInstances += nodeCount;
        existing.affectedPages.push({
          url: page.url,
          pageId: page.id,
          nodeCount,
        });
        if (existing.nodes && existing.nodes.length < 5) {
          const remaining = 5 - existing.nodes.length;
          existing.nodes.push(...violation.nodes.slice(0, remaining));
        }
      } else {
        ruleMap.set(violation.id, {
          ruleId: violation.id,
          impact: violation.impact || 'minor',
          description: violation.description,
          help: violation.help,
          helpUrl: violation.helpUrl,
          principle: mapTagToPrinciple(violation.tags),
          totalInstances: nodeCount,
          affectedPages: [{ url: page.url, pageId: page.id, nodeCount }],
          tags: violation.tags,
          nodes: violation.nodes.slice(0, 5),
        });
      }
    }
  }

  return Array.from(ruleMap.values());
}

export function generatePageSummaries(
  pageRecords: ScanRecord[]
): PageSummary[] {
  const completed = getCompletedPages(pageRecords);

  return completed.map((page) => {
    const results = page.results!;
    return {
      pageId: page.id,
      url: page.url,
      score: results.score.overallScore,
      grade: getGrade(results.score.overallScore),
      violationCount: results.violations.length,
      passCount: results.passes.length,
      status: page.status,
      scannedAt: page.completedAt ?? page.startedAt,
    };
  });
}

function computePrincipleScore(data: { violations: number; passes: number }) {
  const total = data.violations + data.passes;
  return {
    score: total > 0 ? Math.round((data.passes / total) * 100) : 100,
    violationCount: data.violations,
    passCount: data.passes,
  };
}

function emptyPrincipleScores(): PrincipleScores {
  return {
    perceivable: { score: 100, violationCount: 0, passCount: 0 },
    operable: { score: 100, violationCount: 0, passCount: 0 },
    understandable: { score: 100, violationCount: 0, passCount: 0 },
    robust: { score: 100, violationCount: 0, passCount: 0 },
  };
}

function emptyImpactBreakdown(): ImpactBreakdown {
  return {
    critical: { passed: 0, failed: 0 },
    serious: { passed: 0, failed: 0 },
    moderate: { passed: 0, failed: 0 },
    minor: { passed: 0, failed: 0 },
  };
}
