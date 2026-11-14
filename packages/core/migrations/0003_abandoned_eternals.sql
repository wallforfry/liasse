ALTER TYPE "public"."document_status" ADD VALUE 'deleted';--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "hint" text;