CREATE TYPE "public"."change_kind" AS ENUM('merge', 'promote_field', 'stabilize', 'split', 'rename', 'merge_entity', 'merge_subject');--> statement-breakpoint
CREATE TYPE "public"."change_status" AS ENUM('pending', 'applied', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."document_source" AS ENUM('watch', 'api', 'mcp');--> statement-breakpoint
CREATE TYPE "public"."document_state" AS ENUM('current', 'superseded', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('received', 'extracted', 'classified', 'indexed', 'failed', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."entity_kind" AS ENUM('org', 'person');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."key_date_kind" AS ENUM('due', 'expiry', 'renewal', 'notice_deadline', 'effective', 'event');--> statement-breakpoint
CREATE TYPE "public"."link_kind" AS ENUM('supersedes', 'amends', 'terminates', 'pays', 'replies_to', 'attachment_of');--> statement-breakpoint
CREATE TYPE "public"."subject_kind" AS ENUM('property', 'vehicle', 'contract', 'employment', 'account', 'dependent');--> statement-breakpoint
CREATE TYPE "public"."type_status" AS ENUM('provisional', 'stable', 'merged');--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"page_from" integer NOT NULL,
	"page_to" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(__EMBEDDING_DIM__),
	"tsv" "tsvector" GENERATED ALWAYS AS (liasse_tsvector("text")) STORED,
	CONSTRAINT "chunks_page_range" CHECK ("chunks"."page_from" >= 1 AND "chunks"."page_to" >= "chunks"."page_from")
);
--> statement-breakpoint
CREATE TABLE "document_pages" (
	"document_id" text NOT NULL,
	"page" integer NOT NULL,
	"text" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (liasse_tsvector("text")) STORED,
	CONSTRAINT "document_pages_document_id_page_pk" PRIMARY KEY("document_id","page"),
	CONSTRAINT "document_pages_page_positive" CHECK ("document_pages"."page" >= 1)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"original_name" text NOT NULL,
	"source" "document_source" NOT NULL,
	"status" "document_status" DEFAULT 'received' NOT NULL,
	"state" "document_state" DEFAULT 'current' NOT NULL,
	"type_id" text,
	"schema_version" integer,
	"core" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"title" text,
	"summary" text,
	"private" boolean DEFAULT false NOT NULL,
	"error" text,
	"confidence" real,
	"manual_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"subject_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_sha256_unique" UNIQUE("sha256"),
	CONSTRAINT "documents_confidence_range" CHECK ("documents"."confidence" IS NULL OR "documents"."confidence" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_dates" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"kind" "key_date_kind" NOT NULL,
	"date" date NOT NULL,
	"label" text NOT NULL,
	"confidence" real,
	"quote" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_links" (
	"id" text PRIMARY KEY NOT NULL,
	"from_document_id" text NOT NULL,
	"to_document_id" text NOT NULL,
	"kind" "link_kind" NOT NULL,
	"confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_links_distinct" CHECK ("document_links"."from_document_id" <> "document_links"."to_document_id")
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"text" text NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"entity_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"subject_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"embedding" vector(__EMBEDDING_DIM__),
	"tsv" "tsvector" GENERATED ALWAYS AS (liasse_tsvector("text")) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facts_validity_range" CHECK ("facts"."valid_from" IS NULL OR "facts"."valid_to" IS NULL OR "facts"."valid_to" >= "facts"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "subject_kind" NOT NULL,
	"canonical_name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"identifiers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(__EMBEDDING_DIM__),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_types" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"description" text NOT NULL,
	"schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "type_status" DEFAULT 'provisional' NOT NULL,
	"parent_slug" text,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"doc_count" integer DEFAULT 0 NOT NULL,
	"embedding" vector(__EMBEDDING_DIM__),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "entity_kind" NOT NULL,
	"canonical_name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"identifiers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(__EMBEDDING_DIM__),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "type_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "change_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"status" "change_status" DEFAULT 'pending' NOT NULL,
	"auto" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_id_doc_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."doc_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_dates" ADD CONSTRAINT "document_dates_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_from_document_id_documents_id_fk" FOREIGN KEY ("from_document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_to_document_id_documents_id_fk" FOREIGN KEY ("to_document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunks_document_id_idx" ON "chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "chunks_tsv_idx" ON "chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "chunks_embedding_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "document_pages_tsv_idx" ON "document_pages" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "documents_type_id_idx" ON "documents" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "documents_subject_ids_idx" ON "documents" USING gin ("subject_ids");--> statement-breakpoint
CREATE INDEX "jobs_dequeue_idx" ON "jobs" USING btree ("run_after") WHERE "jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "document_dates_date_idx" ON "document_dates" USING btree ("date");--> statement-breakpoint
CREATE INDEX "document_dates_document_id_idx" ON "document_dates" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_links_unique_idx" ON "document_links" USING btree ("from_document_id","to_document_id","kind");--> statement-breakpoint
CREATE INDEX "document_links_to_document_id_idx" ON "document_links" USING btree ("to_document_id");--> statement-breakpoint
CREATE INDEX "facts_document_id_idx" ON "facts" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "facts_entity_ids_idx" ON "facts" USING gin ("entity_ids");--> statement-breakpoint
CREATE INDEX "facts_subject_ids_idx" ON "facts" USING gin ("subject_ids");--> statement-breakpoint
CREATE INDEX "facts_tsv_idx" ON "facts" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "facts_embedding_idx" ON "facts" USING hnsw ("embedding" vector_cosine_ops);