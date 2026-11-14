import { describe, expect, it } from 'vitest';
import { normalizeEntityName, significantEntityTokens } from './entity-name.ts';

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

describe('significantEntityTokens', () => {
  it('keeps the words of at least three characters', () => {
    expect(significantEntityTokens('Jane Doe')).toEqual(['jane', 'doe']);
    expect(significantEntityTokens('EDF')).toEqual(['edf']);
    expect(significantEntityTokens('BP')).toEqual([]);
  });

  it('drops the legal form and the function words', () => {
    expect(significantEntityTokens('Électricité de Synthèse SA')).toEqual([
      'electricite',
      'synthese',
    ]);
    expect(significantEntityTokens('The Bank of the North Ltd')).toEqual(['bank', 'north']);
    expect(significantEntityTokens('Caisse des Dépôts et pour les Autres')).toEqual([
      'caisse',
      'depots',
      'autres',
    ]);
  });
});
