import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the scanner so the route never launches a real browser. parseAxeResults
// is mocked to a minimal parsed shape the route consumes.
const { mockScanUrl, mockParseAxeResults } = vi.hoisted(() => ({
  mockScanUrl: vi.fn(),
  mockParseAxeResults: vi.fn(),
}));

vi.mock('@/lib/scanner/engine', () => ({
  scanUrl: mockScanUrl,
}));

vi.mock('@/lib/scanner/result-parser', () => ({
  parseAxeResults: mockParseAxeResults,
}));

import { POST } from '../route';
import type { ScanState } from '@/lib/types/scan';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('https://app.example.com/api/ci/scan', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const VALID_URL = 'https://example.com';

beforeEach(() => {
  vi.clearAllMocks();
  mockScanUrl.mockResolvedValue({
    violations: [],
    passes: [],
    incomplete: [],
    inapplicable: [],
    engineVersions: { 'axe-core': '4.10.0' },
  });
  mockParseAxeResults.mockReturnValue({
    score: { overallScore: 95, grade: 'A' },
    violations: [],
    incomplete: [],
    engineVersion: '4.10.0',
  });
});

describe('POST /api/ci/scan — states validation', () => {
  it('accepts a valid states payload and forwards it to scanUrl', async () => {
    const states: ScanState[] = [
      {
        name: 'dialog-open',
        actions: [
          { click: '#open' },
          { waitFor: '#dialog' },
          { fill: { selector: '#email', value: 'a@b.com' } },
          { press: 'Enter' },
        ],
        includeSelector: '#dialog',
      },
    ];

    const res = await POST(makeRequest({ url: VALID_URL, states }));

    expect(res.status).toBe(200);
    expect(mockScanUrl).toHaveBeenCalledTimes(1);
    // scanUrl(url, onProgress, auth, states) — states is the 4th argument.
    expect(mockScanUrl.mock.calls[0][3]).toEqual(states);
  });

  it('works without a states payload (states arg is undefined)', async () => {
    const res = await POST(makeRequest({ url: VALID_URL }));

    expect(res.status).toBe(200);
    expect(mockScanUrl).toHaveBeenCalledTimes(1);
    expect(mockScanUrl.mock.calls[0][3]).toBeUndefined();
  });

  it('rejects more than 20 states with 400 and does not scan', async () => {
    const states = Array.from({ length: 21 }, (_, i) => ({ name: `s${i}`, actions: [] }));

    const res = await POST(makeRequest({ url: VALID_URL, states }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('at most 20');
    expect(mockScanUrl).not.toHaveBeenCalled();
  });

  it('rejects a state with more than 30 actions', async () => {
    const states = [
      { name: 'too-many', actions: Array.from({ length: 31 }, () => ({ click: '#x' })) },
    ];

    const res = await POST(makeRequest({ url: VALID_URL, states }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('exceeds 30 actions');
    expect(mockScanUrl).not.toHaveBeenCalled();
  });

  it('rejects an action with an unknown key', async () => {
    const states = [{ name: 's1', actions: [{ hover: '#x' }] }];

    const res = await POST(makeRequest({ url: VALID_URL, states }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('invalid action');
    expect(mockScanUrl).not.toHaveBeenCalled();
  });

  it('rejects an action with a non-string value', async () => {
    const states = [{ name: 's1', actions: [{ click: 123 }] }];

    const res = await POST(makeRequest({ url: VALID_URL, states }));

    expect(res.status).toBe(400);
    expect(mockScanUrl).not.toHaveBeenCalled();
  });

  it('rejects a fill action missing selector or value', async () => {
    const states = [{ name: 's1', actions: [{ fill: { selector: '#x' } }] }];

    const res = await POST(makeRequest({ url: VALID_URL, states }));

    expect(res.status).toBe(400);
    expect(mockScanUrl).not.toHaveBeenCalled();
  });

  it('rejects an action object with multiple keys', async () => {
    const states = [{ name: 's1', actions: [{ click: '#x', press: 'Enter' }] }];

    const res = await POST(makeRequest({ url: VALID_URL, states }));

    expect(res.status).toBe(400);
    expect(mockScanUrl).not.toHaveBeenCalled();
  });

  it('rejects a state missing a name', async () => {
    const states = [{ actions: [] }];

    const res = await POST(makeRequest({ url: VALID_URL, states }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('non-empty "name"');
    expect(mockScanUrl).not.toHaveBeenCalled();
  });

  it('rejects a non-string includeSelector', async () => {
    const states = [{ name: 's1', actions: [], includeSelector: 42 }];

    const res = await POST(makeRequest({ url: VALID_URL, states }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('includeSelector');
    expect(mockScanUrl).not.toHaveBeenCalled();
  });

  it('rejects states that is not an array', async () => {
    const res = await POST(makeRequest({ url: VALID_URL, states: 'nope' }));

    expect(res.status).toBe(400);
    expect(mockScanUrl).not.toHaveBeenCalled();
  });
});

describe('POST /api/ci/scan — base request validation', () => {
  it('rejects a missing url', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(mockScanUrl).not.toHaveBeenCalled();
  });

  it('rejects a private/SSRF url', async () => {
    const res = await POST(makeRequest({ url: 'http://localhost:3000' }));
    expect(res.status).toBe(400);
    expect(mockScanUrl).not.toHaveBeenCalled();
  });

  it('rejects an invalid JSON body', async () => {
    const req = new NextRequest('https://app.example.com/api/ci/scan', {
      method: 'POST',
      body: 'not-json',
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
