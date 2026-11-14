import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { documentPages } from './schema/documents.ts';

describe('language-aware full text', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  const value = async (query: ReturnType<typeof sql>): Promise<unknown> =>
    (await database.db.execute(query))[0]?.value;

  const matches = (
    language: string | null,
    content: string,
    languages: readonly (string | null)[],
    query: string,
  ): Promise<unknown> =>
    value(sql`
      SELECT liasse_tsvector(${language}, ${content})
        @@ liasse_tsquery(${sql.param(languages)}::text[], ${query}) AS value
    `);

  it('keeps every word, unaccented, when the language is unknown', async () => {
    expect(
      await value(sql`SELECT liasse_tsvector(NULL, 'Électricité: the Août bills')::text AS value`),
    ).toBe("'aout':3 'bills':4 'electricite':1 'the':2");
  });

  it('falls back to the simple configuration for a language without a stemmer', async () => {
    expect(await value(sql`SELECT liasse_regconfig('zz')::text AS value`)).toBe('liasse_simple');
    expect(await value(sql`SELECT liasse_regconfig(NULL)::text AS value`)).toBe('liasse_simple');
  });

  it.each([
    ['fr', 'liasse_fr'],
    ['en', 'liasse_en'],
    ['de', 'liasse_de'],
  ])('maps %s to its own configuration', async (language, config) => {
    expect(await value(sql`SELECT liasse_regconfig(${language})::text AS value`)).toBe(config);
  });

  it('stems and unaccents French', async () => {
    expect(
      await value(
        sql`SELECT liasse_tsvector('fr', 'Les factures d’électricité impayées')::text AS value`,
      ),
    ).toBe("'electricit':4 'factur':2 'impaye':5 'le':1");
  });

  it.each([
    ['fr', 'Votre facture du mois', 'factures'],
    ['fr', 'Consommation d’électricité', 'electricite'],
    ['fr', 'Consommation d electricite', 'électricité'],
    ['en', 'Two invoices are overdue', 'invoice'],
    ['en', 'The café was running late', 'cafe runs'],
  ])('finds a %s text through another form of the word', async (language, content, query) => {
    expect(await matches(language, content, [language], query)).toBe(true);
  });

  it('does not stem a text whose language is unknown', async () => {
    expect(await matches(null, 'Votre facture du mois', [null], 'factures')).toBe(false);
    expect(await matches(null, 'Votre facture du mois', [null], 'FACTURE')).toBe(true);
  });

  it('reads a query in every language in use when its own language is unknown', async () => {
    const languages = ['en', 'fr', null];
    expect(await matches('fr', 'Votre facture du mois', languages, 'factures')).toBe(true);
    expect(await matches('en', 'Two invoices are overdue', languages, 'invoice')).toBe(true);
    expect(await matches(null, 'Reference AB-1234', languages, 'ab-1234')).toBe(true);
    expect(await matches('fr', 'Deux chevaux au pré', ['fr'], 'chevaux')).toBe(true);
    expect(await matches('fr', 'Deux chevaux au pré', ['en'], 'chevaux')).toBe(false);
  });

  it.each([
    '"unbalanced quote & | !! ((( :* \\',
    "it's -- ; DROP TABLE chunks; --",
    'OR OR OR',
    '-',
    '',
  ])('never raises on the user query %j', async (query) => {
    expect(await matches('fr', 'Votre facture du mois', ['fr', 'en', null], query)).not.toBe(true);
  });

  it('honours the quoted phrases and exclusions of a web-style query', async () => {
    const content = 'Avis de taxe foncière pour la résidence principale';
    expect(await matches('fr', content, ['fr'], '"taxe fonciere"')).toBe(true);
    expect(await matches('fr', content, ['fr'], '"fonciere taxe"')).toBe(false);
    expect(await matches('fr', content, ['fr'], 'taxe -residence')).toBe(false);
  });

  it('matches nothing when no language is in use', async () => {
    expect(await matches('fr', 'Votre facture', [], 'facture')).toBeNull();
  });

  it('rewrites the search vector of a row when its language is set', async () => {
    const { id } = await insertSyntheticDocument(database.db);
    await database.db
      .insert(documentPages)
      .values({ documentId: id, page: 1, text: 'Les factures impayées' });
    const tsv = async (): Promise<unknown> =>
      (
        await database.db
          .select({ tsv: documentPages.tsv })
          .from(documentPages)
          .where(eq(documentPages.documentId, id))
      )[0]?.tsv;
    expect(await tsv()).toBe("'factures':2 'impayees':3 'les':1");
    await database.db
      .update(documentPages)
      .set({ language: 'fr' })
      .where(eq(documentPages.documentId, id));
    expect(await tsv()).toBe("'factur':2 'impaye':3 'le':1");
  });
});
