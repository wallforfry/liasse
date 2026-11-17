CREATE TABLE "settings" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_singleton" CHECK ("settings"."singleton")
);
