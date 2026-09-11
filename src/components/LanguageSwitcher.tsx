'use client';

import { Link, usePathname } from '@/i18n/navigation';
import { useLocale, useTranslations } from 'next-intl';

export default function LanguageSwitcher() {
  const locale = useLocale();
  const t = useTranslations('Common');
  const pathname = usePathname();

  return (
    <nav aria-label={t('languageSelection')}>
      {locale === 'en' ? (
        <Link
          href={pathname}
          locale="fr"
          lang="fr"
          hrefLang="fr"
          className="px-3 py-1.5 text-sm font-medium text-blue-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          ay11-lab
        </Link>
      ) : (
        <Link
          href={pathname}
          locale="en"
          lang="en"
          hrefLang="en"
          className="px-3 py-1.5 text-sm font-medium text-blue-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          English
        </Link>
      )}
    </nav>
  );
}
