-- One text search configuration per language Postgres ships a Snowball stemmer for, named
-- liasse_<ISO 639-1 code>. unaccent runs as a filtering dictionary in front of the stemmer, so
-- lexemes are accent-insensitive while ts_headline still returns the original, accented text.
-- Only word, hword and hword_part can hold a non-ASCII letter. The list below is the single
-- place that names the supported languages: liasse_regconfig is generated from it.
DO $$
DECLARE
  languages CONSTANT text[][] := ARRAY[
    ['ar', 'arabic'], ['hy', 'armenian'], ['eu', 'basque'], ['ca', 'catalan'], ['da', 'danish'],
    ['nl', 'dutch'], ['en', 'english'], ['fi', 'finnish'], ['fr', 'french'], ['de', 'german'],
    ['el', 'greek'], ['hi', 'hindi'], ['hu', 'hungarian'], ['id', 'indonesian'], ['ga', 'irish'],
    ['it', 'italian'], ['lt', 'lithuanian'], ['ne', 'nepali'], ['no', 'norwegian'],
    ['pt', 'portuguese'], ['ro', 'romanian'], ['ru', 'russian'], ['sr', 'serbian'],
    ['es', 'spanish'], ['sv', 'swedish'], ['ta', 'tamil'], ['tr', 'turkish'], ['yi', 'yiddish']
  ];
  language text[];
  branches text := '';
BEGIN
  CREATE TEXT SEARCH CONFIGURATION public.liasse_simple (COPY = pg_catalog.simple);
  ALTER TEXT SEARCH CONFIGURATION public.liasse_simple
    ALTER MAPPING FOR word, hword, hword_part WITH public.unaccent, pg_catalog.simple;
  FOREACH language SLICE 1 IN ARRAY languages LOOP
    EXECUTE format(
      'CREATE TEXT SEARCH CONFIGURATION public.%I (COPY = pg_catalog.%I)',
      'liasse_' || language[1], language[2]
    );
    EXECUTE format(
      'ALTER TEXT SEARCH CONFIGURATION public.%I ALTER MAPPING FOR word, hword, hword_part '
        'WITH public.unaccent, pg_catalog.%I',
      'liasse_' || language[1], language[2] || '_stem'
    );
    branches := branches
      || format(' WHEN %L THEN %L::regconfig', language[1], 'public.liasse_' || language[1]);
  END LOOP;
  -- An explicit CASE over constants, so the function is honestly IMMUTABLE and can back a
  -- generated column. An unknown or missing language falls back to liasse_simple.
  EXECUTE format(
    'CREATE FUNCTION public.liasse_regconfig(language text) RETURNS regconfig '
      'LANGUAGE sql IMMUTABLE PARALLEL SAFE '
      'RETURN CASE language%s ELSE %L::regconfig END',
    branches, 'public.liasse_simple'
  );
END
$$;--> statement-breakpoint
CREATE FUNCTION liasse_tsvector(language text, content text) RETURNS tsvector
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN to_tsvector(public.liasse_regconfig(language), content);--> statement-breakpoint
CREATE AGGREGATE liasse_tsquery_or(tsquery) (SFUNC = tsquery_or, STYPE = tsquery);--> statement-breakpoint
-- A row only holds the lexemes of its own configuration, so a query whose language is unknown
-- is parsed once per language in use and the results are OR-ed: every row is then matched by
-- the query as read in its own language. websearch_to_tsquery never raises on user input.
CREATE FUNCTION liasse_tsquery(languages text[], query text) RETURNS tsquery
  LANGUAGE sql STABLE PARALLEL SAFE
  RETURN (
    SELECT public.liasse_tsquery_or(websearch_to_tsquery(configs.config, query))
    FROM (
      SELECT DISTINCT public.liasse_regconfig(codes.code) AS config
      FROM unnest(languages) AS codes(code)
    ) AS configs
  );
