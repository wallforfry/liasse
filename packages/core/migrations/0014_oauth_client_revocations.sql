CREATE TABLE "oauth_client_revocations" (
	"client_id" text PRIMARY KEY NOT NULL,
	"revoked_at" timestamp with time zone NOT NULL
);
