# Vercel and Supabase Implementation Plan

**Goal:** Serve the same signed-in app on Vercel for development and ChatGPT Sites for production.

**Architecture:** Route Vercel `/api/*` traffic through Next.js to the shared backend handlers. Use a separate PostgreSQL schema and private Supabase bucket in development. Use the existing static export, Worker, D1 migrations, and R2 binding on Sites.

- [x] Add a Vercel build target and an API entry point with an explicit trusted origin.
- [x] Port the D1 schema to PostgreSQL and implement transactional database and private file adapters.
- [x] Verify storage isolation, sign-in request routing, both builds, and production defaults.
- [x] Document development provisioning, private bucket setup, and the Google callback.
- [x] Provision the Vercel development storage, apply the migration, deploy, and verify the live Google redirect.
- [x] Verify a real Google account session after the user completes authentication.
