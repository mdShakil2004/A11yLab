/**
 * Ambient module declarations for the @siteimprove/alfa-* ACT-Rules packages.
 *
 * WHY THIS EXISTS (Phase E spike):
 * The Alfa packages are declared as `optionalDependencies` and live behind
 * GitHub Packages authentication. During the spike they are NOT installed, so
 * `await import('@siteimprove/alfa-act')` would otherwise fail typechecking
 * with "Cannot find module". These minimal, intentionally-narrow declarations
 * let `src/lib/scanner/engine.ts#runAlfa` compile WITHOUT resorting to `any`.
 *
 * SCOPE: only the surface that `runAlfa` actually touches is declared. The
 * runtime behaviour is fully guarded by a try/catch that returns [] when the
 * packages are absent, so an imperfect surface here cannot break production.
 *
 * PIN-TIME ACTION: once a `read:packages` token resolves the real packages,
 * delete this file (the shipped types take over) and reconcile `runAlfa`
 * against the real Audit / Playwright / rules API.
 */

declare module '@siteimprove/alfa-act' {
  /** Single ACT-Rules evaluation result (Alfa Outcome, flattened surface). */
  export interface AlfaOutcome {
    /** Outcome value: enum, string, or wrapped object — coerced at runtime. */
    outcome: unknown;
    /** The rule that produced this outcome. */
    rule?: { uri?: string };
  }

  export interface AlfaAudit {
    evaluate(): Promise<Iterable<AlfaOutcome>>;
  }

  export const Audit: {
    of(page: unknown, rules: unknown): AlfaAudit;
  };
}

declare module '@siteimprove/alfa-rules' {
  const rules: unknown;
  export default rules;
}

declare module '@siteimprove/alfa-playwright' {
  export const Playwright: {
    /** Convert a Playwright JSHandle<Document> into an Alfa Page. */
    toPage(handle: unknown): unknown;
  };
}
