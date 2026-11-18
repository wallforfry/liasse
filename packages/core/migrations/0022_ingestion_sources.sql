CREATE TYPE "public"."source_kind" AS ENUM('imap');--> statement-breakpoint
ALTER TYPE "public"."document_source" ADD VALUE 'connector';--> statement-breakpoint
CREATE TABLE "document_origins" (
	"document_id" text NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_origins_document_id_source_id_external_id_pk" PRIMARY KEY("document_id","source_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "ingestion_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "source_kind" NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"poll_interval_minutes" integer NOT NULL,
	"hint" text,
	"private" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret" text,
	"cursor" jsonb,
	"needs_attention" boolean DEFAULT false NOT NULL,
	"last_run" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_origins" ADD CONSTRAINT "document_origins_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_origins" ADD CONSTRAINT "document_origins_source_id_ingestion_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."ingestion_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_origins_source_id_idx" ON "document_origins" USING btree ("source_id");