CREATE TABLE "platform_account_trials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	CONSTRAINT "platform_account_trial_dates" CHECK ("platform_account_trials"."ends_at">"platform_account_trials"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "platform_account_trials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_contact" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"whatsapp" varchar(16) NOT NULL,
	CONSTRAINT "platform_contact_valid" CHECK ("platform_contact"."id"=1 and "platform_contact"."whatsapp" ~ '^[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
ALTER TABLE "platform_contact" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_mail" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"config" jsonb NOT NULL,
	"cipher" "bytea" NOT NULL,
	"revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_mail_valid" CHECK ("platform_mail"."id"=1 and octet_length("platform_mail"."cipher") between 29 and 4096)
);
--> statement-breakpoint
ALTER TABLE "platform_mail" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_manual_terms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"months" integer NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" "currency_code" DEFAULT 'ILS' NOT NULL,
	"reference" varchar(120) NOT NULL,
	"note" varchar(500) DEFAULT '' NOT NULL,
	"actor" uuid NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	CONSTRAINT "platform_manual_valid" CHECK ("platform_manual_terms"."months" in (1,3,6,12) and "platform_manual_terms"."amount_minor" between 1 and 1000000000 and length(btrim("platform_manual_terms"."reference")) between 3 and 120 and length("platform_manual_terms"."note")<=500 and (("platform_manual_terms"."starts_at" is null and "platform_manual_terms"."ends_at" is null and "platform_manual_terms"."approved_by" is null) or ("platform_manual_terms"."starts_at" is not null and "platform_manual_terms"."ends_at">"platform_manual_terms"."starts_at" and "platform_manual_terms"."approved_by" is not null)))
);
--> statement-breakpoint
ALTER TABLE "platform_manual_terms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops_notifications" DROP CONSTRAINT "ops_notifications_kind";--> statement-breakpoint
ALTER TABLE "platform_account_trials" ADD CONSTRAINT "platform_account_trials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_manual_terms" ADD CONSTRAINT "platform_manual_terms_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_manual_terms" ADD CONSTRAINT "platform_manual_terms_plan_id_billing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_manual_terms" ADD CONSTRAINT "platform_manual_terms_actor_users_id_fk" FOREIGN KEY ("actor") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_manual_terms" ADD CONSTRAINT "platform_manual_terms_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_manual_reference" ON "platform_manual_terms" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "platform_manual_store" ON "platform_manual_terms" USING btree ("store_id","ends_at");--> statement-breakpoint
ALTER TABLE "ops_notifications" ADD CONSTRAINT "ops_notifications_kind" CHECK ("ops_notifications"."kind" in ('billing_due','review_pending','subscription_active','subscription_expired','trial_started') and "ops_notifications"."attempts" between 0 and 6);