import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from '@/i18n/routing';
import { createLogger } from '@/lib/logger';

const log = createLogger('http');
const handleI18nRouting = createMiddleware(routing);

export function middleware(request: NextRequest) {
  const start = Date.now();
  const { method, url } = request;
  const pathname = new URL(url).pathname;

  // Skip i18n for API routes — let them pass through with logging only
  if (pathname.startsWith('/api')) {
    const response = NextResponse.next();
    const duration = Date.now() - start;
    log.info(`${method} ${pathname}`, {
      method,
      pathname,
      status: response.status,
      durationMs: duration,
      userAgent: request.headers.get('user-agent') ?? undefined,
    });
    return response;
  }

  // For UI routes: apply i18n routing (locale detection, redirect)
  const response = handleI18nRouting(request);
  const duration = Date.now() - start;
  log.info(`${method} ${pathname}`, {
    method,
    pathname,
    status: response.status,
    durationMs: duration,
    userAgent: request.headers.get('user-agent') ?? undefined,
  });
  return response;
}

export const config = {
  matcher: ['/((?!_next|_vercel|.*\\..*).*)'],
};
