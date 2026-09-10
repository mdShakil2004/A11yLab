import { describe, it, expect } from 'vitest';
import { mapTagToPrinciple, getPrincipleLabel, type WcagPrinciple } from '../wcag-mapper';

describe('mapTagToPrinciple', () => {
  it.each([
    { tags: ['wcag111'], expected: 'perceivable' as const, label: 'wcag111 → perceivable' },
    { tags: ['wcag143'], expected: 'perceivable' as const, label: 'wcag143 → perceivable' },
    { tags: ['wcag211'], expected: 'operable' as const, label: 'wcag211 → operable' },
    { tags: ['wcag244'], expected: 'operable' as const, label: 'wcag244 → operable' },
    { tags: ['wcag311'], expected: 'understandable' as const, label: 'wcag311 → understandable' },
    { tags: ['wcag312'], expected: 'understandable' as const, label: 'wcag312 → understandable' },
    { tags: ['wcag411'], expected: 'robust' as const, label: 'wcag411 → robust' },
    { tags: ['wcag412'], expected: 'robust' as const, label: 'wcag412 → robust' },
  ])('$label', ({ tags, expected }) => {
    expect(mapTagToPrinciple(tags)).toBe(expected);
  });

  it('returns best-practice when no WCAG tag found', () => {
    expect(mapTagToPrinciple(['best-practice', 'cat.structure'])).toBe('best-practice');
  });

  it('returns best-practice for empty array', () => {
    expect(mapTagToPrinciple([])).toBe('best-practice');
  });

  it('picks the first matching WCAG tag from multiple tags', () => {
    expect(mapTagToPrinciple(['cat.color', 'wcag211', 'wcag311'])).toBe('operable');
  });

  it('ignores non-matching tags and finds the WCAG tag', () => {
    expect(mapTagToPrinciple(['best-practice', 'cat.name-role-value', 'wcag412'])).toBe('robust');
  });

  it('returns best-practice for WCAG tags that do not match the pattern', () => {
    // wcag2a has letters after digits — doesn't match /^wcag\d{3,}$/
    expect(mapTagToPrinciple(['wcag2a', 'wcag2aa'])).toBe('best-practice');
  });

  it('returns best-practice for unknown first digit', () => {
    // wcag511 has first digit 5
    expect(mapTagToPrinciple(['wcag511'])).toBe('best-practice');
  });
});

describe('getPrincipleLabel', () => {
  it.each([
    { principle: 'perceivable' as WcagPrinciple, expected: 'Perceivable' },
    { principle: 'operable' as WcagPrinciple, expected: 'Operable' },
    { principle: 'understandable' as WcagPrinciple, expected: 'Understandable' },
    { principle: 'robust' as WcagPrinciple, expected: 'Robust' },
    { principle: 'best-practice' as WcagPrinciple, expected: 'Best Practice' },
  ])('returns "$expected" for "$principle"', ({ principle, expected }) => {
    expect(getPrincipleLabel(principle)).toBe(expected);
  });
});
