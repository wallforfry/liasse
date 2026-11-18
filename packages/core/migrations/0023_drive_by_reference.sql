ALTER TYPE "public"."source_kind" ADD VALUE 'gdrive';--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "storage_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "file_at_source" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "replaced_by_source" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "document_origins" ADD COLUMN "checksum" text;--> statement-breakpoint
ALTER TABLE "document_origins" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_file_location" CHECK (("documents"."storage_key" IS NULL) = "documents"."file_at_source");