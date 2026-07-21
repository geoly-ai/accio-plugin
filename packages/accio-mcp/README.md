# @geoly/accio-mcp

GEOly connector CLI for [Accio Work](https://www.accio.com/work) — browser OAuth sign-in plus a
stdio-to-Streamable-HTTP MCP bridge to `https://app.geoly.ai/api/mcp`.

This package is consumed by the GEOly Accio Work plugin's `cli-login` connector declaration:

- `npx -y @geoly/accio-mcp login` — opens the browser, runs the GEOly OAuth 2.1 (PKCE + dynamic
  client registration) flow, and writes `~/.geoly/credentials` (plaintext top-level
  `account`/`email` labels are an Accio contract — do not move or encrypt them).
- `npx -y @geoly/accio-mcp` — starts a stdio MCP server that forwards every JSON-RPC message to
  the GEOly remote MCP endpoint (stateless Streamable HTTP, POST-only) with the stored bearer
  token, handling token refresh and SSE-formatted responses transparently.

## Headless / CI

Set `GEOLY_API_KEY` to a read-only `geom_…` static token to skip the browser flow entirely; it
takes precedence over the stored login.

## Commands

| Command | Effect |
|---|---|
| `login` | Browser sign-in, writes `~/.geoly/credentials` |
| `logout` | Deletes the stored session |
| `status` | Prints sign-in status |
| *(none)* | Runs the stdio MCP bridge |
| `--version` / `--help` | The usual |

## Environment

| Variable | Effect |
|---|---|
| `GEOLY_API_KEY` | Use a static read-only token instead of OAuth |
| `GEOLY_BASE_URL` | Override base URL (testing only) |
| `GEOLY_DEBUG` | Verbose bridge logs on stderr |

Requires Node.js ≥ 18.17. Zero runtime dependencies.
