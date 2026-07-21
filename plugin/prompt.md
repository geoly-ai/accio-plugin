# GEOly plugin guide

This plugin provides **read access to GEOly** (https://www.geoly.ai) — AI search visibility
analytics: how a brand is mentioned and cited in ChatGPT, Perplexity, Gemini, Grok and Google AI
answers.

Routing rules:

- Any question about AI visibility, brand mentions/citations in AI answers, AIGVR, Share of
  Model, GEO optimization, competitor AI benchmarks, or AI search demand → read the
  **geoly-geo** skill first, then use the GEOly MCP tools (discover them via
  `accio-mcp-cli toolkit geoly`).
- Key invariants: resolve the org/brand **before** brand tools (`list_brands` →
  `get_brand_overview`); quote headline KPIs only from `get_brand_overview`; never
  arithmetic-average daily series.
- If GEOly tools are unreachable, the GEOly connector is not connected — point the user to the
  plugin detail page → App Authorization → Connect. Do not probe the endpoint manually (a 401
  without login is expected).
