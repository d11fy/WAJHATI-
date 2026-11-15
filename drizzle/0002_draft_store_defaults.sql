ALTER TABLE "stores" ALTER COLUMN "published_at" DROP DEFAULT;
--> statement-breakpoint
-- Foundation automatically published empty stores; require explicit publication going forward.
UPDATE public.stores SET published_at = NULL WHERE published_at IS NOT NULL;
