CREATE TYPE "public"."processing_outcome" AS ENUM('succeeded', 'retrying', 'failed');--> statement-breakpoint
CREATE TYPE "public"."processing_stage" AS ENUM('text', 'classification', 'extraction', 'reextraction', 'indexing');--> statement-breakpoint
CREATE TABLE "document_events" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stage" "processing_stage" NOT NULL,
	"outcome" "processing_outcome" NOT NULL,
	"status" "document_status",
	"attempt" integer,
	"max_attempts" integer,
	"error_code" text,
	"error_name" text,
	"retryable" boolean,
	"model" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_events" ADD CONSTRAINT "document_events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_events_document_idx" ON "document_events" USING btree ("document_id","occurred_at");