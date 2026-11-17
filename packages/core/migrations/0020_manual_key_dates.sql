ALTER TABLE "documents" ADD COLUMN "notice_period" jsonb;--> statement-breakpoint
ALTER TABLE "document_dates" ADD COLUMN "manual" boolean DEFAULT false NOT NULL;