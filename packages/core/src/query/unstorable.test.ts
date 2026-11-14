import { describe, expect, it } from 'vitest';
import { parseQueryDsl } from './dsl.ts';

const NUL = '\u0000';

const errorsOf = (input: unknown) => {
  const parsed = parseQueryDsl(input);
  if (parsed.ok) throw new Error('The query was accepted');
  return parsed.error;
};

// Postgres text cannot hold a NUL character: a query carrying one would fail in the
// database, with nothing to tell the caller which value to correct.
describe('a NUL character in a query', () => {
  it.each([
    [{ where: [['title', '=', `a${NUL}b`]] }, ['where', 0, 2]],
    [{ where: [['core.issuer', 'in', ['Volta', `x${NUL}`]]] }, ['where', 0, 2, 1]],
    [
      { where: [['core.amount', '=', { value: 1, currency: `EU${NUL}R` }]] },
      ['where', 0, 2, 'currency'],
    ],
    [{ type: `energy${NUL}bill` }, ['type']],
    [{ where: [[`core.${NUL}issuer`, 'exists', true]] }, ['where', 0, 0]],
    [{ select: [`fields.${NUL}`] }, ['select', 0]],
  ])('is refused where it is (%#)', (input, path) => {
    expect(errorsOf(input)).toEqual([
      {
        code: 'invalid_query',
        path,
        message: 'This text holds a NUL character, which cannot be stored or compared.',
      },
    ]);
  });

  it('is reported once per place, at every place', () => {
    const errors = errorsOf({
      type: NUL,
      where: [
        ['title', '=', NUL],
        ['title', 'in', [NUL, 'ok', NUL]],
      ],
    });
    expect(errors.map(({ path }) => path)).toEqual([
      ['type'],
      ['where', 0, 2],
      ['where', 1, 2, 0],
      ['where', 1, 2, 2],
    ]);
  });

  it('does not stop a query whose text holds none, however deep its value', () => {
    const deep = Array.from({ length: 100_000 }).reduce<unknown>((inner) => [inner], 'ok');
    expect(parseQueryDsl({ where: [['title', '=', deep]] }).ok).toBe(true);
  });
});
