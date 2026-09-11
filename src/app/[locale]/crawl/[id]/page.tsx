'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import SiteScoreDisplay from '@/components/SiteScoreDisplay';
import PageList from '@/components/PageList';
import ViolationList from '@/components/ViolationList';
import type { CrawlRecord, PageSummary } from '@/lib/types/crawl';
import type { AxeViolation } from '@/lib/types/scan';

export default function CrawlResultPage() {
  const params = useParams<{ id: string }>();
  const crawlId = params.id;
  const t = useTranslations('CrawlResult');
  const tCommon = useTranslations('Common');
  const [state, setState] = useState<'loading' | 'results' | 'error'>('loading');
  const [crawlData, setCrawlData] = useState<CrawlRecord | null>(null);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`a11ylab:crawl:${crawlId}`);
      if (!raw) {
        setErrorMessage('This crawl result is only available in the current browser session. Start a new crawl from the home page.');
        setState('error');
        return;
      }
      const data = JSON.parse(raw) as { crawl: CrawlRecord; pages: PageSummary[] };
      if (!data.crawl || data.crawl.status !== 'complete') {
        setErrorMessage(data.crawl?.error || t('crawlFailed'));
        setState('error');
        return;
      }
      setCrawlData(data.crawl);
      setPages(data.pages || []);
      setState('results');
      sessionStorage.removeItem(`a11ylab:crawl:${crawlId}`);
    } catch {
      setErrorMessage(t('networkError'));
      setState('error');
    }
  }, [crawlId, t]);

  function toAxeViolations(crawl: CrawlRecord): AxeViolation[] {
    if (!crawl.aggregatedViolations) return [];
    return crawl.aggregatedViolations.map((av) => ({
      id: av.ruleId,
      impact: av.impact,
      tags: [],
      description: av.description,
      help: av.help,
      helpUrl: av.helpUrl,
      principle: av.principle,
      nodes: av.affectedPages.map((ap) => ({ html: t('instancesOnUrl', { nodeCount: ap.nodeCount, url: ap.url }), target: [ap.url], impact: av.impact })),
    }));
  }

  function downloadReport() {
    if (!crawlData) return;
    const report = { crawl: crawlData, pages };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `a11ylab-wcag-report-${crawlId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (state === 'loading') return <div className="min-h-screen flex items-center justify-center p-8"><p className="text-gray-600">{tCommon('loading')}</p></div>;

  if (state === 'error') {
    return <div className="min-h-screen flex flex-col items-center justify-center p-8"><div className="text-center space-y-4"><h1 className="text-2xl font-bold text-red-600">{t('errorTitle')}</h1><p className="text-gray-600">{errorMessage}</p><Link href="/" className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">{tCommon('tryAgain')}</Link></div></div>;
  }

  if (!crawlData) return null;

  return (
    <div className="min-h-screen p-8 py-12">
      <div className="w-full max-w-4xl mx-auto space-y-8">
        <header className="text-center space-y-2">
          <h1 className="text-2xl font-bold">{t('siteReportTitle')}</h1>
          <p className="text-gray-600"><a href={crawlData.seedUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">{crawlData.seedUrl}</a></p>
          <p className="text-sm text-gray-500">{t('pagesScanned', { count: crawlData.completedPageCount })} · {t('started')} {new Date(crawlData.startedAt).toLocaleString()}</p>
        </header>

        <div className="flex justify-center gap-3">
          <button type="button" onClick={downloadReport} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors text-sm font-medium">Download Report</button>
          <Link href="/" className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors text-sm font-medium">{t('scanAnother')}</Link>
        </div>

        {crawlData.siteScore && <section aria-labelledby="site-score-heading"><h2 id="site-score-heading" className="text-xl font-semibold mb-4">{t('executiveSummary')}</h2><SiteScoreDisplay siteScore={crawlData.siteScore} /></section>}
        <section aria-labelledby="pages-heading"><h2 id="pages-heading" className="sr-only">{t('pageResults')}</h2><PageList pages={pages} crawlId={crawlId} /></section>
        {crawlData.aggregatedViolations && crawlData.aggregatedViolations.length > 0 && <section aria-labelledby="violations-heading"><h2 id="violations-heading" className="sr-only">{t('aggregatedViolations')}</h2><ViolationList violations={toAxeViolations(crawlData)} /></section>}
      </div>
    </div>
  );
}
