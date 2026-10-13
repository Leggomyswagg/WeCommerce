# Implementation Quickstart

## 1) Install dependencies

```bash
npm install
```

## 2) Configure environment

```bash
cp .env.example .env
```

Fill in:
- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_ACCESS_TOKEN`
- `STRIPE_SECRET_KEY`

## 3) Run apps

```bash
npm run dev:web
npm run dev:api
npm run dev:workers
```

## 4) Validate

- Web: `http://localhost:3000/health`
- API: `http://localhost:4000/health`

The dashboard's `/api/health` and `/api/onboarding/plan` endpoints are also served
from the web origin on port 3000, so no CORS setup or separate browser API URL is
needed. Root `api/` handlers expose the same responses on Vercel. `/health` and
`/onboarding/plan` remain aliases on the standalone API.

Run `npm test` for HTTP routing and dashboard status regressions, and `npm run
build` to check JavaScript syntax. This is a static dashboard; the build does not
generate stores or implement the roadmap's supplier, marketing, or billing flows.
Connector status means environment variables are present, not that credentials
have been verified with a provider.

The existing Vercel projects use `apps/api` and `apps/web` as their Root
Directories. Each app now includes its own `api/` functions and `vercel.json`;
its build copies the shared dashboard to its generated `public/` output. A
project created from the repository root can continue using the root handlers.
Keep Vercel's "Include source files outside of the Root Directory in the Build
Step" enabled so both app builds and their functions can use the shared source.

## 5) Push to GitHub

```bash
git remote add origin https://github.com/<you>/<repo>.git
git branch -M main
git push -u origin main
```
