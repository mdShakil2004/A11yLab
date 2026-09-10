export type WcagPrinciple = 'perceivable' | 'operable' | 'understandable' | 'robust' | 'best-practice';

export function mapTagToPrinciple(tags: string[]): WcagPrinciple {
  const wcagTag = tags.find(t => /^wcag\d{3,}$/.test(t));
  if (!wcagTag) return 'best-practice';

  const firstDigit = wcagTag.charAt(4);
  switch (firstDigit) {
    case '1': return 'perceivable';
    case '2': return 'operable';
    case '3': return 'understandable';
    case '4': return 'robust';
    default: return 'best-practice';
  }
}

export function getPrincipleLabel(principle: WcagPrinciple): string {
  const labels: Record<WcagPrinciple, string> = {
    perceivable: 'Perceivable',
    operable: 'Operable',
    understandable: 'Understandable',
    robust: 'Robust',
    'best-practice': 'Best Practice',
  };
  return labels[principle];
}
