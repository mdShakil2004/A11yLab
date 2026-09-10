import type { AxeViolation, NormalizedViolation, ReviewItem } from '../types/scan';

interface SarifLog {
  $schema: string;
  version: '2.1.0';
  runs: SarifRun[];
}

interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri: string;
      semanticVersion: string;
      rules: SarifRule[];
    };
  };
  automationDetails?: { id: string };
  results: SarifResult[];
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  helpUri: string;
  help: {
    text: string;
    markdown: string;
  };
  defaultConfiguration: {
    level: 'error' | 'warning' | 'note';
  };
  properties: {
    tags: string[];
    precision: 'very-high' | 'high' | 'medium' | 'low';
    'problem.severity': 'error' | 'warning' | 'recommendation';
  };
}

interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: 'error' | 'warning' | 'note';
  message: { text: string };
  locations: SarifLocation[];
  partialFingerprints: Record<string, string>;
  properties?: { kind?: string };
}

interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region: { snippet: { text: string } };
  };
}

function mapImpactToLevel(impact: string): 'error' | 'warning' | 'note' {
  switch (impact) {
    case 'critical':
    case 'serious':
      return 'error';
    case 'moderate':
      return 'warning';
    case 'minor':
    default:
      return 'note';
  }
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function urlToArtifactPath(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '/index' : parsed.pathname;
    return `${parsed.hostname}${path}`;
  } catch {
    return url;
  }
}

function buildHelpMarkdown(violation: AxeViolation): string {
  const lines: string[] = [
    `# ${violation.help}`,
    '',
    violation.description,
    '',
    `**Impact:** ${violation.impact}`,
  ];

  if (violation.principle) {
    lines.push(`**Principle:** ${violation.principle}`);
  }

  if (violation.engine) {
    lines.push(`**Engine:** ${violation.engine}`);
  }

  const wcagTags = violation.tags.filter(t => /^wcag\d/.test(t));
  if (wcagTags.length > 0) {
    lines.push('', '## WCAG Criteria', '');
    for (const tag of wcagTags) {
      lines.push(`- \`${tag}\``);
    }
  }

  lines.push('', '## Learn More', '');
  if (violation.helpUrl) {
    lines.push(`- [Rule documentation](${violation.helpUrl})`);
  }

  return lines.join('\n');
}

function buildHelpText(violation: AxeViolation): string {
  const parts: string[] = [
    violation.help,
    '',
    violation.description,
    '',
    `Impact: ${violation.impact}`,
  ];

  if (violation.principle) {
    parts.push(`Principle: ${violation.principle}`);
  }

  const wcagTags = violation.tags.filter(t => /^wcag\d/.test(t));
  if (wcagTags.length > 0) {
    parts.push('', 'WCAG Criteria:');
    for (const tag of wcagTags) {
      parts.push(`  - ${tag}`);
    }
  }

  if (violation.helpUrl) {
    parts.push('', `Learn more: ${violation.helpUrl}`);
  }

  return parts.join('\n');
}

function mapEngineToPrecision(engine?: string): 'very-high' | 'high' | 'medium' | 'low' {
  switch (engine) {
    case 'axe-core':
      return 'very-high';
    case 'ibm-equal-access':
      return 'high';
    case 'alfa':
      // Alfa implements the W3C ACT-Rules with formal expectations, so its
      // hard failures carry comparable confidence to IBM Equal Access.
      return 'high';
    default:
      return 'medium';
  }
}

function mapImpactToSeverity(impact: string): 'error' | 'warning' | 'recommendation' {
  switch (impact) {
    case 'critical':
    case 'serious':
      return 'error';
    case 'moderate':
      return 'warning';
    case 'minor':
    default:
      return 'recommendation';
  }
}

function truncateTags(tags: string[], limit: number): string[] {
  if (tags.length <= limit) return tags;
  const wcag = tags.filter(t => /^wcag\d/.test(t));
  const other = tags.filter(t => !/^wcag\d/.test(t));
  return [...wcag, ...other].slice(0, limit);
}

