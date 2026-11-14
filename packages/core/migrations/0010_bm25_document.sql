-- The text a BM25 index of ParadeDB pg_search reads (see `ensureBm25Index`): the lexemes of
-- liasse_tsvector, one per occurrence in the order of their positions, separated by spaces. A
-- whitespace tokenizer then indexes exactly the unaccented, stemmed lexemes full-text search
-- matches, with their frequencies. pg_search cannot index a tsvector column, hence the text in
-- and the text out. Nothing here needs the extension: without it, the function is never called.
CREATE FUNCTION liasse_bm25_document(language text, content text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN (
    SELECT string_agg(entries.lexeme, ' ' ORDER BY occurrences.position)
    FROM unnest(public.liasse_tsvector(language, content)) AS entries,
      unnest(entries.positions) AS occurrences(position)
  );
