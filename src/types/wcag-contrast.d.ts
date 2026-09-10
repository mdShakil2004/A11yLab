// Ambient type declarations for `wcag-contrast` (^3.0.0), which ships no types.
// Used by the OCR rendered-text-contrast probe in custom-checks.ts.
declare module 'wcag-contrast' {
  /** Contrast ratio (1–21) between two [r, g, b] colors (0–255 each). Symmetric. */
  export function rgb(rgb1: number[], rgb2: number[]): number;
  /** Contrast ratio between two hex color strings (e.g. "#fff", "000000"). */
  export function hex(hex1: string, hex2: string): number;
  /** Relative luminance for an [r, g, b] array or three channel args. */
  export function luminance(r: number | number[], g?: number, b?: number): number;
  /** WCAG conformance label ("AAA" | "AA" | "AA Large" | "Fail") for a ratio. */
  export function score(ratio: number): string;
}
