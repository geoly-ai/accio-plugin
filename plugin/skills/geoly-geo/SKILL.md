---
name: geoly-geo
displayName: GEOly AI Visibility
description: "Use when querying or reporting on AI brand visibility through the GEOly MCP tools — picking the right tool, following the org/brand discovery flow, quoting the correct KPI caliber, and avoiding metric-definition pitfalls. Use for: GEO / generative engine optimization, AI search visibility, brand mentions and citations in ChatGPT / Perplexity / Google AI Mode / Google AI Overview / Gemini / Copilot answers, citation rate, mention rate, AIGVR, Share of Model, competitor benchmarking, category whitespace, brand momentum, AI search query demand, site AI-readiness audit. Chinese trigger terms include: AI 搜索可见度、品牌在 AI 回答中的提及与引用、GEO 优化、引用率、提及率、AI 排名监测、竞品对比。 Do NOT use for classic web SEO keyword rankings, backlink analysis, or paid-ads analytics — GEOly measures AI-answer visibility, not search-engine result pages."
version: "0.1.2"
tool_triggers:
  - tool: bash
    args:
      command: '/accio-mcp-cli.*geoly/i'
  - tool: bash
    args:
      command: '/accio-mcp-cli.*(keyword|search|find).*(geo\b|ai.?visibility|ai.?search|citation|brand.?mention|share.?of.?model|aigvr|可见度|提及|引用率)/i'
  - tool: get_brand_overview
  - tool: query_analytics
  - tool: compare_public_brands
---

# GEOly AI Visibility

[GEOly](https://www.geoly.ai) tracks how brands are mentioned and cited across AI engines (ChatGPT,
Perplexity, Google AI Mode, Google AI Overview, Gemini, Copilot). The GEOly MCP server exposes **up to 67 tools** (the exact set depends
on plan, mode, and write profile) across two surfaces:

- **Self / brand-own** — the customer's own monitoring, audits, GA4, and write actions.
- **Public / industry** — cross-brand competitive intelligence (Grow tier and above).

The data is correct; **most mistakes are caliber mistakes** (mixing aggregations of the same
metric name) or **flow mistakes** (calling a brand tool before resolving which brand).

## Prerequisites and access recovery

This skill depends on the **GEOly connector** in this plugin. If the GEOly MCP tools (e.g.
`list_brands`, `get_brand_overview`) are missing entirely, ask the user to open the **GEOly plugin
detail page → App Authorization → Connect**. The browser flow may take time while the user signs in,
finishes workspace setup, and reviews authorization; waiting is not a failure. Once connected,
discover the tools with `accio-mcp-cli toolkit geoly` (bash) and continue.

If a GEOly tool is available but a call fails, classify the error before taking any authorization
action. Never turn every access error into a login loop:

| Error signal | Meaning | Correct recovery |
|---|---|---|
| `AUTH_REQUIRED`, HTTP 401, or an explicitly unauthenticated message | OAuth credentials are missing or invalid | Open **GEOly plugin detail → App Authorization → Connect**, complete browser authorization, then retry once |
| `MCP_SETUP_REQUIRED` | The signed-in user has not completed GEOly workspace onboarding | Continue the GEOly browser setup opened by authorization, finish onboarding, then review the consent screen; do not start another login loop |
| `SUBSCRIPTION_REQUIRED`, `SUBSCRIPTION_INACTIVE`, or HTTP 402 | No selected organization has an active entitlement | Send the user to `https://app.geoly.ai/settings/billing`; do not re-login |
| `ORGANIZATION_REQUIRED` | GEOly could not find or prepare a usable organization | Ask the user to create or join an organization, or contact GEOly support; do not re-login |
| `ORG_SELECTION_REQUIRED` | The saved organization scope is invalid or contains unavailable organizations | Restart **App Authorization → Connect** and explicitly choose one active organization; do not ask the user to sign up again |
| Timeout or connection failure without an auth code | The client or network transport failed | Retry once, then inspect the connector/client state; do not assume an auth failure |

Do **not** probe the endpoint by hand: an unauthorized raw HTTP request returns `401`, which is
expected and proves nothing. Only `AUTH_REQUIRED`, HTTP 401, an explicit unauthenticated message, or
tools missing entirely should trigger **Connect** as a login recovery. Setup, subscription,
organization, selection, and transport failures require their specific recovery above.

## Calling the tools (invocation rules — read before your first call)

You reach GEOly tools through `accio-mcp-cli` (run `accio-mcp-cli --help` for its exact call
syntax). Two rules that otherwise waste calls:

