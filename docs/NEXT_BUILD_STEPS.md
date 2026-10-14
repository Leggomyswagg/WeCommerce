# WeCommerce next build steps

This branch extends the routing/build fixes in draft PR #2 into an authenticated,
persisted single-founder workspace. It prepares a functional first version of
the six README steps without claiming live store creation, supplier fulfillment,
advertising publication, or paid subscription support.

| README step | Implemented behavior | Remaining integration evidence |
| --- | --- | --- |
| Onboarding, niche scoring, orchestration | Saved brand brief; contribution margins from supplied observations; proposed/approved/running/terminal tasks with atomic claims | Actual demand and supplier reliability need real evidence, not the margin calculation |
| Shopify/WooCommerce connectors | Bounded authenticated catalogue reads and partial-page indicators | Correct merchant accounts/scopes and live catalogue verification; no store/product writes |
| Alibaba/CJ supplier adapters | CJ documented V2 catalogue and exact product-detail reads; marketplace/manufacturer references with RFQ questions | Alibaba is a reference workflow, not an authenticated Open Platform adapter; supplier selection, stock/size mapping, order import, settlement and tracking remain pending |
| Google Ads/Meta/TikTok connectors | Authenticated campaign reads and local campaign briefs | Account access, supported API version, scopes, and staging verification; no campaign publication/spend |
| Founder dashboard | Explain → review exact inputs → approve → execute; saved state, errors, refresh/reconciliation, accessible mobile layout | Configure private founder access and durable hosted storage |
| Competency/curriculum | Checked margin exercise, supplier-evidence checklist, approval acknowledgement, persisted prerequisites | Completion records the exercise; it does not verify business proficiency or unlock paid/external writes |

## Run locally

Use Node **22 or later**. From the repository root:

```sh
npm ci
cp .env.example .env
```

Configure `WE_COMMERCE_AUTH_TOKEN` with a long random value in `.env`. Keep this
file private and ignored by Git. The root dev scripts load it; enter the founder
token into the dashboard's access form. It stays in browser memory and clears
on lock/reload. Provider keys never go into that form or browser storage.

```sh
npm run dev:web
npm run dev:api
npm run worker:once
```

The web app serves both the dashboard and its API at `http://localhost:3000`.
The separate API runs at port 4000. `worker:once` drains approved tasks through
the same atomic claim path as HTTP; `dev:workers` continuously polls. It does not
approve tasks or invent successful jobs. HTTP execution and workers can run
concurrently without claiming the same approved task twice.

Development uses an atomic local file in `.wecommerce/`, or the optional
`WE_COMMERCE_DATA_DIR`. File and directory permissions are restricted; writes use
rename/fsync and a process-owner lock. If local recovery itself is interrupted,
a `.lock.recovery` guard may remain. Stop all local application/worker processes
and inspect/remove that stale recovery guard before restarting; do not delete
the saved workspace JSON or remove an active process's lock.

## Hosted/serverless setup

Bind `WE_COMMERCE_AUTH_TOKEN` and `DATABASE_URL` securely to the intended deployment.
PostgreSQL persists and locks the founder workspace row transactionally. Run
schema setup explicitly against the intended database:

```sh
npm run db:setup
```

The API never runs migrations at startup. Production/serverless refuses local
or memory fallback when the database is missing or unavailable. No live database
was created or migrated in this task; protocol tests are not hosted PostgreSQL
integration evidence.

The existing Vercel projects use `apps/api` and `apps/web` as Root Directories.
Both include their own API wrappers, generated `public/` output, and config.
Keep **Include source files outside of the Root Directory in the Build Step**
enabled for shared state/connector code. The repository-root layout also works.
Default previews return an unavailable private workspace until owner bindings
and the database are configured; public health/guidance remains available.

## Connectors and result modes

`.env.example` lists server bindings. Shopify uses an **Admin** token with product
read permissions against the pinned `2026-10` API, not a browser Storefront token.
Its read returns at most 50 products and 10 variants per product; pagination flags
identify truncated pages. WooCommerce uses REST read credentials. CJ uses its
`CJ-Access-Token` for `product/listV2` and `product/query`; those responses do not
verify an authorized shop or fulfillment. The separate AxonRing checkout work
has stricter supplier/variant verification and remains disabled before launch.

Google Ads and Meta require explicit account IDs and supported API-version
bindings; TikTok uses its documented v1.3 campaign-read endpoint. Account and
token scopes must be verified with the provider. Tokens are not returned in
status, task results, logs, or URLs. API errors and oversized bodies fail safely.

- `provider_read`: an authenticated provider read, with a bounded catalogue or
  campaign page. This label is used with injected fixtures in tests and does not
  make those tests live-provider proof.
- `reference_preparation`: an unverified supplier reference plus quote questions.
  Alibaba, Made-in-China, 1688, Temu, Zendrop, and direct references do not create
  an authenticated supplier connection or contact a seller. Temu consumer terms
  require separate commercial/third-party permission.
- `local_draft`: a local campaign brief. Budget is a proposal; no ad is published
  and no money is spent.
- `local_guidance`: a deterministic plan from the approved saved intake, not a
  generated/live-executed storefront.

Task approval hashes bind the saved inputs and profile snapshot. Duplicate
executions return the stored terminal result or a running conflict. Missing
credentials persist a blocked result. Expired/interrupted work becomes uncertain
and requires reconciliation; it is not automatically replayed or replaced by a
late success. The workspace caps tasks at 100, observations at 10, request JSON
at 16 KiB, and results at 64 KiB.

## Validation and limits

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

The test suite has **38 passing checks** covering HTTP/authentication, input
validation, exact approvals, concurrent services/worker processes, persistence,
interruption, redaction, and documented mocked connector envelopes. The browser
suite has **10 passing checks** with a temporary local store and injected
providers. Both app outputs build. A preinstalled Chromium can be selected with
`CHROMIUM_EXECUTABLE_PATH`; `PLAYWRIGHT_MODULE` can select a supplied module.

No live provider call, paid model request, customer write, ad publication,
supplier order/payment, database migration, or production release was performed.
PostgreSQL tests use a protocol double; live database integration remains pending.
The older local Shopify helper was a storefront-only bundle and could not validate
the Admin operation/version. The native Shopify MCP schema tools subsequently
confirmed the queried fields and successfully validated the Admin operation
(required scope: `read_products`). That validator does not return a version stamp;
exact `2026-10` authenticated staging verification remains pending. A fresh
read-only merchant identity request still returned `operation_not_allowed`.

References: [Shopify products](https://shopify.dev/docs/api/admin-graphql/2026-10/queries/products),
[WooCommerce REST](https://woocommerce.github.io/woocommerce-rest-api-docs/#products),
[CJ product endpoints](https://developers.cjdropshipping.com/en/api/api2/api/product.html),
[Google Ads REST](https://developers.google.com/google-ads/api/docs/rest/overview),
[Meta campaigns](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group),
[TikTok Business API](https://business-api.tiktok.com/portal/docs).
