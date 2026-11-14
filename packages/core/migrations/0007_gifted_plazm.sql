ALTER TABLE "document_links" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "document_links" ADD COLUMN "schema_version" integer;--> statement-breakpoint
ALTER TABLE "document_links" ADD COLUMN "page" integer;--> statement-breakpoint
ALTER TABLE "document_links" ADD COLUMN "quote" text;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_confidence_range" CHECK ("document_links"."confidence" IS NULL OR "document_links"."confidence" BETWEEN 0 AND 1);