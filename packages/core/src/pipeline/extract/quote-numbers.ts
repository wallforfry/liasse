// Spaces that separate thousands in print: no-break, narrow no-break and thin spaces,
// and the apostrophe of Swiss usage.
const GROUP_SPACES = /[\u00a0\u202f\u2009'\u2019]/g;
const MINUS = /[−‒–]/g;

// A run of digits with what may separate thousands or decimals inside it.
const NUMBER_RUN = /-?\d(?:[\d., ]*\d)?/g;

const hasValidGroups = (groups: readonly string[]): boolean => {
  const [first, ...rest] = groups;
  return (
    first !== undefined && /^\d{1,3}$/.test(first) && rest.every((group) => /^\d{3}$/.test(group))
  );
};

// One way to read `text` as a number, with `decimal` as the decimal mark and `thousands`
// as the separator of groups; undefined when the groups do not fit.
const readAs = (text: string, decimal: string | undefined, thousands: string | undefined) => {
  const [whole = '', fraction, extra] = decimal === undefined ? [text] : text.split(decimal);
  if (extra !== undefined || fraction === '') return undefined;
  const groups = thousands === undefined ? [whole] : whole.split(thousands);
  if (thousands !== undefined && !hasValidGroups(groups)) return undefined;
  if (groups.some((group) => !/^\d+$/.test(group))) return undefined;
  return Number(`${groups.join('')}${fraction === undefined ? '' : `.${fraction}`}`);
};

// A comma or a point alone is a decimal mark, or the separator of thousands when three
// digits follow it ("8,420" is 8420 in English and 8.42 elsewhere): both readings count.
const readCompact = (text: string): readonly number[] => {
  const commas = text.split(',').length - 1;
  const points = text.split('.').length - 1;
  if (commas > 0 && points > 0) {
    const decimal = text.lastIndexOf(',') > text.lastIndexOf('.') ? ',' : '.';
    const reading = readAs(text, decimal, decimal === ',' ? '.' : ',');
    return reading === undefined ? [] : [reading];
  }
  const mark = commas > 0 ? ',' : points > 0 ? '.' : undefined;
  if (mark === undefined) return [Number(text)];
  const count = Math.max(commas, points);
  const readings =
    count > 1
      ? [readAs(text, undefined, mark)]
      : [readAs(text, mark, undefined), readAs(text, undefined, mark)];
  return readings.filter((reading) => reading !== undefined);
};

// A run with spaces is either one number grouped by them, or several numbers.
const readRun = (run: string): readonly number[] => {
  const pieces = run.split(' ').filter((piece) => piece !== '');
  const joined = pieces.join('');
  const grouped =
    pieces.length > 1 &&
    hasValidGroups([...pieces.slice(0, -1), (pieces.at(-1) ?? '').replace(/[.,]\d+$/, '')])
      ? readCompact(joined)
      : [];
  return [...grouped, ...pieces.flatMap(readCompact)];
};

/**
 * Every number `text` may state, as magnitudes: a sign is rarely written as a minus (a
 * credit note says "Avoir 84,20"), so the sign of a value is not compared.
 */
export const numbersIn = (text: string): readonly number[] =>
  [...text.replace(GROUP_SPACES, ' ').replace(MINUS, '-').matchAll(NUMBER_RUN)].flatMap(([run]) =>
    readRun(run.replace(/^-/, '')).filter(Number.isFinite),
  );

const sameNumber = (left: number, right: number): boolean =>
  Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left));

export const statesNumber = (numbers: readonly number[], value: number): boolean =>
  numbers.some((number) => sameNumber(number, Math.abs(value)));
