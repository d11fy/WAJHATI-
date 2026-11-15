CREATE TYPE "public"."identity_purpose" AS ENUM('signup', 'verify', 'reset', 'change_old', 'change_new');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('owner', 'administrator', 'reviewer');--> statement-breakpoint
CREATE TABLE "identity_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"old_email" text NOT NULL,
	"new_email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"old_confirmed" boolean DEFAULT false NOT NULL,
	"new_confirmed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "identity_tokens" (
	"hash" varchar(64) PRIMARY KEY NOT NULL,
	"purpose" "identity_purpose" NOT NULL,
	"email" text NOT NULL,
	"user_id" uuid,
	"change_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "identity_token_hash" CHECK ("identity_tokens"."hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "identity_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_controls" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"hold" boolean DEFAULT false NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_controls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_elevations" (
	"session_hash" varchar(64) PRIMARY KEY NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_elevations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor" uuid,
	"subject" uuid,
	"action" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"previous" varchar(64) NOT NULL,
	"hash" varchar(64) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"success" boolean,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_legacy" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"classified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_legacy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_mfa" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"secret" "bytea",
	"enrollment_hash" varchar(64),
	"enrollment_expiry" timestamp with time zone,
	"enrollment_session" varchar(64),
	"enabled" boolean DEFAULT false NOT NULL,
	"last_counter" integer DEFAULT -1 NOT NULL,
	"attempt_start" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_mfa" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_payment_checks" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"reviewer" uuid NOT NULL,
	"reconciliation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_payment_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_policy" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"dual_thresholds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allow_trials" boolean DEFAULT true NOT NULL,
	"luxury_enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "platform_policy_singleton" CHECK ("platform_policy"."id"=1)
);
--> statement-breakpoint
ALTER TABLE "platform_policy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_proof_sources" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"cipher" "bytea" NOT NULL,
	"original_type" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	CONSTRAINT "platform_proof_limits" CHECK (octet_length("platform_proof_sources"."cipher") between 29 and 5242908 and "platform_proof_sources"."original_type" in ('application/pdf','image/png','image/jpeg','image/webp') and "platform_proof_sources"."sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "platform_proof_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_recovery" (
	"user_id" uuid NOT NULL,
	"hash" varchar(64) NOT NULL,
	CONSTRAINT "platform_recovery_user_id_hash_pk" PRIMARY KEY("user_id","hash")
);
--> statement-breakpoint
ALTER TABLE "platform_recovery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_roles" (
	"user_id" uuid NOT NULL,
	"role" "platform_role" NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
ALTER TABLE "platform_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "identity_changes" ADD CONSTRAINT "identity_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_tokens" ADD CONSTRAINT "identity_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_tokens" ADD CONSTRAINT "identity_tokens_change_id_identity_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."identity_changes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_controls" ADD CONSTRAINT "platform_controls_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_elevations" ADD CONSTRAINT "platform_elevations_session_hash_sessions_token_hash_fk" FOREIGN KEY ("session_hash") REFERENCES "public"."sessions"("token_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_legacy" ADD CONSTRAINT "platform_legacy_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_mfa" ADD CONSTRAINT "platform_mfa_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_payment_checks" ADD CONSTRAINT "platform_payment_checks_request_id_billing_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."billing_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_payment_checks" ADD CONSTRAINT "platform_payment_checks_reviewer_users_id_fk" FOREIGN KEY ("reviewer") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_proof_sources" ADD CONSTRAINT "platform_proof_sources_request_id_billing_proofs_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."billing_proofs"("request_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_recovery" ADD CONSTRAINT "platform_recovery_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_roles" ADD CONSTRAINT "platform_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_changes_user" ON "identity_changes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "identity_tokens_expiry" ON "identity_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "identity_tokens_user" ON "identity_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "platform_jobs_recent" ON "platform_jobs" USING btree ("job","started_at" DESC NULLS LAST);