CREATE TABLE "ops_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"recipient" uuid NOT NULL,
	"subject" uuid NOT NULL,
	"window" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease" uuid,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	CONSTRAINT "ops_notifications_kind" CHECK ("ops_notifications"."kind" in ('billing_due','review_pending') and "ops_notifications"."attempts" between 0 and 6)
);
--> statement-breakpoint
ALTER TABLE "ops_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_proof_sources" ADD COLUMN "key_id" varchar(24);--> statement-breakpoint
ALTER TABLE "ops_notifications" ADD CONSTRAINT "ops_notifications_recipient_users_id_fk" FOREIGN KEY ("recipient") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ops_notifications_pending" ON "ops_notifications" USING btree ("due_at","id") WHERE "ops_notifications"."sent_at" is null and "ops_notifications"."failed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ops_notifications_dedupe" ON "ops_notifications" USING btree ("kind","recipient","subject","window");