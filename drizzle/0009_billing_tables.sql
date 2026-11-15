CREATE TYPE "public"."billing_interval" AS ENUM('monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."billing_payment_status" AS ENUM('awaiting_payment', 'submitted', 'under_review', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."billing_subscription_status" AS ENUM('trialing', 'active', 'pending_payment', 'grace_period', 'suspended', 'canceled', 'expired');--> statement-breakpoint
CREATE TABLE "billing_admins" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_admins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_audit" (
	"store_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid,
	"actor_id" uuid,
	"event" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_audit_store_id_id_pk" PRIMARY KEY("store_id","id")
);
--> statement-breakpoint
ALTER TABLE "billing_audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"trial_days" integer DEFAULT 7 NOT NULL,
	"grace_days" integer DEFAULT 7 NOT NULL,
	"trial_products" integer DEFAULT 10 NOT NULL,
	CONSTRAINT "billing_config_bounds" CHECK ("billing_config"."id" = 1 AND "billing_config"."trial_days" between 1 and 30 AND "billing_config"."grace_days" between 0 and 30 AND "billing_config"."trial_products" between 1 and 30)
);
--> statement-breakpoint
ALTER TABLE "billing_config" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country" "country_code" NOT NULL,
	"currency" "currency_code" NOT NULL,
	"label" text NOT NULL,
	"instructions" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "billing_method_text" CHECK (length(btrim("billing_methods"."label")) between 1 and 100 and length(btrim("billing_methods"."instructions")) between 1 and 1600)
);
--> statement-breakpoint
ALTER TABLE "billing_methods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_periods" (
	"store_id" uuid NOT NULL,
	"request_id" uuid PRIMARY KEY NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"grace_until" timestamp with time zone NOT NULL,
	CONSTRAINT "billing_period_dates" CHECK ("billing_periods"."starts_at" < "billing_periods"."ends_at" and "billing_periods"."ends_at" <= "billing_periods"."grace_until")
);
--> statement-breakpoint
ALTER TABLE "billing_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"max_products" integer NOT NULL,
	"storage_mib" integer NOT NULL,
	"analytics" text NOT NULL,
	"luxury" boolean NOT NULL,
	"premium" boolean NOT NULL,
	CONSTRAINT "billing_plan_version" UNIQUE("code","version"),
	CONSTRAINT "billing_plan_valid" CHECK ("billing_plans"."code" in ('starter','pro') AND "billing_plans"."version" > 0 AND "billing_plans"."max_products" between 1 and 10000 AND "billing_plans"."storage_mib" between 6 and 1000000 AND "billing_plans"."analytics" in ('basic','enhanced'))
);
--> statement-breakpoint
ALTER TABLE "billing_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"country" "country_code" NOT NULL,
	"currency" "currency_code" NOT NULL,
	"interval" "billing_interval" NOT NULL,
	"amount" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "billing_price_amount" CHECK ("billing_prices"."amount" between 1 and 1000000000)
);
--> statement-breakpoint
ALTER TABLE "billing_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_proofs" (
	"store_id" uuid NOT NULL,
	"request_id" uuid PRIMARY KEY NOT NULL,
	"sha256" text NOT NULL,
	"content" "bytea" NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_proofs_sha256_unique" UNIQUE("sha256"),
	CONSTRAINT "billing_proof_valid" CHECK ("billing_proofs"."sha256" ~ '^[a-f0-9]{64}$' and octet_length("billing_proofs"."content") between 1 and 5242880)
);
--> statement-breakpoint
ALTER TABLE "billing_proofs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"reference" text NOT NULL,
	"price_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"interval" "billing_interval" NOT NULL,
	"country" "country_code" NOT NULL,
	"currency" "currency_code" NOT NULL,
	"plan_minor" integer NOT NULL,
	"setup_minor" integer DEFAULT 0 NOT NULL,
	"method_id" uuid NOT NULL,
	"method_label" text NOT NULL,
	"instructions" text NOT NULL,
	"status" "billing_payment_status" DEFAULT 'awaiting_payment' NOT NULL,
	"transaction_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "billing_requests_reference_unique" UNIQUE("reference"),
	CONSTRAINT "billing_request_tenant" UNIQUE("store_id","id"),
	CONSTRAINT "billing_request_key" UNIQUE("store_id","idempotency_key"),
	CONSTRAINT "billing_request_amount" CHECK ("billing_requests"."plan_minor" between 1 and 1000000000 and "billing_requests"."setup_minor" between 0 and 1000000000),
	CONSTRAINT "billing_request_dates" CHECK ("billing_requests"."expires_at" > "billing_requests"."created_at"),
	CONSTRAINT "billing_request_reference" CHECK ("billing_requests"."reference" ~ '^DAR-[A-F0-9]{20}$')
);
--> statement-breakpoint
ALTER TABLE "billing_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_reviews" (
	"store_id" uuid NOT NULL,
	"request_id" uuid PRIMARY KEY NOT NULL,
	"reviewer" uuid NOT NULL,
	"approved" boolean NOT NULL,
	"reason" text,
	"reconciliation_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_review_evidence" CHECK (case when "billing_reviews"."approved" then "billing_reviews"."reconciliation_ref" is not null and "billing_reviews"."reason" is null else "billing_reviews"."reason" is not null and "billing_reviews"."reconciliation_ref" is null end)
);
--> statement-breakpoint
ALTER TABLE "billing_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_setup_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country" "country_code" NOT NULL,
	"currency" "currency_code" NOT NULL,
	"label" text NOT NULL,
	"amount" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "billing_setup_amount" CHECK ("billing_setup_packages"."amount" between 1 and 1000000000 and length(btrim("billing_setup_packages"."label")) between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "billing_setup_packages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_setup_requests" (
	"store_id" uuid NOT NULL,
	"request_id" uuid PRIMARY KEY NOT NULL,
	"package_id" uuid NOT NULL,
	"label" text NOT NULL,
	"notes" text NOT NULL,
	"status" text DEFAULT 'awaiting_payment' NOT NULL,
	CONSTRAINT "billing_setup_state" CHECK ("billing_setup_requests"."status" in ('awaiting_payment','paid','completed','closed') and length("billing_setup_requests"."notes") <= 1600)
);
--> statement-breakpoint
ALTER TABLE "billing_setup_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_subscriptions" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"legacy" boolean DEFAULT false NOT NULL,
	"cancel_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"observed_status" "billing_subscription_status",
	"observed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_trials" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"max_products" integer NOT NULL,
	CONSTRAINT "billing_trials_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "billing_trial_dates" CHECK ("billing_trials"."ends_at" > "billing_trials"."starts_at" and "billing_trials"."max_products" between 1 and 30)
);
--> statement-breakpoint
ALTER TABLE "billing_trials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_verified_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_verified_accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "billing_verified_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_admins" ADD CONSTRAINT "billing_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_audit" ADD CONSTRAINT "billing_audit_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_audit" ADD CONSTRAINT "billing_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_audit" ADD CONSTRAINT "billing_audit_store_id_request_id_billing_requests_store_id_id_fk" FOREIGN KEY ("store_id","request_id") REFERENCES "public"."billing_requests"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_store_id_billing_subscriptions_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."billing_subscriptions"("store_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_store_id_request_id_billing_requests_store_id_id_fk" FOREIGN KEY ("store_id","request_id") REFERENCES "public"."billing_requests"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_prices" ADD CONSTRAINT "billing_prices_plan_id_billing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_proofs" ADD CONSTRAINT "billing_proofs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_proofs" ADD CONSTRAINT "billing_proofs_store_id_request_id_billing_requests_store_id_id_fk" FOREIGN KEY ("store_id","request_id") REFERENCES "public"."billing_requests"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_requests" ADD CONSTRAINT "billing_requests_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_requests" ADD CONSTRAINT "billing_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_requests" ADD CONSTRAINT "billing_requests_price_id_billing_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "public"."billing_prices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_requests" ADD CONSTRAINT "billing_requests_plan_id_billing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_requests" ADD CONSTRAINT "billing_requests_method_id_billing_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."billing_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_reviews" ADD CONSTRAINT "billing_reviews_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_reviews" ADD CONSTRAINT "billing_reviews_reviewer_users_id_fk" FOREIGN KEY ("reviewer") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_reviews" ADD CONSTRAINT "billing_reviews_store_id_request_id_billing_requests_store_id_id_fk" FOREIGN KEY ("store_id","request_id") REFERENCES "public"."billing_requests"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_setup_requests" ADD CONSTRAINT "billing_setup_requests_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_setup_requests" ADD CONSTRAINT "billing_setup_requests_package_id_billing_setup_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."billing_setup_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_setup_requests" ADD CONSTRAINT "billing_setup_requests_store_id_request_id_billing_requests_store_id_id_fk" FOREIGN KEY ("store_id","request_id") REFERENCES "public"."billing_requests"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_trials" ADD CONSTRAINT "billing_trials_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_trials" ADD CONSTRAINT "billing_trials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_verified_accounts" ADD CONSTRAINT "billing_verified_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_audit_recent" ON "billing_audit" USING btree ("store_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "billing_period_store" ON "billing_periods" USING btree ("store_id","starts_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "billing_active_price" ON "billing_prices" USING btree ("plan_id","country","currency","interval") WHERE "billing_prices"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "billing_one_open_request" ON "billing_requests" USING btree ("store_id") WHERE "billing_requests"."status" in ('awaiting_payment','submitted','under_review');--> statement-breakpoint
CREATE UNIQUE INDEX "billing_verified_transfer_unique" ON "billing_requests" USING btree ("method_id",lower("transaction_ref")) WHERE "billing_requests"."status" = 'approved';--> statement-breakpoint
CREATE INDEX "billing_request_queue" ON "billing_requests" USING btree ("status","created_at");