function buildRun(url: string, violations: AxeViolation[], toolVersion: string, reviewItems: ReviewItem[] = []): SarifRun {
  const rulesMap = new Map<string, { rule: SarifRule; index: number }>();
  const rules: SarifRule[] = [];
  const results: SarifResult[] = [];
  // Defensive de-duplication: GHAzDO/code-scanning collapses results with the
  // same (ruleId, location, fingerprint), so emitting exact duplicates only
  // bloats the SARIF and makes the per-run "Scans" tab disagree with the
  // de-duplicated Advanced Security alert count. Skip results we have already
  // emitted for the same rule + selector + snippet on this page.
  const seenResults = new Set<string>();

  for (const violation of violations) {
    if (!rulesMap.has(violation.id)) {
      const index = rules.length;
      const rule: SarifRule = {
        id: violation.id,
        name: violation.id,
        shortDescription: { text: violation.help },
        fullDescription: { text: violation.description },
        helpUri: violation.helpUrl,
        help: {
          text: buildHelpText(violation),
          markdown: buildHelpMarkdown(violation),
        },
        defaultConfiguration: {
          level: mapImpactToLevel(violation.impact),
        },
        properties: {
          tags: truncateTags(violation.tags, 10),
          precision: mapEngineToPrecision(violation.engine),
          'problem.severity': mapImpactToSeverity(violation.impact),
        },
      };
      rules.push(rule);
      rulesMap.set(violation.id, { rule, index });
    }

    const ruleEntry = rulesMap.get(violation.id)!;

    // NormalizedViolation carries an optional UI-state label; AxeViolation does
    // not. Narrow defensively so default-DOM AxeViolation input is unaffected.
    const state = (violation as NormalizedViolation).state;

    for (const node of violation.nodes) {
      const target = node.target.join(' ');
      const dedupKey = `${violation.id}\u0000${target}\u0000${node.html}`;
      if (seenResults.has(dedupKey)) {
        continue;
      }
      seenResults.add(dedupKey);
      results.push({
        ruleId: violation.id,
        ruleIndex: ruleEntry.index,
        level: mapImpactToLevel(violation.impact),
        message: {
          text: `${violation.description}: ${violation.help}. Scanned URL: ${url} — Selector: ${target} — ${violation.nodes.length} element(s) affected${node.failureSummary ? ` — ${node.failureSummary}` : ''}`,
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: urlToArtifactPath(url) },
              region: { snippet: { text: node.html } },
            },
          },
        ],
        partialFingerprints: {
          // When the finding originates from a named UI state, fold the state
          // into the fingerprint so the same rule+selector reported in two
          // different states yields distinct alerts. Findings with no state
          // keep their original fingerprint, so default-DOM SARIF is unchanged.
          primaryLocationLineHash: simpleHash(
            state
              ? `${violation.id}:${target}:${state}`
              : `${violation.id}:${target}`,
          ),
        },
      });
    }
  }

  // "Needs review" findings (axe incomplete + IBM potentialviolation/manual).
  // These are emitted as non-gating SARIF notes (level: note,
  // problem.severity: recommendation) and tagged properties.kind: "review".
  // Violations are processed first and share the same seenResults set, so a
  // hard finding on the same (ruleId, selector, snippet) suppresses its review
  // duplicate.
  for (const item of reviewItems) {
    if (!rulesMap.has(item.ruleId)) {
      const index = rules.length;
      const syntheticViolation: AxeViolation = {
        id: item.ruleId,
        impact: (item.impact as AxeViolation['impact']) ?? 'minor',
        tags: item.tags,
        description: item.message,
        help: item.message,
        helpUrl: item.helpUrl,
        nodes: item.nodes,
        engine: item.engine,
      };
      const rule: SarifRule = {
        id: item.ruleId,
        name: item.ruleId,
        shortDescription: { text: item.message },
        fullDescription: { text: item.message },
        helpUri: item.helpUrl,
        help: {
          text: buildHelpText(syntheticViolation),
          markdown: buildHelpMarkdown(syntheticViolation),
        },
        defaultConfiguration: {
          level: 'note',
        },
        properties: {
          tags: truncateTags(item.tags, 10),
          precision: mapEngineToPrecision(item.engine),
          'problem.severity': 'recommendation',
        },
      };
      rules.push(rule);
      rulesMap.set(item.ruleId, { rule, index });
    }

    const ruleEntry = rulesMap.get(item.ruleId)!;

    for (const node of item.nodes) {
      const target = node.target.join(' ');
      const dedupKey = `${item.ruleId}\u0000${target}\u0000${node.html}`;
      if (seenResults.has(dedupKey)) {
        continue;
      }
      seenResults.add(dedupKey);
      results.push({
        ruleId: item.ruleId,
        ruleIndex: ruleEntry.index,
        level: 'note',
        message: {
          text: `[Needs review] ${item.message}. Scanned URL: ${url} — Selector: ${target}${node.failureSummary ? ` — ${node.failureSummary}` : ''}`,
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: urlToArtifactPath(url) },
              region: { snippet: { text: node.html } },
            },
          },
        ],
        partialFingerprints: {
          primaryLocationLineHash: simpleHash(`${item.ruleId}:${target}`),
        },
        properties: { kind: 'review' },
      });
    }
  }

  return {
    tool: {
      driver: {
        name: 'accessibility-scanner',
        version: toolVersion,
        informationUri: 'https://github.com/devopsabcs-engineering/accessibility-scan-demo-app',
        semanticVersion: toolVersion,
        rules,
      },
    },
    automationDetails: {
      id: `accessibility-scan/${url}`,
    },
    results,
  };
}

export function generateSarif(
  url: string,
  violations: AxeViolation[],
  toolVersion: string,
  reviewItems: ReviewItem[] = []
): SarifLog {
  return {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [buildRun(url, violations, toolVersion, reviewItems)],
  };
}

export function generateSiteSarif(
  pages: { url: string; violations: AxeViolation[] }[],
  toolVersion: string
): SarifLog {
  return {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: pages.map((page) => buildRun(page.url, page.violations, toolVersion)),
  };
}
