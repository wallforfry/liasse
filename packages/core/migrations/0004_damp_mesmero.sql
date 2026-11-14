ALTER TABLE "documents" ADD COLUMN "watch_requeues" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "file_deleted_at" timestamp with time zone;