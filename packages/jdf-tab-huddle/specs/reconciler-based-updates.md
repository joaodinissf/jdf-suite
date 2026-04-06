# Reconciler-Based State Updates

## Summary

Replace the current "destroy and recreate" approach to tab organization with a **reconciler** that computes the minimal diff between the current browser state and the desired target state, then applies only the necessary changes. This dramatically reduces the number of Chrome API calls, avoids unnecessary tab flickering, and preserves user context (scroll position, form state, media playback) in tabs that don't need to move.

## Motivation

Today, operations like "Extract All Domains" rebuild the entire tab layout from scratch:

- Every domain gets a new window, even if a window with only that domain's tabs already exists
- Tabs are moved out and re-sorted even if they're already in the correct position
- Tab groups are destroyed and recreated even if they already match the target
- Running the same operation twice does twice the work, when ideally the second run should be a no-op

This is wasteful and disruptive. A reconciler approach models the problem as: **given the current state, what is the minimum set of moves to reach the target state?**

## Architecture

### Three Phases

```
1. Snapshot    ──>  2. Plan    ──>  3. Apply
(current state)    (target state     (minimal mutations)
                    + diff)
```

### Phase 1: Snapshot Current State

Capture a complete representation of the current browser state:

```javascript
{
  windows: [
    {
      id: 123,
      focused: true,
      tabs: [
        {
          id: 456,
          url: "https://github.com/...",
          pinned: false,
          groupId: -1,       // -1 = ungrouped
          index: 0,
          windowId: 123
        },
        // ...
      ],
      groups: [
        {
          id: 789,
          title: "Work",
          color: "blue",
          collapsed: false,
          tabIds: [456, 457]  // derived from tab data
        }
      ]
    }
  ]
}
```

**Implementation:** A new `snapshotBrowserState()` function that calls `chrome.windows.getAll({populate: true})` and `chrome.tabGroups.query({})`, then assembles the structure above.

### Phase 2: Compute Target State

Each operation (sort, extract, group-by-domain, etc.) produces a **target state** - the desired final arrangement of tabs, windows, and groups. The target state uses the same schema as the snapshot but represents the intended outcome.

**Target state generators** are pure functions:

```javascript
function targetForExtractAllDomains(snapshot, options) → targetState
function targetForSortCurrentWindow(snapshot, options) → targetState
function targetForGroupByDomain(snapshot, options) → targetState
// etc.
```

These functions:
- Take the current snapshot and operation-specific options
- Return a target state describing the desired arrangement
- Are pure (no side effects) and therefore easily unit-testable
- Reuse existing tab IDs where possible (a tab that stays put keeps its ID)
- Use `null` IDs for new windows/groups that need to be created

### Phase 3: Diff and Apply

A `reconcile(currentState, targetState)` function computes and executes the minimal set of mutations:

#### Diff Algorithm

1. **Match windows:** Pair current windows to target windows. A target window that contains a superset of tabs already in a current window is matched to that window (no need to create a new one).

2. **Identify tab moves:** For each tab, compare its current `(windowId, index)` to its target `(windowId, index)`. Only tabs whose position changes need a `chrome.tabs.move()` call.

3. **Identify group changes:** For each tab, compare its current `groupId` to its target group. Only regroup tabs whose membership changes. If a target group matches an existing group (same tabs, same properties), reuse it.

4. **Identify window lifecycle:** Target windows with no matching current window need `chrome.windows.create()`. Current windows with no tabs in the target state can be closed (or left as empty new-tab windows, depending on user preference).

5. **Identify group property updates:** If a group exists but its title or color changed, issue a `chrome.tabGroups.update()`.

#### Mutation Plan

The diff produces an ordered list of mutations:

