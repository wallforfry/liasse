import { describe, expect, it } from 'vitest';
import { entityNameKey, normalizeEntityName, significantEntityTokens } from './entity-name.ts';

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

  it('keeps the letters and digits of every script', () => {
    expect(normalizeEntityName('Ромашка LLC')).toEqual(['ромашка']);
    expect(normalizeEntityName('中国银行 2024')).toEqual(['中国银行', '2024']);
    expect(normalizeEntityName('Ελληνική Τράπεζα SA')).toEqual(['ελληνικη', 'τραπεζα']);
  });

  it('gives no token for a name without any letter or digit', () => {
    expect(normalizeEntityName('***')).toEqual([]);
  });
});

describe('entityNameKey', () => {
  it('is the same for two spellings of one name', () => {
    expect(entityNameKey('Électricité de Synthèse S.A.')).toBe('electricite de synthese');
    expect(entityNameKey('ELECTRICITE DE SYNTHESE')).toBe(
      entityNameKey('Électricité de Synthèse SA'),
    );
  });

  it.each([
    ['Ромашка LLC', 'Лютик LLC'],
    ['Газпром AG', 'Роснефть AG'],
    ['中国银行 2024', '工商银行 2024'],
    ['Ελληνική Τράπεζα SA', 'SA'],
  ])('keeps %s and %s apart', (left, right) => {
    expect(entityNameKey(left)).not.toBe(entityNameKey(right));
  });

  it('is the same for two spellings of a name in another script', () => {
    expect(entityNameKey('РОМАШКА llc')).toBe(entityNameKey('Ромашка LLC'));
  });

  it('keeps apart two names that have no letter or digit', () => {
    expect(entityNameKey('***')).not.toBe(entityNameKey('---'));
  });

  it('keeps apart two names in a script without ASCII letters', () => {
    expect(entityNameKey(' Синтез ')).toBe('синтез');
    expect(entityNameKey('Синтез')).not.toBe(entityNameKey('Энергия'));
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
