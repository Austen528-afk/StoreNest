# StoreNest — Development Plan

## Goal

Create a hybrid storefront and marketplace where independent small businesses can maintain their own online presence and also be discovered by new customers.

## Customers

- Browse a business's own shareable storefront.
- View products and services, available extras, prices and availability.
- Place product orders or request service bookings (after checkout and fulfilment are implemented).
- See clear collection/delivery terms and order status.

## Business owners

- Create a shop profile and a unique shareable URL.
- Add and edit products, services, variations and media.
- Manage orders, booking requests and fulfilment status.
- Review sales and operational analytics through private owner-only dashboards.

## Platform

- Discover local businesses by category and area.
- Moderate listings and support users.
- Establish role-based authorization, per-business isolation, and audit records before launching real orders.

## Current implementation

- Supabase email/password authentication with persistent sessions and logout
- Owner-only business profiles, categories and catalogue items, protected by Row Level Security
- First-time business setup and business settings
- Responsive owner dashboard with data-backed catalogue counts and honest empty states
- Public storefront pages show only published businesses and available catalogue items
- Orders, bookings, customer records, visit tracking, image uploads and payments remain future work

## Infrastructure

- Source: GitHub repository `Austen528-afk/StoreNest`
- Web hosting: Vercel project `storenest`
- Media storage: Cloudflare R2 bucket `storenest-media`
- Future database/auth: choose and provision separately after design review
- Future payments: select provider after flow, compliance and fee review

## Milestones

1. Functional branded storefront + business registration
2. Business dashboard + product/service management
3. Customer checkout/booking requests and order workflow
4. Marketplace discovery
5. Analytics, notifications, payments, subscription model

Current deployed page is an informative placeholder only. It accepts no payments or orders.
