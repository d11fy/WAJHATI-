CREATE TYPE "public"."country_code" AS ENUM('PS', 'SA', 'AE', 'EG', 'JO', 'KW', 'QA', 'BH', 'OM', 'LB', 'IQ', 'SY', 'YE', 'MA', 'DZ', 'TN', 'LY', 'SD', 'MR', 'SO', 'DJ', 'KM');--> statement-breakpoint
CREATE TYPE "public"."currency_code" AS ENUM('USD', 'EUR', 'ILS', 'SAR', 'AED', 'EGP', 'JOD', 'KWD', 'QAR', 'BHD', 'OMR', 'LBP', 'IQD', 'SYP', 'YER', 'MAD', 'DZD', 'TND', 'LYD', 'SDG', 'MRU', 'SOS', 'DJF', 'KMF');--> statement-breakpoint
CREATE TYPE "public"."store_role" AS ENUM('owner', 'staff');--> statement-breakpoint
CREATE TABLE "auth_limits" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"attempts" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_memberships" (
	"store_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "store_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_memberships_store_id_user_id_pk" PRIMARY KEY("store_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "store_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"slug" varchar(48) NOT NULL,
	"country" "country_code" NOT NULL,
	"currency" "currency_code" NOT NULL,
	"published_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_slug_unique" UNIQUE("slug"),
	CONSTRAINT "stores_slug_format" CHECK (length("stores"."slug") >= 3 and "stores"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "stores_name_length" CHECK (length(btrim("stores"."name")) between 2 and 80)
);
--> statement-breakpoint
ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_memberships" ADD CONSTRAINT "store_memberships_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_memberships" ADD CONSTRAINT "store_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_limits_expiry_idx" ON "auth_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "store_memberships_user_idx" ON "store_memberships" USING btree ("user_id");