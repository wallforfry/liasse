import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';

export const BM25_INDEX = 'chunks_bm25_idx';

// Arbitrary constant: concurrent servers serialize the creation of the index on it.
const BM25_INDEX_LOCK_KEY = 5_417_330;

const BM25_INDEX_DEFINITION =
  `CREATE INDEX ${BM25_INDEX} ON chunks USING paradedb ` +
  `(id, ((liasse_bm25_document(language, text))::pdb.whitespace('alias=terms')))`;

// Everything the content of the index follows besides the rows: its definition, the functions
// that turn a row into lexemes, and the mappings of the liasse text search configurations. A
// change to any of them leaves the index holding lexemes `tsv @@ tsquery` no longer agrees with,
// and since the index filters chunks, that would lose matches rather than reorder them. The
// rules file of the unaccent dictionary is outside the catalog and not covered.
const signatureQuery = sql`
  SELECT md5(concat_ws(
    E'\n',
    ${BM25_INDEX_DEFINITION}::text,
    pg_get_functiondef('public.liasse_bm25_document(text, text)'::regprocedure),
    pg_get_functiondef('public.liasse_tsvector(text, text)'::regprocedure),
    pg_get_functiondef('public.liasse_regconfig(text)'::regprocedure),
    (
      SELECT string_agg(
        concat_ws(' ', configs.cfgname, maps.maptokentype, maps.mapseqno, maps.mapdict::regdictionary),
        E'\n' ORDER BY configs.cfgname, maps.maptokentype, maps.mapseqno
      )
      FROM pg_ts_config AS configs
      JOIN pg_ts_config_map AS maps ON maps.mapcfg = configs.oid
      WHERE configs.cfgnamespace = 'public'::regnamespace AND configs.cfgname LIKE 'liasse\\_%'
    )
  )) AS signature
`;

const signatureRows = z.tuple([z.object({ signature: z.string().regex(/^[0-9a-f]{32}$/) })]);

const indexRows = z.tuple([z.object({ present: z.boolean(), comment: z.string().nullable() })]);

type Executor = Pick<Database, 'execute'>;

const readSignature = async (tx: Executor): Promise<string> =>
  signatureRows.parse([...(await tx.execute(signatureQuery))])[0].signature;

const readIndex = async (tx: Executor) =>
  indexRows.parse([
    ...(await tx.execute(sql`
      SELECT to_regclass(${BM25_INDEX}) IS NOT NULL AS present,
        obj_description(to_regclass(${BM25_INDEX}), 'pg_class') AS comment
    `)),
  ])[0];

// Created at startup rather than by a migration: a migration runs once, so a database that
// gained the extension after it would never get the index. The index carries the signature it
// was built from as its comment, and one built from another is built again. Rows written
// before the index existed are indexed by its creation, the later ones as they are written.
export const ensureBm25Index = (db: Database): Promise<void> =>
  db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BM25_INDEX_LOCK_KEY})`);
    const signature = await readSignature(tx);
    const index = await readIndex(tx);
    if (index.present && index.comment === signature) return;
    if (index.present) await tx.execute(sql.raw(`DROP INDEX ${BM25_INDEX}`));
    await tx.execute(sql.raw(BM25_INDEX_DEFINITION));
    // COMMENT takes no parameter; the signature was checked to be 32 hexadecimal digits.
    await tx.execute(sql.raw(`COMMENT ON INDEX ${BM25_INDEX} IS '${signature}'`));
  });
