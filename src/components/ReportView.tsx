import type { ScanResults } from '@/lib/types/scan';
import { useTranslations } from 'next-intl';
import ScoreDisplay from './ScoreDisplay';
import ViolationList from './ViolationList';
import { Link } from '@/i18n/navigation';

interface ReportViewProps {
  results: ScanResults;
  scanId: string;
}

export default function ReportView({ results, scanId }: ReportViewProps) {
  const t = useTranslations('ReportView');

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <header className="text-center space-y-2">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-gray-600">
          <a href={results.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
            {results.url}
          </a>
        </p>
        <p className="text-sm text-gray-600">
          {t('scannedOn', { date: new Date(results.timestamp).toLocaleString(), engine: results.engineVersion })}
        </p>
        <p className="text-sm text-gray-600">
          {t('violationsAcross', { violationCount: results.score.totalViolations, elementCount: results.score.totalElementViolations })}
        </p>
      </header>

      {/* PDF Download */}
      <div className="flex justify-center gap-3">
        <a
          href={`/api/scan/${scanId}/pdf`}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors text-sm font-medium"
          download
        >
          {t('downloadPdf')}
        </a>
        <Link
          href="/"
          className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors text-sm font-medium"
        >
          {t('scanAnother')}
        </Link>
      </div>

      {/* Executive Summary */}
      <section aria-labelledby="score-heading">
        <h2 id="score-heading" className="text-xl font-semibold mb-4">{t('executiveSummary')}</h2>
        <ScoreDisplay score={results.score} />
      </section>

      {/* Issue Summary Table */}
      <section aria-labelledby="issues-heading">
        <h2 id="issues-heading" className="text-xl font-semibold mb-4">{t('issueSummary')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th scope="col" className="text-left py-2 px-3 font-medium">{t('impactLevel')}</th>
                <th scope="col" className="text-right py-2 px-3 font-medium">{t('failed')}</th>
                <th scope="col" className="text-right py-2 px-3 font-medium">{t('passed')}</th>
              </tr>
            </thead>
            <tbody>
              {(['critical', 'serious', 'moderate', 'minor'] as const).map((impact) => (
                <tr key={impact} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-2 px-3 capitalize">{impact}</td>
                  <td className="py-2 px-3 text-right text-red-600 dark:text-red-400">{results.score.impactBreakdown[impact].failed}</td>
                  <td className="py-2 px-3 text-right text-green-700 dark:text-green-400">{results.score.impactBreakdown[impact].passed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Detailed Violations */}
      <section aria-labelledby="violations-heading">
        <h2 id="violations-heading" className="sr-only">{t('detailedViolations')}</h2>
        <ViolationList violations={results.violations} />
      </section>

      {/* Passes Section */}
      {results.passes.length > 0 && (
        <section aria-labelledby="passes-heading">
          <details>
            <summary className="text-xl font-semibold cursor-pointer hover:text-blue-600">
              <span id="passes-heading">{t('passedRules', { count: results.passes.length })}</span>
            </summary>
            <ul className="mt-3 space-y-1">
              {results.passes.map((p) => (
                <li key={p.id} className="text-sm text-gray-600 py-1">
                  <span className="text-green-500 mr-2" aria-hidden="true">✓</span>
                  {p.description}
                  <span className="text-xs text-gray-600 ml-2">({p.id})</span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      {/* Incomplete / Manual Review */}
      {results.incomplete.length > 0 && (
        <section aria-labelledby="incomplete-heading">
          <details>
            <summary className="text-xl font-semibold cursor-pointer hover:text-blue-600">
              <span id="incomplete-heading">{t('needsManualReview', { count: results.incomplete.length })}</span>
            </summary>
            <ul className="mt-3 space-y-1">
              {results.incomplete.map((item) => (
                <li key={item.id} className="text-sm text-gray-600 py-1">
                  <span className="text-yellow-500 mr-2" aria-hidden="true">?</span>
                  {item.description}
                  <a href={item.helpUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline ml-2 text-xs">
                    {t('learnMore')}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      {/* AODA Compliance Note */}
      <section aria-labelledby="aoda-heading" className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <h2 id="aoda-heading" className="text-lg font-semibold mb-2">{t('aodaComplianceNote')}</h2>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {t('aodaDescription')}
        </p>
      </section>

      {/* Disclaimer */}
      <footer className="text-xs text-gray-600 border-t border-gray-200 dark:border-gray-700 pt-4">
        <p>
          <strong>{t('disclaimerLabel')}</strong> {t('disclaimer')}
        </p>
      </footer>
    </div>
  );
}
