TODO - Tab Organizer Extension
Tab Groups Handling
Issue
The current extension does not handle Chrome tab groups properly. All operations (sorting, duplicate removal, moving tabs) ignore tab group memberships and can destroy group organization.

Current Problems
No tab group awareness: Code treats all tabs equally regardless of group membership
Group destruction during sorting: Sorting by URL scatters grouped tabs across different positions
No group preservation: Moving tabs between windows doesn't maintain group structure
Misleading variable names: tabGroups parameter refers to arrays of tabs, not Chrome tab groups
Required Changes
Add tab group detection

Use chrome.tabGroups.query() to get group information
Track group memberships for all tabs
Preserve groups during sorting

Sort tabs within each group independently
Maintain group boundaries and positions
Handle groups during duplicate removal

Consider keeping duplicates if they're in different meaningful groups
Or remove duplicates while preserving group structure
Support group operations when moving tabs

Use chrome.tabs.group() and chrome.tabs.ungroup() appropriately
Recreate groups when moving tabs between windows
Update variable naming

Rename tabGroups to tabArrays or windowTabs to avoid confusion
Impact
High: Affects all core functionality (sorting, deduplication, moving)
User Experience: Currently destroys user's tab organization
Priority: Should be addressed before adding new features
