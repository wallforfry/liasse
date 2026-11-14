const doubled = (digit: number): number => (digit > 4 ? digit * 2 - 9 : digit * 2);

const passesLuhn = (digits: string): boolean =>
  Array.from(digits)
    .toReversed()
    .map(Number)
    .reduce((sum, digit, index) => sum + (index % 2 === 1 ? doubled(digit) : digit), 0) %
    10 ===
  0;

interface CardRange {
  readonly prefix: RegExp;
  readonly lengths: readonly number[];
}

// The issuer ranges of the payment networks and the lengths each one issues. The Luhn
// check alone accepts one number in ten, and every French SIRET, which is 14 digits long
// and Luhn-valid by construction: the 14-digit cards (Diners Club) are left out so that a
// company identifier is never taken for a card.
const CARD_RANGES: readonly CardRange[] = [
  { prefix: /^4/, lengths: [16, 19] },
  { prefix: /^5[1-5]/, lengths: [16] },
  { prefix: /^2(22[1-9]|2[3-9]|[3-6]|7[01]|720)/, lengths: [16] },
  { prefix: /^3[47]/, lengths: [15] },
  { prefix: /^35/, lengths: [16] },
  { prefix: /^(5[06-8]|6)/, lengths: [16, 17, 18, 19] },
];

export const CARD_NUMBER_LENGTHS: readonly number[] = [
  ...new Set(CARD_RANGES.flatMap(({ lengths }) => lengths)),
].toSorted((left, right) => left - right);

// Takes the digits of a card number, without separators.
export const isValidCardNumber = (digits: string): boolean =>
  /^\d+$/.test(digits) &&
  CARD_RANGES.some(
    ({ prefix, lengths }) => prefix.test(digits) && lengths.includes(digits.length),
  ) &&
  passesLuhn(digits);
