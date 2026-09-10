'use client';

import { useState, useCallback, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import CrawlProgress from '@/components/CrawlProgress';
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

  const [state, setState] = useState<'crawling' | 'results' | 'error'>('crawling');
  const [crawlData, setCrawlData] = useState<CrawlRecord | null>(null);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const handleComplete = useCallback(async () => {
    try {
      const [crawlRes, pagesRes] = await Promise.all([
        fetch(`/api/crawl/${crawlId}`),
        fetch(`/api/crawl/${crawlId}/pages`),
      ]);
      if (!crawlRes.ok) {
        setErrorMessage(t('fetchFailed'));
        setState('error');
        return;
      }
      const data: CrawlRecord = await crawlRes.json();
      setCrawlData(data);

      if (pagesRes.ok) {
        const pagesData = await pagesRes.json();
        setPages(pagesData.pages || []);
      }

      setState('results');
    } catch {
      setErrorMessage(t('networkError'));
      setState('error');
    }
  }, [crawlId, t]);

  const handleError = useCallback((message: string) => {
    setErrorMessage(message);
    setState('error');
  }, []);

  // Check if crawl is already complete on initial load
  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch(`/api/crawl/${crawlId}`);
        if (!res.ok) return;
        const data: CrawlRecord = await res.json();
        if (data.status === 'complete') {
          setCrawlData(data);
          const pagesRes = await fetch(`/api/crawl/${crawlId}/pages`);
          if (pagesRes.ok) {
            const pagesData = await pagesRes.json();
            setPages(pagesData.pages || []);
          }
          setState('results');
        } else if (data.status === 'error') {
          setErrorMessage(data.error || t('crawlFailed'));
          setState('error');
        }
      } catch {
        // Crawl may not exist yet or network error — stay in crawling state
      }
    }
    checkStatus();
  }, [crawlId, t]);

  async function handleCancel() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/crawl/${crawlId}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        setErrorMessage(data.error || t('cancelFailed'));
      }
    } catch {
      setErrorMessage(t('cancelNetworkError'));
    } finally {
      setCancelling(false);
    }
  }

  // Convert aggregated violations to AxeViolation format for ViolationList
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
      nodes: av.affectedPages.map((ap) => ({
        html: t('instancesOnUrl', { nodeCount: ap.nodeCount, url: ap.url }),
        target: [ap.url],
        impact: av.impact,
      })),
    }));
  }

  if (state === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-red-600">{t('errorTitle')}</h1>
          <p className="text-gray-600">{errorMessage}</p>
          <Link
            href="/"
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {tCommon('tryAgain')}
          </Link>
        </div>
      </div>
    );
  }

  if (state === 'crawling') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8">
        <CrawlProgress crawlId={crawlId} onComplete={handleComplete} onError={handleError} />
        <button
          onClick={handleCancel}
          disabled={cancelling}
          className="mt-4 px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 transition-colors"
        >
          {cancelling ? t('cancelling') : t('cancelCrawl')}
        </button>
      </div>
    );
  }

  if (state === 'results' && crawlData) {
    return (
      <div className="min-h-screen p-8 py-12">
        <div className="w-full max-w-4xl mx-auto space-y-8">
          {/* Header */}
          <header className="text-center space-y-2">
            <h1 className="text-2xl font-bold">{t('siteReportTitle')}</h1>
            <p className="text-gray-600">
              <a href={crawlData.seedUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
                {crawlData.seedUrl}
              </a>
            </p>
            <p className="text-sm text-gray-500">
              {t('pagesScanned', { count: crawlData.completedPageCount })} · {t('started')} {new Date(crawlData.startedAt).toLocaleString()}
            </p>
          </header>

          {/* Actions */}
          <div className="flex justify-center gap-3">
            <a
              href={`/api/crawl/${crawlId}/pdf`}
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

          {/* Site Score */}
          {crawlData.siteScore && (
            <section aria-labelledby="site-score-heading">
              <h2 id="site-score-heading" className="text-xl font-semibold mb-4">{t('executiveSummary')}</h2>
              <SiteScoreDisplay siteScore={crawlData.siteScore} />
            </section>
          )}

          {/* Page Results */}
          <section aria-labelledby="pages-heading">
            <h2 id="pages-heading" className="sr-only">{t('pageResults')}</h2>
            <PageList pages={pages} crawlId={crawlId} />
          </section>

          {/* Aggregated Violations */}
          {crawlData.aggregatedViolations && crawlData.aggregatedViolations.length > 0 && (
            <section aria-labelledby="violations-heading">
              <h2 id="violations-heading" className="sr-only">{t('aggregatedViolations')}</h2>
              <ViolationList violations={toAxeViolations(crawlData)} />
            </section>
          )}
        </div>
      </div>
    );
  }

  return null;
}
