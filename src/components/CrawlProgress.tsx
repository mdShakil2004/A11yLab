'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CrawlProgressEvent, CrawlStatus, PageSummary } from '@/lib/types/crawl';

interface CrawlProgressProps {
  crawlId: string;
  onComplete: () => void;
  onError: (message: string) => void;
}

const gradeColors: Record<string, string> = {
  A: 'text-green-600 dark:text-green-400',
  B: 'text-lime-600 dark:text-lime-400',
  C: 'text-yellow-600 dark:text-yellow-400',
  D: 'text-orange-600 dark:text-orange-400',
  F: 'text-red-600 dark:text-red-400',
};

const stages = ['pending', 'discovering', 'scanning', 'aggregating', 'complete'] as const;
const POLL_INTERVAL_MS = 1000;
const INITIAL_RETRY_LIMIT = 15;

export default function CrawlProgress({ crawlId, onComplete, onError }: CrawlProgressProps) {
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<CrawlStatus>('pending');
  const [totalPages, setTotalPages] = useState(0);
  const [completedPages, setCompletedPages] = useState(0);
  const [failedPages, setFailedPages] = useState(0);
  const [currentPage, setCurrentPage] = useState<string | undefined>();
  const [recentPages, setRecentPages] = useState<PageSummary[]>([]);
  const t = useTranslations('CrawlProgress');

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let initialRetries = 0;

    const poll = async () => {
      if (stopped) return;

      try {
        const response = await fetch(`/api/crawl/${crawlId}/status`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          // The crawl can start on one warm serverless instance while the
          // first status request is routed elsewhere. Treat an early 404 as
          // transient and retry instead of immediately showing "connection lost".
          if (response.status === 404 && initialRetries < INITIAL_RETRY_LIMIT) {
            initialRetries += 1;
            timer = setTimeout(poll, POLL_INTERVAL_MS);
            return;
          }

          throw new Error(`Status request failed (${response.status})`);
        }

        initialRetries = 0;
        const data: CrawlProgressEvent = await response.json();
        if (stopped) return;

        setProgress(data.progress);
        setMessage(data.message);
        setStatus(data.status);
        setTotalPages(data.totalPages);
        setCompletedPages(data.completedPages);
        setFailedPages(data.failedPages);
        setCurrentPage(data.currentPage);

        if (data.pagesCompleted.length > 0) {
          setRecentPages(data.pagesCompleted.slice(-5));
        }

        if (data.status === 'complete') {
          onComplete();
          return;
        }

        if (data.status === 'error') {
          onError(data.message);
          return;
        }

        if (data.status === 'cancelled') {
          onError(t('cancelled'));
          return;
        }

        timer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (error) {
        if (stopped) return;
        // Network/proxy interruptions are retried. A transient Vercel
        // connection reset should not terminate a long-running crawl UI.
        initialRetries += 1;
        if (initialRetries <= INITIAL_RETRY_LIMIT) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        } else {
          onError(error instanceof Error ? error.message : t('connectionLost'));
        }
      }
    };

    void poll();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [crawlId, onComplete, onError, t]);

  return (
    <div className="w-full max-w-2xl mx-auto p-6">
      <h2 className="text-xl font-semibold mb-4">{t('title')}</h2>

      <div
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('crawlProgress')}
        className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-4 mb-3 overflow-hidden"
      >
        <div
          className="bg-blue-600 h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div aria-live="polite" className="flex justify-between text-sm text-gray-600 mb-2">
        <span>{message || t('initializingCrawl')}</span>
        <span>{progress}%</span>
      </div>

      <div className="flex gap-4 text-sm text-gray-600 mb-4">
        <span>{t('pagesCompleted', { completedPages, totalPages })}</span>
        {failedPages > 0 && (
          <span className="text-red-500">{t('failedCount', { count: failedPages })}</span>
        )}
      </div>

      {currentPage && (
        <div className="text-sm text-gray-600 mb-4 truncate">
          {t('scanning')} <span className="font-mono text-xs">{currentPage}</span>
        </div>
      )}

      <ol className="flex gap-2 text-xs text-gray-600 mb-6 list-none p-0 m-0" aria-label={t('crawlStages')}>
        {stages.map((stage) => (
          <li
            key={stage}
            aria-current={stage === status ? 'step' : undefined}
            className={`px-2 py-1 rounded capitalize ${
              stage === status
                ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium'
                : 'bg-gray-100 dark:bg-gray-800'
            }`}
          >
            {t(`stages.${stage}`)}
          </li>
        ))}
      </ol>

      {recentPages.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('recentlyCompleted')}</h3>
          <ul className="space-y-1">
            {recentPages.map((page) => (
              <li key={page.pageId} className="flex items-center gap-2 text-sm">
                <span className={`font-semibold ${gradeColors[page.grade] || 'text-gray-500'}`}>
                  {page.grade}
                </span>
                <span className="text-gray-500">{page.score}</span>
                <span className="truncate text-gray-600 font-mono text-xs">
                  {page.url}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
