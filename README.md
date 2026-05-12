# HybridMentorOps Agent for E-commerce Founders

An AI system that **builds and runs an e-commerce business** while simultaneously **teaching the founder** at every step.

## What this project delivers

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

1. Build API endpoints for onboarding, niche scoring, and task orchestration.
2. Implement Shopify/WooCommerce store connectors.
3. Add Alibaba/CJ dropshipping connector adapters.
4. Add ad platform connectors (Google Ads, Meta, TikTok).
5. Add Founder Dashboard with Explain/Approve/Execute UX.
6. Add competency progression engine and curriculum unlocks.

