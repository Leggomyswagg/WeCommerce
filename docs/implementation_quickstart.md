# Implementation Quickstart

## 1) Install dependencies

```bash
npm install
```

## 2) Configure environment

```bash
cp .env.example .env
```

Set `WE_COMMERCE_AUTH_TOKEN` to a long random owner-access token. The root dev
scripts load `.env`; provider secrets stay on the server. Configure only the
provider bindings you intend to read. Hosted/serverless use also requires
`DATABASE_URL` and explicit `npm run db:setup` before startup. See
[NEXT_BUILD_STEPS.md](NEXT_BUILD_STEPS.md) for all bindings and capability limits.

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

Run `npm test` for HTTP, state, approval, worker, and connector regressions; `npm
run build` checks syntax and generates both app outputs. The authenticated
dashboard supports persisted intake, margin observations, approved read tasks,
local drafts/references, and lesson progression. It does not create stores,
fulfill supplier orders, publish advertisements, or charge subscriptions.
Connector configuration means bindings are present, not verified provider access.

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
