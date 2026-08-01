"""FastMCP server for Raindrop.io extension tools."""

import os

import httpx
from fastmcp import FastMCP

API_BASE = "https://api.raindrop.io/rest/v1"

mcp = FastMCP(
    "Raindrop Extensions",
    instructions="""\
Supplementary Raindrop.io tools for operations the official Raindrop MCP does not expose.

- Collection sort order lives in the `sort` integer on each collection. Lower values
  appear first in most Raindrop UI views. This server lets you rewrite those values
  recursively (e.g. alphabetize siblings at every level).
- All destructive/write operations default to dry_run=True. The caller must pass
  dry_run=False explicitly to commit changes.
""",
)


def get_http_client() -> httpx.Client:
    """Return an authenticated httpx client for the Raindrop REST API."""
    token = os.environ.get("RAINDROP_TOKEN")
    if not token:
        raise ValueError(
            "RAINDROP_TOKEN environment variable is required. "
            "Get a test token at raindrop.io → Settings → Integrations → For Developers."
        )
    return httpx.Client(
        base_url=API_BASE,
        headers={"Authorization": f"Bearer {token}"},
        timeout=30.0,
    )


from jdf_mcp_raindrop_extensions.tools import collections  # noqa: E402, F401
