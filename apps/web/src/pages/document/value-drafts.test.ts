import { describe, expect, it } from 'vitest';
import { draftOfValue, editorOfValue, readValueDraft } from './value-drafts.ts';

describe('value drafts', () => {
  it('guesses an editor from the shape of a value', () => {
    expect(
      [
        'text',
        '2026-12-01',
        4,
        true,
        { value: 1, currency: 'EUR' },
        { start: '2026-01-01', end: '2026-01-31' },
        ['a'],
      ].map((value) => editorOfValue(value).kind),
    ).toEqual(['text', 'date', 'number', 'boolean', 'money', 'period', 'json']);
  });

  it('reads back the value a draft was made from', () => {
    const values = [
      [{ kind: 'money' }, { value: 12.5, currency: 'EUR' }],
      [{ kind: 'period' }, { start: '2026-01-01', end: '2026-01-31' }],
      [{ kind: 'boolean' }, false],
      [{ kind: 'json' }, [{ a: 1 }]],
    ] as const;
    expect(
      values.map(([editor, value]) => readValueDraft(editor, draftOfValue(editor, value))),
    ).toEqual(values.map(([, value]) => ({ ok: true, value })));
  });

  it('reads empty inputs as a cleared value, and a half-filled amount as an error', () => {
    expect(readValueDraft({ kind: 'number' }, { kind: 'single', text: ' ' })).toEqual({
      ok: true,
      value: null,
    });
    expect(
      readValueDraft({ kind: 'money' }, { kind: 'money', amount: '', currency: 'eur' }),
    ).toMatchObject({ ok: false });
    expect(
      readValueDraft({ kind: 'money' }, { kind: 'money', amount: '3', currency: 'eur' }),
    ).toEqual({ ok: true, value: { value: 3, currency: 'EUR' } });
  });

  it('refuses a date that is not a calendar day and an enum value that is not listed', () => {
    expect(readValueDraft({ kind: 'date' }, { kind: 'single', text: '2026-02-30' })).toMatchObject({
      ok: false,
    });
    expect(
      readValueDraft({ kind: 'enum', values: ['basic'] }, { kind: 'single', text: 'peak' }),
    ).toEqual({ ok: false, error: 'expected one of the listed values' });
  });
});
