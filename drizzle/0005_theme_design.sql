CREATE TYPE "public"."theme_asset_kind" AS ENUM('logo', 'icon', 'banner');--> statement-breakpoint
CREATE TABLE "store_design_assets" (
	"store_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"kind" "theme_asset_kind" NOT NULL,
	"object_key" text NOT NULL,
	"state" "catalog_media_state" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_design_assets_store_id_id_pk" PRIMARY KEY("store_id","id"),
	CONSTRAINT "store_design_assets_key" CHECK ("store_design_assets"."object_key" = "store_design_assets"."store_id"::text || '/theme/' || "store_design_assets"."id"::text || '.webp')
);
--> statement-breakpoint
ALTER TABLE "store_design_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store_designs" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"draft" jsonb NOT NULL,
	"revision" integer NOT NULL,
	"published" jsonb,
	"published_revision" integer,
	"published_at" timestamp with time zone,
	CONSTRAINT "store_design_draft_object" CHECK (jsonb_typeof("store_designs"."draft") = 'object' and "store_designs"."revision" > 0),
	CONSTRAINT "store_design_publication" CHECK (num_nonnulls("store_designs"."published", "store_designs"."published_revision", "store_designs"."published_at") in (0, 3)
    and ("store_designs"."published" is null or (jsonb_typeof("store_designs"."published") = 'object' and "store_designs"."published_revision" between 1 and "store_designs"."revision")))
);
--> statement-breakpoint
ALTER TABLE "store_designs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_design_assets" ADD CONSTRAINT "store_design_assets_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_designs" ADD CONSTRAINT "store_designs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_design_assets_pending" ON "store_design_assets" USING btree ("created_at") WHERE "store_design_assets"."state" = 'pending';