ALTER TYPE "public"."change_kind" ADD VALUE 'remove_field';--> statement-breakpoint
ALTER TABLE "type_changes" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "type_changes" ADD COLUMN "note" text;