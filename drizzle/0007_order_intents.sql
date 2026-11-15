CREATE TYPE "public"."order_channel" AS ENUM('whatsapp', 'instagram');--> statement-breakpoint
CREATE TYPE "public"."order_intent_status" AS ENUM('initiated', 'contact_opened', 'merchant_confirmed', 'cancelled');--> statement-breakpoint
CREATE TABLE "order_intent_events" (
	"store_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_intent_events_store_id_intent_id_type_pk" PRIMARY KEY("store_id","intent_id","type"),
	CONSTRAINT "order_events_type" CHECK ("order_intent_events"."type" = 'contact_opened')
);
--> statement-breakpoint
ALTER TABLE "order_intent_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_intents" (
	"store_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(23) NOT NULL,
	"request_key" varchar(64) NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"channel" "order_channel" NOT NULL,
	"status" "order_intent_status" DEFAULT 'initiated' NOT NULL,
	"currency" "currency_code" NOT NULL,
	"total" bigint NOT NULL,
	"locale" varchar(2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "order_intents_store_id_id_pk" PRIMARY KEY("store_id","id"),
	CONSTRAINT "order_intents_reference_unique" UNIQUE("reference"),
	CONSTRAINT "order_intents_request_unique" UNIQUE("store_id","request_key"),
	CONSTRAINT "order_intents_format" CHECK ("order_intents"."reference" ~ '^DM-[0-9A-F]{20}$' and "order_intents"."locale" in ('ar', 'en') and "order_intents"."total" between 0 and 515396075280)
);
--> statement-breakpoint
ALTER TABLE "order_intents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_intent_items" (
	"store_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product" varchar(48) NOT NULL,
	"name_ar" varchar(100) NOT NULL,
	"name_en" varchar(100),
	"options" jsonb NOT NULL,
	"quantity" integer NOT NULL,
	"unit_minor" integer NOT NULL,
	"image_id" uuid,
	CONSTRAINT "order_intent_items_store_id_intent_id_position_pk" PRIMARY KEY("store_id","intent_id","position"),
	CONSTRAINT "order_items_bounds" CHECK ("order_intent_items"."position" between 1 and 12 and "order_intent_items"."quantity" between 1 and 20 and "order_intent_items"."unit_minor" >= 0 and jsonb_typeof("order_intent_items"."options") = 'array')
);
--> statement-breakpoint
ALTER TABLE "order_intent_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	CONSTRAINT "order_settings_object" CHECK (jsonb_typeof("order_settings"."config") = 'object')
);
--> statement-breakpoint
ALTER TABLE "order_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_intent_events" ADD CONSTRAINT "order_events_intent" FOREIGN KEY ("store_id","intent_id") REFERENCES "public"."order_intents"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_intents" ADD CONSTRAINT "order_intents_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_intent_items" ADD CONSTRAINT "order_items_intent" FOREIGN KEY ("store_id","intent_id") REFERENCES "public"."order_intents"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_settings" ADD CONSTRAINT "order_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_intents_recent" ON "order_intents" USING btree ("store_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "order_intents_status_recent" ON "order_intents" USING btree ("store_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "order_intents_retention" ON "order_intents" USING btree ("status","created_at");