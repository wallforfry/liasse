const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i;

// The significant digits of a decimal and the power of ten of the last one: the same
// for `1200`, `1.2e3` and `1200.00`.
const significand = (text: string): string | undefined => {
  const match = DECIMAL.exec(text);
  if (match === null) return undefined;
  const [, sign = '', whole = '', fraction = '', exponent = '0'] = match;
  const digits = `${whole}${fraction}`.replace(/^0+/, '');
  const significant = digits.replace(/0+$/, '');
  if (significant === '') return '0';
  const power = Number(exponent) - fraction.length + (digits.length - significant.length);
  return `${sign}${significant}e${String(power)}`;
};

// The number a `numeric` written as text stands for, when a double holds exactly that
// value; otherwise the text itself, which is its exact decimal form. A double holds
// about seventeen significant digits and nothing past 1.8e308: beyond either, turning the
// text into a number would silently change the value.
export const exactNumberOrText = (text: string): number | string => {
  const number = Number(text);
  return Number.isFinite(number) && significand(String(number)) === significand(text)
    ? number
    : text;
};

// The double nearest to the text, or the text when no double is near. For a value that
// is an approximation to begin with, such as an average.
export const nearestNumberOrText = (text: string): number | string => {
  const number = Number(text);
  return Number.isFinite(number) ? number : text;
};
