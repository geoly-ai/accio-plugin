---
name: geoly-geo
displayName: GEOly AI Visibility
description: "Use when querying or reporting on AI brand visibility through the GEOly MCP tools — picking the right tool, following the org/brand discovery flow, quoting the correct KPI caliber, and avoiding metric-definition pitfalls. Use for: GEO / generative engine optimization, AI search visibility, brand mentions and citations in ChatGPT / Perplexity / Google AI Mode / Google AI Overview / Gemini / Copilot answers, citation rate, mention rate, AIGVR, Share of Model, competitor benchmarking, category whitespace, brand momentum, AI search query demand, site AI-readiness audit. Chinese trigger terms include: AI 搜索可见度、品牌在 AI 回答中的提及与引用、GEO 优化、引用率、提及率、AI 排名监测、竞品对比。 Do NOT use for classic web SEO keyword rankings, backlink analysis, or paid-ads analytics — GEOly measures AI-answer visibility, not search-engine result pages."
version: "0.1.4"
tool_triggers:
  - tool: bash
    args:
      command: '/geoly-accio-mcp/i'
  - tool: bash
    args:
      command: '/(geoly|accio-mcp).*(geo\b|ai.?visibility|ai.?search|citation|brand.?mention|share.?of.?model|aigvr|可见度|提及|引用率)/i'
  - tool: get_brand_overview
  - tool: get_daily_trend
  - tool: get_public_brand
---

# GEOly AI Visibility

[GEOly](https://www.geoly.ai) tracks how brands are mentioned and cited across AI engines (ChatGPT,
Google AI Mode, Google AI Overview, Gemini; Perplexity and Copilot are retired — historical data only, up to
2026-09-20 and 2026-10-11 respectively). The GEOly MCP server exposes **up to 55 tools** (the exact set depends
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
discover the tools with `geoly-accio-mcp tools` (bash) and continue.

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

You reach GEOly tools through the **bundled `geoly-accio-mcp` CLI** (bash) — direct one-shot
calls, no MCP toolkit registration involved:

- `geoly-accio-mcp tools` — list every tool available to this account (name + one-line description)
- `geoly-accio-mcp tools --json` — full parameter schemas when you need exact argument names/enums
- `geoly-accio-mcp call <tool> --json '<args JSON>'` — invoke one tool; prints the tool's JSON result

Rules that otherwise waste calls:

- **All arguments go in ONE JSON object via `--json`.** There are no per-argument flags. Example:
  `geoly-accio-mcp call get_daily_trend --json '{"breakdown":"total","start_date":"2026-10-06","end_date":"2026-11-04"}'`.
  No-arg tools still take `--json '{}'` (or omit `--json` entirely).
- **Heavy tools can hit the server-side timeout on a cold first call** — `get_citation_overview`,
  `get_daily_trend` over long ranges, `get_public_brand` with `brand_ids` (several brands at once), and
  occasionally `get_brand_overview` on large workspaces. A timeout message is a "retry / make it
  smaller" signal, not a dead end: **retry once** (the first call warms the server cache and the
  retry usually returns in seconds), or narrow the date range / add a `platform` filter. The CLI
  waits up to 120s by default; `--timeout <seconds>` raises the client-side wait if you need more.

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
`get_daily_trend` returns **per-day** rates; averaging them over-weights low-volume days and
will NOT match the headline. For a window number, read the same call's `totals` (record-weighted
window values), use `get_brand_overview`, or re-aggregate daily rows **weighted by
`completedRecords`**. The same name `citationRate` has three legitimate calibers — see
references/metric-calibers.md.

**3. A gap in a daily line means "no monitoring ran that day", not a missing metric.**
Read `completedRecords` per row (0 or absent = no collection). AIGVR, mentionRate and
citationRate share one daily denominator, so they always have identical date coverage.

