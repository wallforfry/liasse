-- drizzle-kit emits the redefined "tsv" columns before the "language" column they read and
-- does not recreate the GIN indexes that DROP COLUMN removes; both are corrected by hand here.
ALTER TABLE "chunks" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "document_pages" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "chunks" drop column "tsv";--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "tsv" "tsvector" GENERATED ALWAYS AS (liasse_tsvector("language", "text")) STORED;--> statement-breakpoint
ALTER TABLE "document_pages" drop column "tsv";--> statement-breakpoint
ALTER TABLE "document_pages" ADD COLUMN "tsv" "tsvector" GENERATED ALWAYS AS (liasse_tsvector("language", "text")) STORED;--> statement-breakpoint
ALTER TABLE "facts" drop column "tsv";--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "tsv" "tsvector" GENERATED ALWAYS AS (liasse_tsvector("language", "text")) STORED;--> statement-breakpoint
CREATE INDEX "chunks_tsv_idx" ON "chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "document_pages_tsv_idx" ON "document_pages" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "facts_tsv_idx" ON "facts" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "chunks_language_idx" ON "chunks" USING btree ("language");--> statement-breakpoint
DROP FUNCTION liasse_tsvector(text);
