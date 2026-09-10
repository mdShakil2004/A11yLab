'use client';

import { useTranslations } from 'next-intl';
import type { AxeViolation } from '@/lib/types/scan';

interface ViolationListProps {
  violations: AxeViolation[];
}

const impactColors: Record<string, string> = {
  critical: 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200',
  serious: 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200',
  moderate: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200',
  minor: 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200',
};

export default function ViolationList({ violations }: ViolationListProps) {
  const t = useTranslations('ViolationList');

  const principleLabels: Record<string, string> = {
    perceivable: t('principlePerceivable'),
    operable: t('principleOperable'),
    understandable: t('principleUnderstandable'),
    robust: t('principleRobust'),
    'best-practice': t('principleBestPractice'),
  };
  // Group violations by principle
  const grouped = violations.reduce<Record<string, AxeViolation[]>>((acc, v) => {
    const principle = v.principle || 'best-practice';
    if (!acc[principle]) acc[principle] = [];
    acc[principle].push(v);
    return acc;
  }, {});

  const principles = ['perceivable', 'operable', 'understandable', 'robust', 'best-practice'];

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-semibold">{t('title', { count: violations.length })}</h3>
      {principles.map((principle) => {
        const items = grouped[principle];
        if (!items || items.length === 0) return null;
        return (
          <details key={principle} open className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <summary className="px-4 py-3 bg-gray-50 dark:bg-gray-800 cursor-pointer font-medium flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-750">
              <span>{principleLabels[principle] || principle}</span>
              <span className="text-sm text-gray-600">{t('issues', { count: items.length })}</span>
            </summary>
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {items.map((v, i) => (
                <ViolationItem key={`${v.id}-${i}`} violation={v} />
              ))}
            </div>
          </details>
        );
      })}
      {violations.length === 0 && (
        <p className="text-green-600 dark:text-green-400 font-medium">
          {t('noViolations')}
        </p>
      )}
    </div>
  );
}

function ViolationItem({ violation }: { violation: AxeViolation }) {
  const t = useTranslations('ViolationList');

  return (
    <details className="group">
      <summary className="px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50">
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 px-2 py-0.5 rounded text-xs font-medium ${impactColors[violation.impact]}`}>
            {violation.impact}
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">{violation.help}</div>
            <div className="text-xs text-gray-600 mt-0.5">
              {violation.id} · {t('elementsAffected', { count: violation.nodes.length })}
            </div>
          </div>
        </div>
      </summary>
      <div className="px-4 pb-4 space-y-3 ml-16">
        <p className="text-sm text-gray-600">{violation.description}</p>
        <div className="space-y-2">
          {violation.nodes.slice(0, 5).map((node, i) => (
            <div key={i} className="bg-gray-50 dark:bg-gray-800 rounded p-3">
              <code className="text-xs break-all block whitespace-pre-wrap">{node.html}</code>
              {node.failureSummary && (
                <p className="text-xs text-gray-600 mt-2">{node.failureSummary}</p>
              )}
              <p className="text-xs text-gray-600 mt-1">{t('selector')} {node.target.join(' > ')}</p>
            </div>
          ))}
          {violation.nodes.length > 5 && (
            <p className="text-xs text-gray-600">{t('moreElements', { count: violation.nodes.length - 5 })}</p>
          )}
        </div>
        <a
          href={violation.helpUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          {t('learnMore')}
        </a>
      </div>
    </details>
  );
}
