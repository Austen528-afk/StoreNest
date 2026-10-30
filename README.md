# StoreNest

**StoreNest — Your business. Your storefront.**

StoreNest is a hybrid storefront and marketplace platform designed for independent businesses in South Africa and beyond.

## Vision

Give every small business a simple online presence to showcase products or services, accept enquiries, orders and bookings, and understand performance — with its own shareable storefront link and a shared marketplace for discovery.

## Core experiences

- **Customer storefront:** Business profile, product/service menu, cart, checkout or booking request, and order status.
- **Business dashboard:** Store setup, product and service management, orders and bookings, fulfilment, customer activity and analytics.
- **Marketplace:** Discover businesses by category and location, with links to individual storefronts.
- **Platform administration:** Business review, user management, moderation, and platform-level oversight.

## Architecture (planned)

| Component | Role |
| --- | --- |
| GitHub | Source control |
| Vercel | Web storefront, marketplace and business dashboards |
| Cloudflare R2 | Business-uploaded images and media (bucket: `storenest-media`) |
| Database and authentication | Supabase project `cypbjzbagezdelmemuhb` |
| Payments | To be evaluated before enabling real transactions |

## Status

StoreNest now includes Supabase business-owner authentication, a private business dashboard, first-time business setup, owner-scoped product and service management, and public storefront pages. Orders, bookings, customer accounts, image storage and visit analytics are not implemented. No live payments are enabled.

## Development principles

1. Build a useful standalone storefront first.
2. Keep each business's private dashboard separate from public customer pages.
3. Require authenticated access and tenant-level data separation for business operations. Business, category and catalogue tables use Row Level Security policies.
4. Validate each workflow before expanding to marketplace discovery and monetisation.
5. Keep API secrets out of the repository.

© StoreNest. Working project name.
