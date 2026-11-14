ALTER TABLE "documents" ADD COLUMN "hindsight_held_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "hindsight_sent_hash" text;