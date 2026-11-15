CREATE TYPE "public"."catalog_media_state" AS ENUM('pending', 'ready');--> statement-breakpoint
CREATE TYPE "public"."catalog_product_state" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "catalog_categories" (
	"store_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(48) NOT NULL,
	"name_ar" varchar(100) NOT NULL,
	"name_en" varchar(100),
	"position" integer DEFAULT 0 NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	CONSTRAINT "catalog_categories_store_id_id_pk" PRIMARY KEY("store_id","id"),
	CONSTRAINT "catalog_categories_store_slug" UNIQUE("store_id","slug"),
	CONSTRAINT "catalog_categories_position" CHECK ("catalog_categories"."position" between 0 and 999999),
	CONSTRAINT "catalog_categories_slug" CHECK (length("catalog_categories"."slug") >= 3 and "catalog_categories"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "catalog_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "catalog_images" (
	"store_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"product_id" uuid,
	"category_id" uuid,
	"object_key" text NOT NULL,
	"state" "catalog_media_state" DEFAULT 'pending' NOT NULL,
	"position" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_images_store_id_id_pk" PRIMARY KEY("store_id","id"),
	CONSTRAINT "catalog_images_parent" CHECK (num_nonnulls("catalog_images"."product_id", "catalog_images"."category_id") = 1),
	CONSTRAINT "catalog_images_key" CHECK ("catalog_images"."object_key" = "catalog_images"."store_id"::text || '/catalog/' || "catalog_images"."id"::text || '.webp'),
	CONSTRAINT "catalog_images_primary_ready" CHECK (not "catalog_images"."is_primary" or ("catalog_images"."state" = 'ready' and "catalog_images"."product_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "catalog_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "catalog_media_gc" (
	"object_key" text PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"available_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_media_gc" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "catalog_product_categories" (
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "catalog_product_categories_store_id_product_id_category_id_pk" PRIMARY KEY("store_id","product_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "catalog_product_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "catalog_product_options" (
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"group_position" integer NOT NULL,
	"position" integer NOT NULL,
	"group_name" varchar(40) NOT NULL,
	"value" varchar(60) NOT NULL,
	CONSTRAINT "catalog_product_options_store_id_product_id_group_position_position_pk" PRIMARY KEY("store_id","product_id","group_position","position"),
	CONSTRAINT "catalog_options_position" CHECK ("catalog_product_options"."group_position" between 0 and 7 and "catalog_product_options"."position" between 0 and 9)
);
--> statement-breakpoint
ALTER TABLE "catalog_product_options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "catalog_products" (
	"store_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(48) NOT NULL,
	"name_ar" varchar(100) NOT NULL,
	"name_en" varchar(100),
	"description_ar" text,
	"description_en" text,
	"price_minor" integer NOT NULL,
	"compare_at_minor" integer,
	"sku" varchar(64),
	"state" "catalog_product_state" DEFAULT 'draft' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_products_store_id_id_pk" PRIMARY KEY("store_id","id"),
	CONSTRAINT "catalog_products_store_slug" UNIQUE("store_id","slug"),
	CONSTRAINT "catalog_products_price" CHECK ("catalog_products"."price_minor" >= 0 and ("catalog_products"."compare_at_minor" is null or "catalog_products"."compare_at_minor" > "catalog_products"."price_minor")),
	CONSTRAINT "catalog_products_position" CHECK ("catalog_products"."position" between 0 and 999999),
	CONSTRAINT "catalog_products_slug" CHECK (length("catalog_products"."slug") >= 3 and "catalog_products"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "catalog_products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "catalog_categories" ADD CONSTRAINT "catalog_categories_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_images" ADD CONSTRAINT "catalog_images_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_images" ADD CONSTRAINT "catalog_images_product" FOREIGN KEY ("store_id","product_id") REFERENCES "public"."catalog_products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_images" ADD CONSTRAINT "catalog_images_category" FOREIGN KEY ("store_id","category_id") REFERENCES "public"."catalog_categories"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_product_categories" ADD CONSTRAINT "catalog_product_categories_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_product_categories" ADD CONSTRAINT "catalog_links_product" FOREIGN KEY ("store_id","product_id") REFERENCES "public"."catalog_products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_product_categories" ADD CONSTRAINT "catalog_links_category" FOREIGN KEY ("store_id","category_id") REFERENCES "public"."catalog_categories"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_product_options" ADD CONSTRAINT "catalog_product_options_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_product_options" ADD CONSTRAINT "catalog_options_product" FOREIGN KEY ("store_id","product_id") REFERENCES "public"."catalog_products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_categories_order" ON "catalog_categories" USING btree ("store_id","position","id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_images_one_primary" ON "catalog_images" USING btree ("store_id","product_id") WHERE "catalog_images"."is_primary";--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_images_one_category" ON "catalog_images" USING btree ("store_id","category_id") WHERE "catalog_images"."category_id" is not null;--> statement-breakpoint
CREATE INDEX "catalog_images_product_order" ON "catalog_images" USING btree ("store_id","product_id","position","id");--> statement-breakpoint
CREATE INDEX "catalog_images_pending" ON "catalog_images" USING btree ("created_at") WHERE "catalog_images"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "catalog_media_gc_ready" ON "catalog_media_gc" USING btree ("available_at");--> statement-breakpoint
CREATE INDEX "catalog_product_categories_category" ON "catalog_product_categories" USING btree ("store_id","category_id");--> statement-breakpoint
CREATE INDEX "catalog_products_visibility_order" ON "catalog_products" USING btree ("store_id","state","featured" DESC NULLS LAST,"position","id");--> statement-breakpoint
CREATE INDEX "catalog_products_order" ON "catalog_products" USING btree ("store_id","position","id");