- **Pass array / object parameters as one JSON string via `--json`, never as flags.** Flag-style
  args are type-coerced (numbers/booleans get mangled, lists don't parse), so any tool taking a list
  (`topic_ids`, `metrics`, `dimensions`, `brand_ids`, `public_brand_ids`, …) or a nested object
  **fails** with flags. Give the whole argument object as one JSON string, e.g.
  `--json '{"dataset":"topic_citations_daily","dimensions":["date"],"metrics":["aigvr","citationRate"],"start_date":"2026-05-28","end_date":"2026-06-26"}'`.
  Scalar-only calls (`--time_range 30d`) are fine with flags, but when in doubt use `--json` for the
  whole argument set.
- **Heavy tools need more time than the default per-call timeout (~15s).** The citation-heavy tools
  on large brands can exceed it — `get_citation_overview`, `get_brand_citations_daily`,
  `query_analytics` over long ranges, and `compare_public_brands`. If your caller lets you set a
  per-call timeout, raise it to **60s+** for these; otherwise make the query cheaper first — narrow
  the date range and/or add a `platform` filter. A timeout is a "make it smaller / wait longer"
  signal, not a dead end — don't abandon the analysis on the first timeout.

## Presenting results (output format — do this every answer)

Answer in **plain Markdown**: headings, Markdown tables, bullet lists. Put every number in a
Markdown table; show a trend as a small table or a plain-text bar (e.g. `Apple ███████░░ 6.4%`).
**Never emit raw HTML, CSS, or `<style>` / `<script>` / `<canvas>` / inline-styled `<div>` blocks** —
the host renders them as literal source code, which buries the answer under markup. Keep output to
what Markdown alone can render. Lead with the headline number and the "so what", then the supporting
table, then a one-line caliber note (which metric, which window, which platform).

## Core Principles

**1. The KPI baseline is `get_brand_overview`.**
Its `aigvr.{score,mentionRate,citationRate}` are the headline numbers and match what the
customer sees in the GEOly app. Quote these for any "what is our citation/mention/visibility
rate" question. Nothing else is the headline.

**2. Never arithmetic-average a daily series.**
`query_analytics` / `get_brand_citations_daily` return **per-day** rates; averaging them
over-weights low-volume days and will NOT match the headline. For a window number, use
`get_brand_overview`, the `recordCitationRate` metric, or re-aggregate daily rows **weighted by
`completedRecords`**. The same name `citationRate` has three legitimate calibers — see
references/metric-calibers.md.

**3. A gap in a daily line means "no monitoring ran that day", not a missing metric.**
Read `completedRecords` per row (0 or absent = no collection). AIGVR, mentionRate and
citationRate share one daily denominator, so they always have identical date coverage.

**4. Verify the caliber before you quote a number.**
mention ≠ citation; AIGVR ≠ Share of Model; record-rate ≠ URL counts; competitor tools
(`get_competitor_overview`, `get_platform_matrix`) are record-weighted, never the headline. If
two numbers disagree, it is almost always a caliber/window/platform mismatch — reconcile, don't
guess.

**5. Resolve the brand before calling brand tools.**
In multi-brand / multi-org mode, call `list_brands` (and first `list_organizations`) and pass
`brand_id`. If a brand tool errors asking which brand, run the discovery tools first.

**6. Recover from errors, don't loop.**
A `402` / "subscription inactive" or a missing `get_public_*` tool is a gating signal, not a
transient error — check mode, subscription, and plan tier before retrying. Respect truncation
markers (`_truncated`/`_shownCount` on brand tools; a plain-text `[truncated …]` marker on
public/report tools) and paginate (`currentPage == totalPages`) instead of assuming completeness.

## Connection & access (what affects your calls)

- **Auth**: the GEOly connector signs the user in via browser OAuth and stores the session
  locally; the MCP bridge talks to `https://app.geoly.ai/api/mcp`. A read-only
  `GEOLY_API_KEY` environment variable (`geom_…` static token) is also accepted for
  headless use and takes precedence over the stored login.
- **Mode → discovery flow** (decides whether brand tools need a `brand_id`):
  - **single** (one org, one brand) → brand tools auto-resolve; just call them.
  - **multi-brand** (one org, many brands) → first `list_brands`, then pass `brand_id`.
  - **multi-org** (several orgs) → first `list_organizations`, then `list_brands`, then pass IDs.
- **Subscription gate**: single-org / single-brand context returns **HTTP 402** at entry if the
  subscription is inactive. Multi-org validates **per target org at call time** and fails that
  org's tool call with an error message (not a 402).
- **Public tools** require a **Grow-tier-or-above** plan (`grow | advanced | plus | enterprise`).
  Multi-org connections get them too, as long as **any** accessible org qualifies. The three
  public **source** tools (`get_public_sources_overview` / `get_public_source_domain_detail` /
  `get_public_source_brand_conduit`) are NOT plan-gated — every token has them.
- **Writes** (`create_prompt`, `create_topic`, `create_competitor`, `trigger_prompt`) require
  **write access granted on the OAuth consent screen** (per-resource read/write grid; default
  is all-read, no-write). The `geom_` static token is always read-only, and **multi-org
  connections are always read-only**. `trigger_prompt` **consumes credits**.
- **Dates**: call `get_current_date` before building date ranges; `query_analytics` ranges ≤ 366 days.

## Tool selection — question → tool

### Self / brand-own
| You want… | Use |
|---|---|
| Headline KPI (AIGVR / mention / citation rate, whole window) | `get_brand_overview` |
| Daily/weekly **trend** of those metrics | `get_brand_citations_daily` |
| A topic / text-defined **subset** daily series | `query_analytics` dataset=`topic_citations_daily` (+ `prompt_text_include/exclude`) |
| Per-prompt visibility; search/list prompts | `get_prompt_list` (per-prompt rate in `geoMetrics.aigvr.citationRate`) |
| One prompt's full detail (per-platform, SoM, competitors) | `get_prompt_detail` |
| The actual **citation URLs / sources** for a prompt | `get_prompt_citations` (`deduplicate=true` for a source list) |
| "Which queries never mention us" (blind spots) | `get_prompt_mention_rates` |
| Citation **domain distribution / ownership** | `get_citation_overview` (counts URLs, not records) |
| One domain / one page deep-dive | `get_domain_detail` / `get_page_detail` / `get_url_reference_detail` |
| Content gaps for a domain | `get_content_opportunities` |
| Standing **vs competitors** | `get_competitor_overview` / `get_platform_matrix` (record-weighted — not headline) |
| How AI *describes* the brand (verbatim) | `get_brand_mention_samples`; vs rivals → `get_competitor_cooccurrence` |
| Topic-level analysis (and to enumerate topics) | `get_topic_analytics` (pass `topic_ids`, or read its rows) — there is no `get_topic_list` over MCP |
| Sentiment | `get_sentiment_dashboard` |
| Site AI-readiness audit | `get_audit_list` → `get_audit_detail` |
| Traffic (if GA4 connected) | `get_ga4_traffic_data` / `get_ga4_page_data` |

> `display_data` / `display_chart` and `web_search` / `fetch_page` are **in-app agent only** —
> not exposed over MCP. MCP results are plain JSON (no `_ref`).

### Public / industry (Grow tier and above)
| You want… | Use |
|---|---|
| Resolve a brand/category/topic name → IDs | `search_public_entities` |
| Category leaderboard / who leads | `get_public_category` view=`brand_leaderboard` |
| Where to invest (winnable topics) | `get_category_whitespace` |
| Who's gaining/losing share | `get_category_brand_momentum` |
| What AI is being asked in our space | `get_public_search_queries` → `get_public_search_query_detail` |
| Compare 2–4 brands head-to-head | `compare_public_brands` (country+language **required**) |
| How AI perceives a brand | `get_public_brand_perception` → `…_aspect_mentions` |
| Is a topic worth targeting | `get_topic_competition_difficulty` |
| Bridge my brand → public dataset | `resolve_my_brand_public` |

Cross-ref rule: for record counts/rates use `get_brand_overview` (not `get_citation_overview`,
which counts URLs); for trends use `get_brand_citations_daily` (not by paginating citations).

## Recipes

**KPI baseline (always start here)**
```json
{ "tool": "get_brand_overview", "args": { "time_range": "30d" } }
```
Read `aigvr.citationRate` / `aigvr.mentionRate` / `aigvr.score` — the report headline.

**Honest daily trend**
```json
{ "tool": "get_brand_citations_daily",
  "args": { "start_date": "2026-05-28", "end_date": "2026-06-26" } }
```
Plot as-is; treat absent days as "no collection" (check `completedRecords`). For a window value,
weight daily rates by `completedRecords` — don't simple-average.

**Citation sources for a prompt**
```json
{ "tool": "get_prompt_citations",
  "args": { "prompt_id": "<id>", "deduplicate": true, "limit": 500 } }
```

**Text-defined subset (e.g. non-branded), 3-metric daily series**
```json
{ "tool": "query_analytics",
  "args": { "dataset": "topic_citations_daily", "dimensions": ["date"],
            "metrics": ["aigvr","mentionRate","citationRate"],
            "prompt_text_exclude": "<brandword>",
            "start_date": "2026-05-28", "end_date": "2026-06-26" } }
```

**Competitive: where can we win a category**
```json
{ "tool": "search_public_entities", "args": { "query": "<my brand or category>" } }
```
→ `get_category_whitespace` with the resolved `product_space_id` + `public_brand_id`; act on the
`prioritize` / `gap` buckets.

## Reference Guides

- **Metric calibers, glossary & limits** → [references/metric-calibers.md](references/metric-calibers.md)
  **MUST read when** quoting any rate/score, reconciling two numbers that disagree, building a
  trend, or hitting a row/date/rate limit.
- **Full tool catalog (all registered tools + parameters)** → [references/tools-catalog.md](references/tools-catalog.md)
  **MUST read when** you need a tool's exact parameters/enums/defaults, or to confirm whether a
  tool is exposed over MCP.
- **Public / industry competitive-intelligence tools** → [references/public-tools.md](references/public-tools.md)
  **MUST read when** doing cross-brand work (leaderboards, whitespace, momentum, AI-search
  demand, perception, shopping) or anything involving the locale convention.
