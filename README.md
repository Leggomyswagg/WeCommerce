# HybridMentorOps Agent for E-commerce Founders

An AI system that **builds and runs an e-commerce business** while simultaneously **teaching the founder** at every step.

## Current working version

The founder dashboard now saves an authenticated onboarding brief, compares
contribution margins from supplied costs, and runs an Explain → Approve → Execute
workflow. Approved tasks use store/supplier/advertising reads or clearly labeled
local guidance, supplier references, and campaign briefs. Lessons validate
exercises and unlock the local campaign-draft control.

Local development persists in `.wecommerce/`; hosted use requires PostgreSQL,
explicit schema setup, and `WE_COMMERCE_AUTH_TOKEN`. Provider secrets stay on the
server. Missing credentials block reads, and interrupted tasks require
reconciliation instead of automatic replay. This is a single-founder workspace,
not a multi-tenant authentication or billing system.

See [setup and capability details](docs/NEXT_BUILD_STEPS.md). The roadmap below
describes the larger product vision; automated store creation, supplier purchases,
product publication, live advertising, and paid subscriptions are not implemented.

## Product vision

This repository scaffolds a one-stop AI platform that:

- Creates stores from scratch (brand, domain guidance, storefront, landing pages).
- Imports and curates dropship products (Alibaba/CJ/other connectors).
- Generates SEO content (titles, descriptions, alt-text, schema ideas).
- Generates ad creative and campaign drafts (Google Ads + multi-channel).
- Integrates Stripe (founder-owned API keys).
- Coaches founders in-context with explain-while-doing mentorship.
- Escalates decisions that require founder judgment.
- Gradually hands over more control and skills to the founder.

---

## Core product concept: Mentor + Operator in one

The platform uses a **dual-loop agent architecture**:

1. **Operator Loop** (autonomous execution)
   - Executes tasks (store setup, SKU imports, feed optimization, campaign generation, analytics).
2. **Mentor Loop** (learning transfer)
   - Explains each action in plain language.
   - Shares rationale, alternatives, and tradeoffs.
   - Tracks founder competency and unlocks advanced controls over time.

Every action produces:
- **What I did**
- **Why I did it**
- **Expected impact**
- **Risks**
- **Need founder decision?** (yes/no)

---

## Three-tier pricing model

Defined in `config/tiers.json`:

- **Free**
  - Single niche starter store.
  - Guided setup with limited automation.
  - Stripe preset (founder adds keys).

- **Premium**
  - Includes AI mentor + autonomous operations workflows.
  - Product import automation and SEO/ad copy generation.
  - Conversion recommendations and roadmap tooling.

- **Ultra**
  - Multi-niche store capability.
  - Highest automation limits.
  - Advanced growth tooling (multi-channel orchestration, deeper analytics).

---

## Top 10 high-revenue niche selector

Initial niche recommendations are included in `config/niches.json` with example top-selling product archetypes for each niche.

> These are seed suggestions; the agent should validate live demand via trend + CPC + margin + fulfillment reliability before launch.

---

## Reference architecture

See `docs/architecture.md` for the full system design. High-level modules:

- Orchestrator / Planner
- Mentor Engine
- Store Builder
- Product Intelligence + Supplier Connectors
- Marketing Studio
- Revenue Optimization + Experimentation
- Founder Control Center
- Billing / Tiers / Stripe

---

## Suggested implementation stack

- **Frontend:** Next.js
- **Backend API:** FastAPI or Node (Nest/Express)
- **Workers:** Celery/Temporal/Queue workers for long-running tasks
- **LLM layer:** Multi-model router (reasoning, copy generation, image prompt generation)
- **Vector store:** PgVector / Weaviate
- **DB:** PostgreSQL
- **Auth/Billing:** Clerk/Auth0 + Stripe
- **Observability:** OpenTelemetry + product analytics

---

## Product workflow (end-to-end)

1. Founder onboarding + goal intake
2. Niche shortlist (top 10) + scorecard
3. Product/supplier validation
4. Store and landing page generation
5. Stripe key insertion + checkout verification
6. SEO setup (meta, schema, alt text, product copy)
7. Ad asset and campaign generation
8. Launch checklist + QA
9. Daily autonomous ops + mentor recaps
10. Scale loops (A/B tests, upsell, LTV improvement, channel expansion)

---

## Guardrails and human-in-the-loop decisions

Certain decisions must be routed to founder approval:

- Brand name/legal claims
- Pricing outside configured margin thresholds
- Refund policy and customer service exceptions
- Ad spend changes over threshold
- New supplier onboarding without trust score

---

## Starter files in this repo

- `docs/architecture.md` – detailed architecture, agents, data flow.
- `docs/agent_playbook.md` – execution + mentorship playbook.
- `config/tiers.json` – Free/Premium/Ultra features.
- `config/niches.json` – top 10 niches and top product archetypes.
- `prompts/system_mentor_operator.md` – system prompt for hybrid behavior.

- `docs/build_guide.md` – founder guide for turning AI output into a live website/app.
- `docs/implementation_quickstart.md` – runnable monorepo setup + GitHub push steps.

---

## Next build steps

The six documented steps now have the following concrete implementations:

1. Authenticated onboarding, observed-cost margin scoring, and persisted task orchestration.
2. Shopify and WooCommerce catalogue reads; store mutations remain gated future work.
3. CJ catalogue/product reads and unverified Alibaba/marketplace sourcing references; no supplier purchases or fulfillment writes.
4. Google Ads, Meta, and TikTok campaign reads plus local briefs; no publishing or spend.
5. A working founder dashboard with explanations, immutable approvals, execution, and recovery.
6. Validated lesson exercises, persisted prerequisites, and local campaign-draft unlocks.

Live provider access, PostgreSQL integration, and merchant launch/fulfillment
evidence remain unverified. [NEXT_BUILD_STEPS.md](docs/NEXT_BUILD_STEPS.md) records
the limits and required setup.

