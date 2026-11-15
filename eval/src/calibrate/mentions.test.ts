import { describe, expect, it } from 'vitest';
import { entityMentionsOf } from './mentions.ts';

const entities = [
  {
    key: 'energy',
    kind: 'org' as const,
    canonical_name: 'Synthetic Energy',
    aliases: ['Synthetic'],
    identifiers: [],
  },
  { key: 'cycles', kind: 'org' as const, canonical_name: 'SE', aliases: [], identifiers: [] },
];

const document = (id: string, text: string, duplicateOf: string | null = null) => ({
  id,
  duplicate_of: duplicateOf,
  pages: [{ page: 1, method: 'native' as const, text }],
});

describe('entityMentionsOf', () => {
  it('embeds a name as the document writes it, with the line that holds it', () => {
    const [mention, ...others] = entityMentionsOf({
      entities,
      documents: [document('bill', 'Invoice\nSYNTHETIC ENERGY SAS - 1 synthetic street\n')],
    });
    expect(others).toEqual([]);
    expect(mention).toEqual({
      document: 'bill',
      entity: 'energy',
      kind: 'org',
      name: 'SYNTHETIC ENERGY',
      text: 'SYNTHETIC ENERGY\nSYNTHETIC ENERGY SAS - 1 synthetic street',
    });
  });

  it('takes the next line as context when the line holds the name alone', () => {
    const mentions = entityMentionsOf({
      entities,
      documents: [document('bill', 'Synthetic Energy\n\nElectricity bill\n')],
    });
    expect(mentions.map(({ text }) => text)).toEqual(['Synthetic Energy\nElectricity bill']);
  });

  it('counts a shorter name on a line of its own, never inside a word or a longer name', () => {
    const mentions = entityMentionsOf({
      entities,
      documents: [document('letter', 'Synthetic Energy, SEPTEMBER\nCall Synthetic today')],
    });
    expect(mentions.map(({ name, text }) => [name, text])).toEqual([
      ['Synthetic Energy', 'Synthetic Energy\nSynthetic Energy, SEPTEMBER'],
      ['Synthetic', 'Synthetic\nCall Synthetic today'],
    ]);
  });

  it('leaves out a duplicate document', () => {
    const text = 'Synthetic Energy SAS';
    expect(
      entityMentionsOf({
        entities,
        documents: [document('original', text), document('copy', text, 'original')],
      }).map(({ document: id }) => id),
    ).toEqual(['original']);
  });
});
