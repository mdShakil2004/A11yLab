import { describe, it, expect } from 'vitest';
import { normalizeUrl, isWithinDomainBoundary, isScannable, matchesPatterns } from '../url-utils';

describe('normalizeUrl', () => {
  it('removes trailing slash from non-root paths', () => {
    expect(normalizeUrl('https://example.com/page/')).toBe('https://example.com/page');
  });

  it('keeps trailing slash for root path', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('strips fragment', () => {
    expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
  });

  it('removes tracking parameters', () => {
    const url = 'https://example.com/page?utm_source=google&utm_medium=cpc&q=test';
    const normalized = normalizeUrl(url);
    expect(normalized).toContain('q=test');
    expect(normalized).not.toContain('utm_source');
    expect(normalized).not.toContain('utm_medium');
  });

  it('removes default port 80 for http', () => {
    expect(normalizeUrl('http://example.com:80/page')).toBe('http://example.com/page');
  });

  it('removes default port 443 for https', () => {
    expect(normalizeUrl('https://example.com:443/page')).toBe('https://example.com/page');
  });

  it('sorts query parameters alphabetically', () => {
    const url = 'https://example.com/page?z=1&a=2&m=3';
    const normalized = normalizeUrl(url);
    expect(normalized).toBe('https://example.com/page?a=2&m=3&z=1');
  });

  it('returns malformed URLs as-is', () => {
    expect(normalizeUrl('not-a-url')).toBe('not-a-url');
  });

  it('lowercases hostname', () => {
    expect(normalizeUrl('https://EXAMPLE.COM/Page')).toBe('https://example.com/Page');
  });
});

describe('isWithinDomainBoundary', () => {
  it('returns true for same hostname with same-hostname strategy', () => {
    expect(isWithinDomainBoundary('https://example.com/page', 'https://example.com/', 'same-hostname')).toBe(true);
  });

  it('returns false for different hostname with same-hostname strategy', () => {
    expect(isWithinDomainBoundary('https://other.com/page', 'https://example.com/', 'same-hostname')).toBe(false);
  });

  it('returns false for subdomain with same-hostname strategy', () => {
    expect(isWithinDomainBoundary('https://blog.example.com/', 'https://example.com/', 'same-hostname')).toBe(false);
  });

  it('returns true for subdomain with same-domain strategy', () => {
    expect(isWithinDomainBoundary('https://blog.example.com/', 'https://example.com/', 'same-domain')).toBe(true);
  });

  it('returns true for same hostname with same-domain strategy', () => {
    expect(isWithinDomainBoundary('https://example.com/page', 'https://example.com/', 'same-domain')).toBe(true);
  });

  it('returns false for different domain with same-domain strategy', () => {
    expect(isWithinDomainBoundary('https://other.com/page', 'https://example.com/', 'same-domain')).toBe(false);
  });

  it('returns false for malformed URLs', () => {
    expect(isWithinDomainBoundary('not-a-url', 'https://example.com/', 'same-hostname')).toBe(false);
  });
});

describe('isScannable', () => {
  it.each([
    'https://example.com/',
    'https://example.com/page',
    'http://example.com/about',
    'https://example.com/page.html',
  ])('returns true for scannable URL: %s', (url) => {
    expect(isScannable(url)).toBe(true);
  });

  it.each([
    'mailto:user@example.com',
    'tel:+1234567890',
    'javascript:void(0)',
    'ftp://example.com/file',
  ])('returns false for non-http(s) URL: %s', (url) => {
    expect(isScannable(url)).toBe(false);
  });

  it.each([
    'https://example.com/file.pdf',
    'https://example.com/image.jpg',
    'https://example.com/image.png',
    'https://example.com/style.css',
    'https://example.com/script.js',
    'https://example.com/data.json',
    'https://example.com/archive.zip',
  ])('returns false for non-scannable extension: %s', (url) => {
    expect(isScannable(url)).toBe(false);
  });

  it('returns false for malformed URLs', () => {
    expect(isScannable('not-a-url')).toBe(false);
  });
});

describe('matchesPatterns', () => {
  it('allows all URLs when include patterns are empty', () => {
    expect(matchesPatterns('https://example.com/page', [], [])).toBe(true);
  });

  it('excludes URL when exclude pattern matches', () => {
    expect(matchesPatterns('https://example.com/admin', [], ['**/admin'])).toBe(false);
  });

  it('exclude takes precedence over include', () => {
    expect(matchesPatterns(
      'https://example.com/admin',
      ['https://example.com/**'],
      ['**/admin']
    )).toBe(false);
  });

  it('allows URL matching include pattern', () => {
    expect(matchesPatterns(
      'https://example.com/blog/post',
      ['https://example.com/blog/**'],
      []
    )).toBe(true);
  });

  it('rejects URL not matching any include pattern', () => {
    expect(matchesPatterns(
      'https://example.com/about',
      ['https://example.com/blog/**'],
      []
    )).toBe(false);
  });

  it('matches glob patterns with wildcard', () => {
    expect(matchesPatterns(
      'https://example.com/page',
      ['https://example.com/*'],
      []
    )).toBe(true);
  });
});
