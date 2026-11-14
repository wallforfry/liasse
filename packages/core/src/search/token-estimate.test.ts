import { describe, expect, it } from 'vitest';
import { estimateTokens } from './token-estimate.ts';

describe('estimateTokens', () => {
  it.each([
    ['', 0],
    [' \n\t ', 0],
    ['facture', 3],
    ['FACTURE', 4],
    ['électricité', 4],
    ['2026-09-12', 7],
    ['счёт', 2],
    ['合同生效', 4],
    ['계약', 2],
  ])('estimates %j at %i tokens', (text, tokens) => {
    expect(estimateTokens(text)).toBe(tokens);
  });

  it('adds up over a text, whitespace being free', () => {
    expect(estimateTokens('facture '.repeat(100))).toBe(210);
  });

  // Measured with the tokenizer of multilingual-e5-small on eight repetitions of one line.
  it.each([
    [
      'French prose',
      'La facture d’électricité du mois de septembre est à régler avant le 18 octobre. ',
      145,
    ],
    [
      'an invoice line',
      'REF-2026-000187 | 12/09/2026 | Abonnement 9 kVA | 3 x 12,48 EUR | TVA 5,5 %\n',
      265,
    ],
    ['Chinese', '本合同自二零二六年九月一日起生效，租金每月支付一次。', 152],
  ])('stays above the real count for %s', (_, line, measured) => {
    expect(estimateTokens(line.repeat(8))).toBeGreaterThanOrEqual(measured);
    expect(estimateTokens(line.repeat(8))).toBeLessThan(measured * 2);
  });
});
