# WAJHATI unified pricing — reviewed local change

User authorization: one plan with all existing capabilities, ILS 35 per month or ILS 245 per year.

## Configuration plan

- Add an immutable `pro` plan version named `WAJHATI`. Keep the existing technical code for compatibility with entitlement checks. Enable premium customization, Luxury Boutique and enhanced analytics. Retain the existing Pro resource ceilings (200 products, 12,288 MiB); all features does not mean unlimited resources.
- Publish new PS/ILS monthly (3,500 minor units) and annual (24,500 minor units) prices. Annual savings compared with twelve monthly periods: 17,500 minor units.
- Keep all historical plan versions, payment amounts, subscription periods, proofs and audit records intact. No subscription is automatically upgraded or repriced.
- Neon preflight found two v1 plans and no prices or payment methods. No existing offer must be retired there. Local configuration is inspected separately before applying the new version.
- Do not invent a payment recipient or bank instructions. Prices may be visible while purchasing remains unavailable. Existing checkout continues to require an active matching payment method.

## Migration 0024

The `billing_marketing()` SECURITY DEFINER function gains a `catalog` projection containing public plan names, limits, flags, prices and payment availability. Its previous `offers` field still contains only purchasable prices and retains its existing shape. No payment instructions or tenant records are exposed. The function retains its fixed search path and `storefront_app`-only execution permission.

This migration changes no tables or financial data. Rollback is the function definition from `0020_marketing_offers.sql`, using CREATE OR REPLACE. To stop new sales, deactivate the new price records; never delete a plan or price referenced by a payment. Prior accepted requests retain their original immutable snapshots.
