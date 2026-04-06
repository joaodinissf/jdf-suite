# Extract All Domains to Tab Groups

## Summary

Add a new action that organizes tabs by domain into **Chrome tab groups** within the current window, rather than extracting them into separate windows. This provides a lighter-weight alternative to "Extract All Domains" that keeps everything in a single window while still achieving domain-based organization.

## Motivation

The existing "Extract All Domains" feature creates a new browser window per domain. This is useful for deep focus on specific domains but has drawbacks:

- Creates many windows, which can be overwhelming and clutter the taskbar/dock
- Harder to get back to a unified view of all tabs
- Heavy operation that's difficult to undo

Tab groups offer a middle ground: tabs are visually grouped and collapsible by domain, but remain in a single window. Users can collapse groups they're not using and expand them as needed.

## Behavior

### Trigger

A new button in both the "Tab Groups" and "Individual" mode sections of the popup UI:

- **Label:** "Group by Domain"
- **Position:** Near the existing "Extract All Domains" button

### Action Flow

1. **Analyze domain distribution** - Reuse the existing `analyzeDomainDistribution()` function to categorize all unpinned tabs by domain.

2. **Confirmation dialog** - If the total number of groups to create exceeds a threshold (e.g., 10), show a confirmation dialog similar to the existing one for Extract All Domains. The dialog should state: "This will create X tab groups in the current window."

3. **Create tab groups per domain:**
   - For each domain with 2+ tabs (`extractableDomains`): create a Chrome tab group containing all tabs for that domain.
   - For single-tab domains (`singleTabDomains`): collect them into a single "Misc" tab group.
   - Assign each group a **title** equal to the domain name (e.g., `github.com`, `example.com`). The "Misc" group is titled "Misc".
   - Assign **colors** from Chrome's available tab group colors (`grey`, `blue`, `red`, `yellow`, `green`, `pink`, `purple`, `cyan`, `orange`), cycling through them to maximize visual distinction.

4. **Sort within groups** - After grouping, sort tabs within each group alphabetically by URL (reuse `sortWindowTabs` logic or a shared comparator).

5. **Sort groups** - Order the groups alphabetically by domain name, with the "Misc" group placed last.

### Scope Options

Two variants, mirroring the existing sort/extract scope:

- **"Group by Domain (Current Window)"** - Only operates on tabs in the active window.
- **"Group by Domain (All Windows)"** - Operates on each window independently, creating domain groups within each window.

### Edge Cases

- **Pinned tabs:** Excluded from grouping entirely (consistent with all existing operations).
- **Already-grouped tabs:** If a tab is already in a group:
  - In "Tab Groups Mode": Preserve existing groups. Only create new groups for ungrouped tabs. If an existing group already contains tabs from a single domain, leave it as-is.
  - In "Individual Mode": Disband all existing groups first, then create fresh domain-based groups.
- **Single-tab windows:** If a window has only one unpinned tab, skip it (no group needed).
- **Domain with tabs across groups:** If tabs from the same domain exist in different groups (Tab Groups Mode), do not merge them - respect the user's existing group organization.

## API Usage

### Chrome APIs Required

All already permitted in `manifest.json`:

- `chrome.tabs.query()` - Get tabs
- `chrome.tabs.group({tabIds, groupId?, createProperties?})` - Add tabs to a group
- `chrome.tabGroups.update(groupId, {title, color, collapsed})` - Set group metadata
- `chrome.tabs.move()` - Reorder tabs within the window
- `chrome.tabs.ungroup()` - Remove tabs from groups (Individual Mode)

### New Functions (background.js)

- `handleGroupByDomain(windowScope, respectGroups, sendResponse)` - Main handler
- `performGroupByDomain(windowId, domainAnalysis, respectGroups)` - Per-window grouping logic
- `assignGroupColors(domains)` - Map domains to distinct colors

### Popup Changes (popup.html / popup.js)

- Add "Group by Domain" button(s) in both mode sections
- Wire up click handlers to send `groupByDomain` action message

## Confirmation Dialog

Reuse the existing `confirmation-dialog.html/js` infrastructure. Parameterize it to support both "windows to create" and "groups to create" messaging.

## Testing

### Unit Tests

- Domain-to-group mapping logic
- Color assignment cycling
- Handling of already-grouped tabs (both modes)
- Pinned tab exclusion
- Single-tab window skipping

### E2E Tests

- Group by domain in a single window with multiple domains
- Verify group titles match domain names
- Verify tabs are sorted within groups
- Verify pinned tabs are untouched
- Verify "Misc" group for single-tab domains
- Confirmation dialog for large numbers of groups
- Both "Current Window" and "All Windows" variants
