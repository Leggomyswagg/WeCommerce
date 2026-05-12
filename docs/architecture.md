# System Architecture: Hybrid Mentor-Operator Agent

## 1) Architecture goals

- Execute e-commerce operations autonomously.
- Teach the founder with actionable, concise explanations.
- Preserve founder control on strategic/high-risk decisions.
- Scale from first sale to multi-million revenue operations.

## 2) Agent topology

### A. Chief Orchestrator Agent
- Breaks goals into executable tasks.
- Schedules actions across subagents.
- Applies policy, budget, and risk constraints.

### B. Mentor Agent
- Produces "teach while doing" explanations.
- Tracks founder skill progression.
- Converts completed tasks into mini-lessons and checklists.

### C. Store Builder Agent
- Creates storefront structure, collections, PDP templates.
- Generates landing pages and conversion-first blocks.

### D. Product & Supplier Agent
- Ingests products from supported suppliers.
- Scores supplier reliability, lead times, return rates.
- Flags low-confidence suppliers for founder review.

### E. SEO & Content Agent
- Generates product descriptions, titles, schema suggestions.
- Produces alt-text and internal link recommendations.

### F. Marketing Agent
- Generates ad copy variants and creative briefs.
- Proposes budget allocation and tests.
- Tracks CAC/ROAS trends and optimization actions.

### G. Growth/Revenue Agent
- Runs experiments (pricing, bundles, upsells).
- Monitors funnel drop-offs and recommends fixes.

## 3) Control plane and data plane

- **Control Plane:** task planning, approval gates, policy checks.
- **Data Plane:** catalog, orders, ads metrics, web analytics, session insights.

## 4) Human-in-the-loop policy

Mandatory approvals for:
- Spend jumps over threshold.
- Any legal/compliance-sensitive copy.
- Major pricing strategy changes.
- Supplier replacements with weak trust scores.

## 5) Competency transfer model

Each completed operation produces:
- outcome summary
- rationale
- alternatives
- glossary terms
- founder practice task

As competency increases, the agent:
- shortens explanations
- offers optional deep-dives
- unlocks manual controls

## 6) Tier-aware capability flags

- Free: guided setup and limited automation.
- Premium: core autonomous operations and mentorship.
- Ultra: multi-niche support + advanced orchestrations.

## 7) Extensibility

Connector interface pattern:

- `SupplierConnector`
- `StoreConnector`
- `AdConnector`
- `AnalyticsConnector`

All connectors implement:
- `health_check()`
- `sync()`
- `dry_run()`
- `execute()`
- `rollback()` where possible

