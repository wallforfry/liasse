CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
-- unaccent() is only STABLE because its dictionary can be reconfigured, which keeps it out of
-- generated columns. This wrapper pins the dictionary and the text search configuration, so it
-- can honestly be IMMUTABLE. It is the single place to change when search becomes
-- language-aware; every stored tsvector must be rewritten when its body changes.
CREATE FUNCTION liasse_tsvector(content text) RETURNS tsvector
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path = public, pg_catalog
  AS $$ SELECT to_tsvector('simple'::regconfig, unaccent('unaccent'::regdictionary, content)) $$;