**4. Verify the caliber before you quote a number.**
mention ≠ citation; AIGVR ≠ Share of Model; record-rate ≠ URL counts; the competitor tool
(`get_platform_matrix` `dimension=competitor`) is record-weighted, never the headline. If
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
- **Dates**: call `get_current_date` before building date ranges; `get_daily_trend` ranges ≤ 366 days (its derived data starts 2026-04-13).

## Tool selection — question → tool

### Self / brand-own
| You want… | Use |
|---|---|
| Orientation first: brand/org, today's dates, entitled + with-data platforms, topic & filter ids, entity-layer tracked competitors, credits | `get_brand_context` (free, once per run) |
| Headline KPI (AIGVR / mention / citation rate, whole window) | `get_brand_overview` |
| Daily/weekly **trend** of those metrics (the `/overview` trend chart) | `get_daily_trend` `breakdown="platform"` (or `"total"`); `totals` = the window values of the same rows |
| This period **vs the previous one** (week-over-week, month-over-month) with `days_with_data` | `get_daily_trend` with `compare_previous=true` (per-row and `totals` `previous.*` / `delta.*`) |
| A topic daily series / a text-defined **subset** daily series | `get_daily_trend` `breakdown="topic"`. Text subsets have no derived-layer filter: for a lasting split (e.g. branded / non-branded) move those prompts into a topic with `move_prompts_to_topic`, then read `breakdown="topic"` or `breakdown="total"` + `topic_ids` (picked up after the next derived refresh); for one window value of a text subset, `get_prompt_list` `search=<word>` → `summary` (include-only; matches prompt text or tag name). `prompt_text_include/exclude` went away with `query_analytics` (removed October 2026) |
| Per-prompt visibility; search/list prompts (same calibers as the `/prompts` table; `summary` = the table's header bar) | `get_prompt_list` (per-prompt rate in `geoMetrics.aigvr.citationRate`; add `include_competitors=true` for SoM / competitors) |
| One prompt's windowed overview (visibility trend, Share of Mentions, competitor board, platform matrix, source domains — the `/prompts/[id]` page) | `get_prompt_detail` (`time_range` / `platform`) |
| Which competitors does the AI prefer **instead of** us, answer by answer (`weLose` per rival — the page's "who beats you" board; no weWin/tie any more) | `get_verdict` `view="competitors"` |
| Which cited sites ride along with **negative** aspect judgments of us (Verdict › Sources tab: `kind`, `citedRecords`, `negativeShare`) | `get_verdict` `view="sources"` (default 7d — the page shows 30d) |
| A prompt's **full execution history** over a range (per-day records, e.g. 30-day shopping-card trend) | `list_prompt_records` (explicit `start_date`/`end_date` are UTC+8 business days) |
| **Read the actual answers** brand-wide — every AI answer in the window, filtered by topic / tag / country / platform / "mentions entity X" / "mentions us", paginated (= in-app /answers) | `list_brand_answers` (`answerSummary` + `entities[]` + `sources[]` per row; drill one row with `get_prompt_record_detail`) |
| The actual **citation URLs / sources** for a prompt | `get_prompt_citations` (`deduplicate=true` for a source list) |
| "Which queries never mention us" (blind spots) | `get_prompt_list` `view="mention_rates"` (worst first by default) |
| Citation **domain distribution / ownership** | `get_citation_overview` (counts URLs, not records; window = N whole +08 calendar days + today on the citation-creation axis — read `caliber` + `window` from the response) |
| One domain / one page deep-dive | `get_domain_detail` (the `/sources/citations/<root_domain>` drill-down) / `get_url_detail` — pick the caliber: `window_caliber="page"` (same `caliber` + `window` contract as the domain drill-down; `share` raw 0–1, shown with one decimal — but **not** the pages-tab row: lookup-URL grain and a denominator that keeps redirect links) or `window_caliber="rolling"` (default; tool-only: lookup-URL grain + rolling or custom `[start_date, end_date)` window, adds ChatGPT search sources and `prompt_id` filter — not a page row) |
| The cited-domain table: per-domain delta, mentioned brands, "mentions you", search / sort / paging | `get_citation_overview` `section="table"` (same read model as the page) |
| Content gaps (competitor cited there, you not) | `get_citation_overview` `section="table"`, `gap_only=true` (domains, the page caliber; for one domain's prompts use `get_domain_detail` `prompts[]`) |
| Standing **vs competitors** | `get_brand_board` (**tracked-brand caliber**, `caliber=tracked_brand_v1` — it *is* the in-app /overview board under any time_range / platform / topic_ids / country: rows = the competitors you track, `visibility` = mentioned ÷ counted answers, same formula for you; `avgRank` = position among tracked brands only; `computing=true` rows have null numbers; `rows[].entityId` is a tracked-brand id — pass it to `list_brand_answers` `tracked_brand_id`, not to `get_competitor_list`; `include_trend=true` for the daily chart) · `get_platform_matrix` `dimension=competitor` (legacy discovered-brand record-weighted — not headline) |
| How AI *describes* the brand (verbatim) | `list_brand_answers` `view="mention_samples"`; vs rivals → `get_competitor_cooccurrence` |
| Topic-level analysis | `get_topic_list` (ids, free) → `get_topic_analytics` (pass `topic_ids`) or `get_daily_trend` `breakdown="topic"` for day-level topic trends |
| Sentiment (brand-wide distribution / daily trend / per platform — no verbatim highlights, use `list_brand_answers` `view="mention_samples"` for those) | `get_sentiment_dashboard` |
| The brand library (own brand + tracked competitors + system suggestions + removed), same rows as Settings › Brand | `get_competitor_list` (competitors = `status="tracked"` and `is_own_brand=false`) |
| Site AI-readiness audit | `get_audit_list` → `get_audit_detail` (the report header + single-page checks + fix copy in `checksMeta`) → `get_audit_detail` `section="pages"` for a site audit's per-page results / `fetch_quality=unusable` pages |
| Traffic (if GA4 connected) | `get_traffic_data` `source="ga4"` (add `page_path` for one page). Whole-site vs AI-referred fields live in the same payload — see the catalog row before quoting a number; the page opens on 7d, the tool defaults to 30d |
| AI crawlers hitting the site (if Cloudflare connected) | `get_traffic_data` `source="cloudflare"` — bots fetching pages, **not** visitors arriving from AI answers (that is `source="ga4"`). Two calibers to keep straight: `changes.blockedEvents` is always `null` (never computed), and `blockedEvents[]` is capped at 50 rows (`blocked_events_limit`) — quote per-crawler block counts from the uncapped `blockedCrawlerSummary` |
| Archived prompts — list them | `get_prompt_list status=archived` (the /prompts Archived tab; no separate read tool). `get_prompt_detail` / `get_prompt_record_detail` work on archived prompts by id |
| Archive / restore a prompt | `archive_prompt` (write grant; `restore=true` to bring it back; idempotent). Archived prompts refuse `trigger_prompt` until restored |
| Tag prompts in bulk / rename a tag | `update_prompt_tags` (write grant): `action=add\|remove` with `prompt_ids` + `tags`; `action=rename` with `old_name` + `new_name` |
| Move prompts to a topic / ungroup | `move_prompts_to_topic` (write grant): `prompt_ids` + `topic_id` from `get_topic_list`, or `topic_id=null` |

> `display_data` / `display_chart` and `web_search` / `fetch_page` are **in-app agent only** —
> not exposed over MCP. MCP results are plain JSON (no `_ref`).
>
> `get_prompt_list` computes SoM / competitors only when you pass `include_competitors=true`
> (default rows carry `competitorsDeferred: true` and omit `som` / `competitorMentions`, like the
> page's first screen). `get_prompt_detail` is **windowed** (default 30 days) — its numbers are
> not comparable to the old all-time payload (`include_lifetime=true` still returns that,
> deprecated).

### Public source domains (every token — no plan gate)
| You want… | Use |
|---|---|
| Most-cited source domains across all AI answers, each with its **AI DA** (0–100 domain authority) | `get_public_sources_overview` |
| One source domain's profile; add `include_scorecard=true` for the AI DA breakdown (authority/placement/breadth + rank/momentum/integrity) | `get_public_source_domain_detail` |
| **Which topics a source funnels AI toward a brand** ("where does reddit.com steer AI to competitor X?") | `get_public_source_brand_conduit` |

### Public / industry (Grow tier and above)
| You want… | Use |
|---|---|
| The "as of" date + 30/60/90d windows the public pages use (call first; free) | `get_public_coverage` view=`data_window` |
| Valid locales / platforms for an entity or scope (free) | `get_public_coverage` view=`locales` / `platforms` |
| Resolve a brand/category/topic name → IDs | `search_public_entities` |
| Category leaderboard / who leads | `get_public_category` view=`brand_leaderboard` |
| Where to invest (winnable topics) | `get_category_whitespace` |
| Who's gaining/losing share | `get_category_brand_momentum` |
| What AI is being asked in our space | `get_public_search_queries` mode=`territories` → same tool, mode=`query_detail` |
| Which brand OWNS each cross-topic demand root | `get_public_search_queries` mode=`territories` |
| Cross-category **AI shelf leaderboard** (hot / climbers / entrants, week-over-week) | `list_public_shopping_products` view=`boards` |
| One category's AI shelf (latest batch vs previous, channels, price tiers) | `list_public_shopping_products` (view=`products`, default) |
| One product's full AI analysis (shelves, trend, rivals, channels) | `get_public_shopping_product_detail` (mode=`card` for a cheap preview) |
| One topic: overview, leaderboard, SoM trend, prompt matrix, every prompt, citation domains, commerce | `get_public_topic` view=`overview` / `brand_leaderboard` / `som_trend` / `prompt_matrix` / `prompts` / `citation_domains` / `commerce` |
| Compare 2–4 brands head-to-head | `get_public_brand` with `brand_ids` + `view` (e.g. `visibility`; country+language **required**) |
| How AI perceives a brand | `get_public_brand` view=`perception` → view=`perception_mentions` |
| Does Google ranking convert into AI Overview citations (AIO only) | `get_public_brand` view=`rank_citation` → view=`rank_citation_rows` |
| Is a topic worth targeting | `get_public_topic` view=`difficulty` |
| Bridge my brand → public dataset | `resolve_my_brand_public` (`bestMatch` = the in-app industry-profile decision; `ambiguous=true` means the app refuses to pick — do not guess from `candidates`) |

Cross-ref rule: for record counts/rates use `get_brand_overview` (not `get_citation_overview`,
which counts URLs); for trends use `get_daily_trend` (not by paginating citations).
Window rule for the page-window citation tools (`get_citation_overview` / `get_domain_detail` /
`get_url_detail window_caliber="page"`): their `time_range` is **N whole Asia/Shanghai calendar days on the
citation-creation axis plus today** (matches the /sources/citations page), not the rolling
`now − N×24h` preset window of `get_brand_overview` (whose `custom` range is instead an exact
+08 business-day span, echoed as full ISO instants) — never subtract one from the other; quote the
`window` each response returns. Their `platform` (and `get_url_detail`'s rolling caliber)
must be `all` or an **active** platform the brand is entitled to
(exactly the page's platform chips) — an unknown, un-entitled or retired code (e.g. a
`claude` / `grok` entry left in an old entitlement list) returns `{ error }` listing the
allowed codes, never a silent fall-back to all. Shares: the page shows one decimal — format
the raw `share` (0–1) fields; integer `percentage` / `ownership` points cannot be turned back
into the page's number. `caliber="legacy"` means the derived layer was unavailable and
the old query ran instead — its `window` then differs by tool: `get_citation_overview` reports
`startDay..endDay` **business days (+08)** on `prompt_record.record_date` (the old predicate is
day-granular, not an instant); `get_domain_detail` / `get_url_detail` (page caliber) report an exact
`start..end` instant pair on citation `created_at` (rolling N×24h). Quote whichever you got.

> No deprecated aliases are listed (0.7.0): the brand-own and public old names — including the
> 0.6.x forwarding aliases — left `tools/list`. `/api/mcp/v1` (also served at `/api/mcp`) is MCP v1
> (`GEOly-MCP-Version: 1`); the 34 old names are not part of v1: they stay hidden and callable until 2026-11-30 and are then
> removed (the three non-drop-in ones — `get_competitor_overview`, `get_brand_citations_daily`,
> `get_content_opportunities` — already only return a free `TOOL_REMOVED` notice); always call the
> new names. Old → new: tools-catalog § Pre-0.7.0 brand-own names and § Pre-0.7.0 public names
> (also CHANGELOG 0.7.0 § Versioning). `query_analytics` (deprecated in 0.7.2) was removed in October
> 2026 and answers the same free `TOOL_REMOVED` notice until 2026-11-30 — tools-catalog § Removed after
> 0.7.0; use `get_daily_trend`.

## Recipes

**KPI baseline (always start here)**
```json
{ "tool": "get_brand_overview", "args": { "time_range": "30d" } }
```
Read `aigvr.citationRate` / `aigvr.mentionRate` / `aigvr.score` — the report headline.

**Honest daily trend**
```json
{ "tool": "get_daily_trend",
  "args": { "breakdown": "platform", "start_date": "2026-09-21", "end_date": "2026-10-20" } }
```
Plot `rows` as-is (quote `businessDate`); treat absent days as "no collection" (check
`completedRecords`). For a window value read `totals` — don't simple-average the days.
Citation URL counts are not in it — use `get_citation_overview`. `status="not-ready"` (with
`reason`): `day-key-epoch` / `previous-window:day-key-epoch` = the window (or, with
`compare_previous`, the previous one) starts before 2026-04-13, where the derived data begins —
move `start_date` later; `flag-off:…` = not enabled on that server. Don't retry those two. Any
other reason = the window is not built yet (shortly after midnight UTC+8, or after a topic /
country change) — say so and retry in a few minutes.

**Citation sources for a prompt**
```json
{ "tool": "get_prompt_citations",
  "args": { "prompt_id": "<id>", "deduplicate": true, "limit": 500 } }
```

**Text-defined subset (e.g. non-branded), 3-metric daily series** — `get_daily_trend` has no text
filter. For a lasting split, move those prompts into a topic (`move_prompts_to_topic`) and read
`get_daily_trend` `breakdown="topic"` (or `breakdown="total"` + `topic_ids`) — it picks the move up
after the next derived refresh. For one window value of a text subset, `get_prompt_list`
`search=<word>` returns `summary` (record-weighted visibility / mentionRate / citationRate of the
whole filtered set; include-only, matches prompt text or tag name). The old `prompt_text_include` /
`prompt_text_exclude` filters were removed with `query_analytics` (October 2026) and have no
replacement — there is no exclude-by-text daily series.

**Period-over-period in one call (delta per platform, with coverage check)**
```json
{ "tool": "get_daily_trend",
  "args": { "breakdown": "platform", "start_date": "2026-09-13", "end_date": "2026-09-19",
            "compare_previous": true } }
```
Each `totals` row (one per platform, whole window) carries `previous.mentionRate` /
`delta.mentionRate` (percentage points); the daily `rows` carry the same per day. Quote
`window.current.days_with_data` vs `window.previous.days_with_data` alongside the delta — if the
current window has fewer collection days, say so instead of calling the change a trend.

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
