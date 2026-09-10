import type { ScoreResult } from '@/lib/types/score';
import { useTranslations } from 'next-intl';

interface ScoreDisplayProps {
  score: ScoreResult;
}

const gradeColors: Record<string, string> = {
  A: 'text-green-700',
  B: 'text-lime-700',
  C: 'text-yellow-700',
  D: 'text-orange-600',
  F: 'text-red-600',
};

const gradeBgColors: Record<string, string> = {
  A: 'stroke-green-500',
  B: 'stroke-lime-500',
  C: 'stroke-yellow-500',
  D: 'stroke-orange-500',
  F: 'stroke-red-500',
};

export default function ScoreDisplay({ score }: ScoreDisplayProps) {
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (score.overallScore / 100) * circumference;
  const t = useTranslations('ScoreDisplay');

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Score Gauge */}
      <div className="relative">
        <svg width="140" height="140" aria-label={t('scoreLabel', { score: score.overallScore, grade: score.grade })}>
          <circle cx="70" cy="70" r="54" fill="none" stroke="#e5e7eb" strokeWidth="10" className="dark:stroke-gray-700" />
          <circle
            cx="70" cy="70" r="54" fill="none" strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(-90 70 70)"
            className={gradeBgColors[score.grade] || 'stroke-gray-400'}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-3xl font-bold ${gradeColors[score.grade]}`}>{score.overallScore}</span>
          <span className="text-sm text-gray-600">{t('grade', { grade: score.grade })}</span>
        </div>
      </div>

      {/* AODA Badge */}
      <div className={`px-4 py-2 rounded-full text-sm font-medium ${
        score.aodaCompliant
          ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
          : 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
      }`}>
        {score.aodaCompliant ? <><span aria-hidden="true">✓</span> {t('aodaCompliant')}</> : <><span aria-hidden="true">✕</span> {t('needsRemediation')}</>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 text-center text-sm">
        <div>
          <div className="text-2xl font-bold text-red-600" aria-hidden="true">{score.totalViolations}</div>
          <div className="text-gray-600">{t('violations')}</div>
          <div className="text-sm text-gray-600">{t('elementsAffected', { count: score.totalElementViolations })}</div>
          <div className="sr-only">{t('violationsSrOnly', { violations: score.totalViolations, elements: score.totalElementViolations })}</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-green-700 dark:text-green-400" aria-hidden="true">{score.totalPasses}</div>
          <div className="text-gray-600">{t('passedLabel')}</div>
          <div className="sr-only">{t('passedSrOnly', { count: score.totalPasses })}</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-yellow-600" aria-hidden="true">{score.totalIncomplete}</div>
          <div className="text-gray-600">{t('needsReview')}</div>
          <div className="sr-only">{t('needsReviewSrOnly', { count: score.totalIncomplete })}</div>
        </div>
      </div>

      {/* POUR Principle Scores */}
      <div className="w-full max-w-md space-y-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">{t('wcagPrinciples')}</h3>
        {(['perceivable', 'operable', 'understandable', 'robust'] as const).map((principle) => {
          const ps = score.principleScores[principle];
          return (
            <div key={principle} className="flex items-center gap-3">
              <span className="w-32 text-sm capitalize text-gray-600">{principle}</span>
              <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all"
                  style={{ width: `${ps.score}%` }}
                />
              </div>
              <span className="w-12 text-right text-sm font-medium">{ps.score}%</span>
            </div>
          );
        })}
      </div>

      {/* Impact Breakdown */}
      <div className="flex gap-3 flex-wrap justify-center">
        {(['critical', 'serious', 'moderate', 'minor'] as const).map((impact) => {
          const count = score.impactBreakdown[impact].failed;
          const colors: Record<string, string> = {
            critical: 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200',
            serious: 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200',
            moderate: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200',
            minor: 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200',
          };
          return (
            <span key={impact} className={`px-3 py-1 rounded-full text-xs font-medium ${colors[impact]}`}>
              {impact}: {count}
            </span>
          );
        })}
      </div>
    </div>
  );
}
