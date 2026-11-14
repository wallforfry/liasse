import { describe, expect, it } from 'vitest';
import { normalizeEntityName } from './entity-name.ts';

describe('normalizeEntityName', () => {
  it('lowercases, removes accents and splits on anything that is not a letter or a digit', () => {
    expect(normalizeEntityName('Électricité  de-Synthèse')).toEqual([
      'electricite',
      'de',
      'synthese',
    ]);
  });

  it.each([
    ['Synthetic Energy SA', ['synthetic', 'energy']],
    ['Synthetic Energy S.A.', ['synthetic', 'energy']],
    ['SARL Synthetic Energy', ['synthetic', 'energy']],
    ['Acme Widgets Inc.', ['acme', 'widgets']],
    ['Acme Widgets GmbH', ['acme', 'widgets']],
  ])('removes the legal form around %s', (name, tokens) => {
    expect(normalizeEntityName(name)).toEqual(tokens);
  });

  it('keeps a legal-form word inside the name', () => {
    expect(normalizeEntityName('Banque SA Synthèse')).toEqual(['banque', 'sa', 'synthese']);
  });

  it('keeps a name made only of legal-form words', () => {
    expect(normalizeEntityName('SA')).toEqual(['sa']);
  });

  it('gives no token for a name without any ASCII letter or digit', () => {
    expect(normalizeEntityName('***')).toEqual([]);
  });
});
