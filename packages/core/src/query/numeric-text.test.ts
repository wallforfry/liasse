import { describe, expect, it } from 'vitest';
import { exactNumberOrText, nearestNumberOrText } from './numeric-text.ts';

describe('numbers written as the text of a numeric', () => {
  it.each([
    ['0', 0],
    ['22', 22],
    ['-7', -7],
    ['2.5', 2.5],
    ['84.20', 84.2],
    ['5.5000000000000000', 5.5],
    ['0.1', 0.1],
    ['0.000001', 0.000001],
    ['0.0000001', 1e-7],
    ['1200', 1200],
    ['9007199254740992', 9007199254740992],
    [`1${'0'.repeat(308)}`, 1e308],
    [`1${'0'.repeat(21)}`, 1e21],
  ])('reads %s as a number, a double holding exactly that value', (text, number) => {
    expect(exactNumberOrText(text)).toBe(number);
  });

  it.each([
    '12345678901234567890.123456789',
    '9007199254740993',
    '0.1000000000000000055511151231257827',
    '1.6666666666666666667',
    `2${'0'.repeat(308)}`,
    `-1${'0'.repeat(400)}`,
  ])('keeps %s as text, no double holding exactly that value', (text) => {
    expect(exactNumberOrText(text)).toBe(text);
  });

  it('takes the nearest double of an approximation, and the text past the range', () => {
    expect(nearestNumberOrText('1.6666666666666666667')).toBe(5 / 3);
    expect(nearestNumberOrText('5.5000000000000000')).toBe(5.5);
    expect(nearestNumberOrText(`1${'0'.repeat(400)}`)).toBe(`1${'0'.repeat(400)}`);
  });
});
