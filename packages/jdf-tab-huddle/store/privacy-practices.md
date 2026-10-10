# Privacy practices: Huddle v1.0.0

The answers for the dashboard's **Privacy** tab, ready to paste. They match the shipped manifest (`src/manifest.json`) and the privacy policy at https://joaof.eu/privacy/huddle/ (the v1.0.0 text, "Applies to Huddle 1.0.0 and later"). `tests/store-listing.test.js` fails if a permission is added to or removed from the manifest without its justification here.

## Single purpose

```text
Huddle organizes your browser tabs: it sorts, groups, de-duplicates, extracts and merges the tabs and tab groups you have open, snoozes tabs until a time you choose, opens a set of links on a page as tabs, and can suggest tab groups with AI for you to review. Every feature acts on your own tabs and tab groups, from one toolbar popup.
```

How each feature serves that purpose, for reference (and for a reviewer who asks):
- **Sort, Deduplicate, Ungroup, Extract domain, Split domains, Merge windows, Copy URLs, Compact and Expand (Split View):** arrange the tabs and tab groups that are open.
- **Snooze and the nap room:** take tabs off the tab strip until a chosen time, then put them back, groups included.
- **Open links as tabs:** turn the links you select on a page into tabs, so a list of links becomes tabs to organize.
- **Organize with AI:** proposes tab groups for the current window; nothing changes until you apply them.

## Permission justifications

One per permission in the manifest. Huddle has **no host permissions** and **no content scripts** declared in the manifest.

### `tabs`

```text
Huddle reads the titles, addresses, positions and pinned state of your open tabs so it can sort them, close duplicates, move them between windows, snooze and restore them, and show them on the organize page. Without it, Chrome hides tab addresses and titles from extensions.
```

### `tabGroups`

```text
Huddle reads and rebuilds your tab groups (title, colour, collapsed state) so sorting, merging and moving tabs keep each group together, a snoozed group wakes as the same group, and Organize with AI can create the groups you approve.
```

### `storage`

```text
Huddle keeps its settings, your snoozed tabs (their titles and addresses, so they can be reopened) and, if you add one, your own OpenRouter API key in Chrome's extension storage on your computer. Only the Open links as tabs key and modifier use Chrome sync, so they follow your Chrome profile. Nothing is stored on any server of ours; there isn't one.
```

### `alarms`

```text
Huddle schedules one alarm per snooze so the tabs reopen at the time you chose, even after the browser restarts, and one to delete your OpenRouter key when the expiry you picked is reached.
```

### `notifications`

```text
Huddle shows a notification when snoozed tabs wake up (clicking it takes you to them), and when Split domains finishes or fails without its dialog open.
```

### `favicon`

```text
The organize page shows each tab's icon from Chrome's own favicon cache, so reviewing an AI proposal never fetches anything from the websites themselves.
```

### `activeTab`

```text
Used only by Open links as tabs. When you press its shortcut (Alt+Shift+L) or the popup's Open links as tabs button, Chrome gives Huddle temporary access to that one tab, so Huddle can start the link selector there. It has no access to any other tab or site, and the access ends when the page reloads or you leave it.
```

### `scripting`

```text
Used only with activeTab, for Open links as tabs: after you start it on a page, Huddle injects its own bundled script (content-clumper.js) into that tab. The script lets you hold a key and drag a rectangle over links, reads the addresses of the links inside it, and asks Huddle to open them as tabs. It reads nothing else from the page, sends nothing anywhere, and stops when the page reloads.
```

### Host permissions

None. If the dashboard asks: Huddle requests no host permissions. Organize with AI calls OpenRouter's public API (https://openrouter.ai/api/v1), which accepts requests from any origin (CORS), so it needs no permission for that site.

### Commands (not a permission, for reviewers)

The manifest declares two keyboard shortcuts: `_execute_action` (Alt+Shift+U) opens the popup, and `open-links` (Alt+Shift+L, Alt+Shift+K on ChromeOS) starts Open links as tabs on the current page, which is the user gesture that grants `activeTab`. Both can be changed at `chrome://extensions/shortcuts`.

## Remote code

**No, I am not using remote code.**

```text
All of Huddle's JavaScript is in the package. The only script Huddle injects into a page is its own bundled file content-clumper.js. Organize with AI sends a request to OpenRouter's API and receives JSON data (a proposal of tab groups), which Huddle checks and displays; it never evaluates or runs anything it receives.
```

## Data usage

What Huddle collects or handles, in the dashboard's categories. The store counts data handled only on the device too (User Data FAQ 3), so each answer says what stays local and what leaves.

| Category | Answer | Why |
|---|---|---|
| Personally identifiable information | **No** | Huddle asks for no name, email, address or account. |
| Health information | **No** | None. |
| Financial and payment information | **No** | None. OpenRouter billing happens in your OpenRouter account, not in Huddle. |
| Authentication information | **Yes** | Your own OpenRouter API key, if you add one: stored in Chrome's local extension storage, readable only by Huddle's own pages, and sent only to OpenRouter to authorize your requests. |
| Personal communications | **No** | None. |
| Location | **No** | None. |
| Web history | **Yes** | Huddle reads your tabs' titles and addresses to organize them, and keeps snoozed tabs' titles and addresses locally. Only when you run Organize with AI are that window's titles and cleaned addresses (no query or fragment) sent to OpenRouter. |
| User activity | **Yes** | Disclosed for caution: on a page where you start Open links as tabs, Huddle watches its key and your mouse drag, on your computer, only to draw the selection and open the links you select. Nothing is recorded, stored or transmitted. |
| Website content | **Yes** | Disclosed for caution: the Open links as tabs script reads the addresses (hyperlinks) of the links inside the rectangle you drag, on your computer, to open them as tabs. It reads no text, images or other page content, and nothing is stored or transmitted. |

> **Website content and User activity: Yes, decided by the maintainer on 2026-10-10.** The dashboard's examples include hyperlinks (content) and mouse position and keystrokes (activity). Huddle's processing is local and transient, but over-disclosing costs nothing while an under-disclosure can lead to rejection, so both are ticked and justified as above.

### Certifications

Tick all three:
- **I do not sell or transfer user data to third parties, outside of the approved use cases.** Data goes to OpenRouter only when you run Organize with AI, as the feature itself (an approved use: necessary for the single purpose, at your request).
- **I do not use or transfer user data for purposes that are unrelated to my item's single purpose.** Tab data is used only to organize your tabs.
- **I do not use or transfer user data to determine creditworthiness or for lending purposes.**

## Privacy policy URL

https://joaof.eu/privacy/huddle/

## Data use statement

The dashboard's data usage section takes the checkboxes above and the policy URL; it has no free-text field of its own. This short statement mirrors the policy, for the listing's description (its Privacy paragraph says the same), for a reviewer who asks, or for any free-text box the dashboard adds:

```text
Huddle has no server, no account and no analytics. It reads your tabs and tab groups only to organize them. Your settings, your snoozed tabs and your OpenRouter key stay in Chrome's storage on your computer; only the Open links as tabs key and modifier sync with your Chrome sign-in. Nothing leaves your browser unless you start Organize with AI: then that window's tab titles and addresses (without their query and fragment), and any instructions you type, go to OpenRouter with your key, and OpenRouter passes them to a model provider. By default Huddle asks OpenRouter to skip providers that train on prompts. Huddle also loads OpenRouter's public list of models, without your key. Huddle's use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Full policy: https://joaof.eu/privacy/huddle/
```
