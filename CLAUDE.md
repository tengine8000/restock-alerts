# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

A Shopify embedded app (back-in-stock alert) built with React Router v7, TypeScript, Prisma (SQLite), and the Shopify App React Router SDK. It is currently a scaffold — the template boilerplate is in place but the actual back-in-stock feature logic has not been built yet.

## Commands

```bash
# Local development (runs Shopify CLI tunnel + Vite + Prisma migrations)
npm run dev

# Build for production
npm run build

# Run built server
npm run start

# First-time / post-migration DB setup
npm run setup           # prisma generate + prisma migrate deploy

# Lint
npm run lint

# Type-check
npm run typecheck       # runs react-router typegen then tsc --noEmit

# GraphQL codegen (generates types in app/types/)
npm run graphql-codegen

# Prisma
npm run prisma migrate dev    # create + apply a new migration
npm run prisma studio         # GUI for the database

# Deploy to Shopify
npm run deploy
```

There are no test scripts in package.json yet — add a test runner before writing tests.

## Architecture

### Request flow

```
Browser / Shopify Admin
        │
        ▼
React Router v7 (Vite, SSR)
        │
   app/root.tsx          ← document shell, Shopify headers
        │
   app/routes/app.tsx    ← layout route: authenticates every /app/* request,
        │                  wraps children in <AppProvider> (App Bridge)
        ├── app._index.tsx       ← main page (loader + action)
        ├── app.additional.tsx   ← secondary nav page
        └── (future routes)
        │
   app/routes/auth.$.tsx  ← handles OAuth redirects (catch-all under /auth/)
        │
   app/routes/webhooks.*  ← webhook handlers (no auth.admin — uses authenticate.webhook)
```

### Key server files

| File | Purpose |
|------|---------|
| `app/shopify.server.ts` | Singleton `shopifyApp(...)` config; exports `authenticate`, `login`, `registerWebhooks`, `sessionStorage` |
| `app/db.server.ts` | Prisma client singleton (guards against hot-reload creating multiple instances in dev) |
| `prisma/schema.prisma` | SQLite DB — currently only a `Session` model used by `PrismaSessionStorage` |

### Authentication pattern

Every loader/action inside `app/routes/app.tsx` and its children must call:

```ts
const { admin } = await authenticate.admin(request);
```

This handles OAuth, session refresh, and returns a typed `admin.graphql()` client. Never use `redirect` from `react-router` in embedded app routes — use the one returned from `authenticate.admin`.

Webhook routes call `authenticate.webhook(request)` instead, which validates HMAC but does **not** return an `admin` object when triggered via the Shopify CLI (only when triggered by a real shop).

### UI components

This app uses **Polaris web components** (`<s-page>`, `<s-button>`, `<s-section>`, etc.) — NOT the `@shopify/polaris` React package. The `<s-*>` custom elements are provided by App Bridge. React's unknown-prop ESLint rule is configured to allow `variant` on these elements.

### GraphQL

- API version: `October25` (set in `app/shopify.server.ts` and `.graphqlrc.ts`)
- Types are auto-generated into `app/types/` via `graphql-codegen`
- Tagged template literals with `#graphql` prefix get IDE hints from `.graphqlrc.ts`
- Codegen targets the Shopify Admin API by default; update `.graphqlrc.ts` for Storefront or third-party APIs

### Extensions

`extensions/` is the workspace for Shopify app extensions (theme extensions, checkout UI, etc.). Currently empty — extensions added via `shopify app generate extension`.

### Environment variables

Set by `shopify app dev` automatically during local development. For production, set manually:

- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`
- `SCOPES`
- `NODE_ENV=production`

## Gotchas

- **Embedded app navigation**: Use `<Link>` from `react-router` or `<s-link>`, never `<a>`. Use `redirect` from `authenticate.admin`, not from `react-router`.
- **Webhooks registered in `afterAuth`** don't reliably update — define them in `shopify.app.toml` instead.
- **Webhook HMAC**: Webhooks created manually in the Shopify admin will fail HMAC validation. Use app-specific webhooks from `shopify.app.toml`.
- **SQLite in production**: Only works for single-instance deployments. Switch the `datasource provider` in `prisma/schema.prisma` for multi-instance hosting.
- **Streaming / `defer`**: Cloudflare tunnels (used by `shopify app dev` by default) buffer the full response. Use localhost-based dev to test streaming.