```javascript
[
  { type: 'create_window', tabs: [tabId1, tabId2], props: {...} },
  { type: 'move_tabs', tabIds: [...], windowId: X, index: Y },
  { type: 'create_group', tabIds: [...], windowId: X, props: {title, color} },
  { type: 'update_group', groupId: G, props: {title, color, collapsed} },
  { type: 'ungroup_tabs', tabIds: [...] },
  { type: 'close_window', windowId: W },
]
```

Mutations are ordered to avoid conflicts:
1. Create new windows first (so move targets exist)
2. Move tabs between windows
3. Reorder tabs within windows
4. Create/update/remove groups
5. Close empty windows last

#### Execution

Apply mutations sequentially, with the 200ms settling delay only after window creation (not after every move). Batch `chrome.tabs.move()` calls where possible.

### Idempotency

A key property: running any operation twice in a row should produce zero mutations on the second run. The diff between the post-operation state and the target state should be empty. This should be verified by tests.

## Refactoring Existing Operations

Each existing handler in `background.js` would be refactored into:

| Current Handler | New Target Generator |
|----------------|---------------------|
| `handleSortCurrentWindow()` | `targetForSortCurrentWindow(snapshot)` |
| `handleSortAllWindows()` | `targetForSortAllWindows(snapshot)` |
| `handleExtractDomain()` | `targetForExtractDomain(snapshot, domain)` |
| `handleExtractAllDomains()` | `targetForExtractAllDomains(snapshot)` |
| `handleMoveAllToSingleWindow()` | `targetForMoveAllToSingleWindow(snapshot)` |
| `handleRemoveDuplicates*()` | `targetForRemoveDuplicates(snapshot, scope)` |

The confirmation dialog logic stays outside the reconciler - it runs before target computation, using the same analysis functions.

## New Module Structure

```
src/
  background.js          # Message handler, delegates to reconciler
  reconciler/
    snapshot.js           # snapshotBrowserState()
    diff.js               # reconcile(current, target) → mutations[]
    apply.js              # executeMutations(mutations[])
    targets/
      sort.js             # targetForSort*()
      extract.js          # targetForExtract*()
      group-by-domain.js  # targetForGroupByDomain()
      dedup.js            # targetForRemoveDuplicates()
      move-all.js         # targetForMoveAllToSingleWindow()
```

Note: Since the extension currently uses a single `background.js` file without a build step, the module structure above may need to be implemented as clearly separated sections within `background.js`, or a bundler (e.g., esbuild) could be introduced. This is an implementation decision to be made during development.

## Testing

### Unit Tests (Pure Functions)

The biggest win of this architecture is testability. Target generators and the diff algorithm are pure functions that can be tested without Chrome API mocks:

- **Target generators:** Given snapshot X, assert target state Y
- **Diff algorithm:** Given current A and target B, assert mutations [M1, M2, ...]
- **Idempotency:** Given state S and target T derived from S through operation O, applying O again produces an empty mutation list
- **Edge cases:** Empty windows, pinned-only windows, single-tab windows, tabs already in correct position

### E2E Tests

- Run "Extract All Domains" → verify result → run it again → verify no tabs moved (idempotency)
- Manually move one tab after extraction → run again → verify only that tab moves back
- Sort a window → add one new tab → sort again → verify only the new tab moves
- Verify scroll position / media playback preserved for tabs that don't move

### Performance Tests

- Measure number of Chrome API calls before and after reconciler for typical scenarios
- Benchmark with 50+ tabs across 5+ windows

## Migration Path

This is a significant refactor. A phased approach is recommended:

1. **Phase A:** Introduce `snapshotBrowserState()` and the state schema. Add it alongside existing code without changing behavior.
2. **Phase B:** Implement the diff/reconcile engine with comprehensive unit tests.
3. **Phase C:** Implement target generators for each operation, one at a time, starting with the simplest (`sortCurrentWindow`).
4. **Phase D:** Replace existing handlers with reconciler-based versions, one operation at a time. Each replacement should be gated behind feature-level tests that verify identical outcomes.
5. **Phase E:** Remove old handler code once all operations are migrated and stable.
