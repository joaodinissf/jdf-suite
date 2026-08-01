"""Collection-level operations not exposed by the official Raindrop MCP."""

import time

import httpx

from jdf_mcp_raindrop_extensions.server import get_http_client, mcp

SORT_STEP = 1000  # spacing between sort values leaves room for manual insertions
PACING_SECONDS = 0.6  # keeps us under Raindrop's 120 req/min per-user cap
MAX_RETRIES = 4


def _put_with_retry(client: httpx.Client, path: str, payload: dict) -> None:
    """PUT with retry on 429 (honoring Retry-After) and exponential backoff on 5xx."""
    for attempt in range(MAX_RETRIES):
        response = client.put(path, json=payload)
        if response.status_code == 429:
            time.sleep(int(response.headers.get("Retry-After", 30)))
            continue
        if 500 <= response.status_code < 600:
            time.sleep(2**attempt)
            continue
        response.raise_for_status()
        return
    response.raise_for_status()


def _parent_id(collection: dict) -> int | None:
    """Extract parent collection id from a Raindrop collection payload."""
    parent = collection.get("parent")
    if isinstance(parent, dict):
        return parent.get("$id")
    return None


def _fetch_all_collections(client) -> list[dict]:
    """Return every user collection (root + nested children)."""
    roots = client.get("/collections").json().get("items", [])
    kids = client.get("/collections/childrens").json().get("items", [])
    return roots + kids


@mcp.tool()
def sort_collections_by_name(dry_run: bool = True) -> dict:
    """Recursively sort sibling collections alphabetically by title at every level.

    Preserves the tree structure (parents stay put); only reorders siblings within
    each parent. New `sort` values are assigned as multiples of 1000 so manual
    re-ordering in the Raindrop UI afterwards remains possible without collisions.

    Args:
        dry_run: When True (default), returns the proposed changes without calling
            the API. Pass False to commit.

    Returns a dict with:
        - changed: list of {collection_id, title, parent_id, old_sort, new_sort}
        - total_collections: number of collections scanned
        - applied: bool, whether changes were written
    """
    with get_http_client() as client:
        collections = _fetch_all_collections(client)

        by_parent: dict[int | None, list[dict]] = {}
        for c in collections:
            by_parent.setdefault(_parent_id(c), []).append(c)

        changes: list[dict] = []
        for siblings in by_parent.values():
            siblings.sort(key=lambda c: c["title"].casefold())
            for index, coll in enumerate(siblings):
                new_sort = (index + 1) * SORT_STEP
                if coll.get("sort") != new_sort:
                    changes.append(
                        {
                            "collection_id": coll["_id"],
                            "title": coll["title"],
                            "parent_id": _parent_id(coll),
                            "old_sort": coll.get("sort"),
                            "new_sort": new_sort,
                        }
                    )

        if not dry_run and changes:
            for change in changes:
                _put_with_retry(
                    client,
                    f"/collection/{change['collection_id']}",
                    {"sort": change["new_sort"]},
                )
                time.sleep(PACING_SECONDS)

        return {
            "changed": changes,
            "total_collections": len(collections),
            "applied": (not dry_run) and bool(changes),
        }
