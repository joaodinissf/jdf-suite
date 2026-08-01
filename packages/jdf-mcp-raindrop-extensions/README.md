# jdf-mcp-raindrop-extensions

Supplementary MCP server for [Raindrop.io](https://raindrop.io) operations that the official Raindrop MCP server does not expose.

## Tools

- `sort_collections_by_name(dry_run=True)` — recursively sorts sibling collections alphabetically at every level of the tree.

## Auth

Set `RAINDROP_TOKEN` to a Raindrop test token or OAuth access token. Get one at raindrop.io → Settings → Integrations → For Developers → create app → Test Token.

## Run

```sh
uv run --project /path/to/jdf-mcp-raindrop-extensions python -m jdf_mcp_raindrop_extensions
```

Register with Claude Code:

```sh
claude mcp add --scope user --env RAINDROP_TOKEN=YOUR_TOKEN \
  raindrop-extensions \
  -- uv run --project /path/to/jdf-suite/packages/jdf-mcp-raindrop-extensions python -m jdf_mcp_raindrop_extensions
```
