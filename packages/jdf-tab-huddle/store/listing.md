# Store listing: Huddle v1.0.0

The text for the dashboard's **Store listing** tab, ready to paste. The requirements behind each field, with their sources, are in [README.md](README.md).

## Title: Huddle — tab organizer

Decided by the user. The store doesn't have a title field: it shows the manifest's `name` as the title (the listing tab only takes what "isn't included in the metadata of the manifest"). Today `src/manifest.json` has `"name": "Huddle"`, so **the manifest's name has to change** to `Huddle — tab organizer` before the v1.0.0 zip is uploaded. It is 22 characters, well under the manifest's 75. That belongs in the v1.0.0 version-bump PR, not here (this branch changes no product files). The change also means:

- `short_name` stays `Huddle`, for places with little room.
- Chrome shows the new name in the install dialog, at `chrome://extensions` and as the toolbar button's tooltip. After a refused Open links as tabs, the tooltip goes back to `Huddle` (`src/background.js`, `chrome.action.setTitle`), so it should then use the manifest's name.
- `e2e/tests/trust-boundary.spec.js` finds Huddle's content script by its isolated world's name, which is the manifest's name (`c.name === 'Huddle'`), so that spec has to change with it.
- DESIGN.md and PRODUCT.md say the user-facing name is **Huddle**. They should say that the store title is "Huddle — tab organizer" and that Huddle stays the name everywhere else.

## Summary

From the manifest's `description` (the store shows it as is; Chrome's limit is 132 characters, and this is 122):

```text
Organize your browser tabs: sort, group, de-duplicate, snooze, and open links as tabs. Optional AI suggestions for groups.
```

## Detailed description

Plain text: the field takes no Markdown or HTML. Paste everything inside the block.

```text
Huddle organizes your browser tabs. Open it from the toolbar or with Alt+Shift+U (Option+Shift+U on a Mac), then press one key for each action. It works on the tabs you already have, in every window, and keeps your tab groups, pinned tabs and Split Views as they are.

Sort, group and tidy
• Sort a window's tabs, or every window's, by address.
• Close duplicate tabs in one window, in each window, or across all windows.
• Ungroup a window, move one site's tabs into a window of their own, or give each site with several tabs its own window.
• Merge all your windows into one.
• Copy the addresses of this window's tabs, or of every window's.
• Groups or Flat: keep your tab groups together while you sort, or treat every tab on its own.

Snooze tabs until later
• Put a tab, the selected tabs, a whole window or a tab group to sleep until later today, tonight, tomorrow, the weekend, next week or a time you pick.
• They close now and come back on time, with a notification. A group comes back as the same group.
• The nap room lists everything that's sleeping, with Wake now and Discard (which you can undo).

Open links as tabs
• On a page full of links, press Alt+Shift+L (or the popup's Open links as tabs), then hold Z and drag a box over the links you want. They open as tabs next to the current one.
• Huddle gets access only to that one tab, only after you start it there, and only until the page reloads.

Suggest groups with AI (optional)
• Organize with AI suggests tab groups for the current window, using your own OpenRouter key and the model you choose.
• You review the proposal, rename, recolour or move tabs between groups, and nothing changes until you press Apply groups.
• Everything else in Huddle works without it, and without a key.

Keyboard first
• Every popup action has a single-key shortcut, shown on its button, and every page works with the keyboard and a screen reader.

Privacy
Huddle has no account, no server and no analytics. Your settings, your OpenRouter key and your snoozed tabs stay in your browser; only the Open links as tabs key syncs with your Chrome sign-in. Nothing leaves your computer unless you use Organize with AI: then that window's tab titles and addresses (without the part after ? or #) go to OpenRouter with your key. Huddle asks for no access to websites. Privacy policy: https://joaof.eu/privacy/huddle/

Huddle is open source (MIT): https://github.com/joaodinissf/jdf-suite/tree/main/packages/jdf-tab-huddle
```

## Category

**Productivity → Workflow & Planning**, where tab managers usually sit. The store split its old Productivity category into sub-categories (Workflow & Planning, Tools, Communication, Developer Tools, Education); the documentation doesn't list them, so pick from the dashboard's menu. **Tools** is the fallback if Workflow & Planning isn't offered.

## Language

**English**. The listing, Huddle's interface and its messages are in English, with no other locales.

## Graphic assets

| Field | File | Size |
|---|---|---|
| Store icon | `src/icons/icon128.png` (also in the zip) | 128 × 128 |
| Screenshot 1 | `store/screenshots/1-popup.png` | 1280 × 800 |
| Screenshot 2 | `store/screenshots/2-snooze.png` | 1280 × 800 |
| Screenshot 3 | `store/screenshots/3-nap-room.png` | 1280 × 800 |
| Screenshot 4 | `store/screenshots/4-open-links-as-tabs.png` | 1280 × 800 |
| Screenshot 5 | `store/screenshots/5-organize-with-ai.png` | 1280 × 800 |
| Small promo tile | `store/screenshots/promo-small-440x280.png` | 440 × 280 |
| Marquee promo tile | none (optional; only needed to be featured in the marquee) | 1400 × 560 |
| Promo video | none (see [README.md](README.md#what-you-do-by-hand-in-the-dashboard)) | |

All are 24-bit PNGs with no alpha channel, made by `store/screenshots/make-screenshots.mjs` from this checkout's `src/`, with invented tabs on reserved `example.com` addresses and a fake OpenRouter.

## Additional fields

| Field | Value |
|---|---|
| Official URL | Leave empty, unless you verify `joaof.eu` in Google Search Console first (the menu lists only verified sites). |
| Homepage URL | https://github.com/joaodinissf/jdf-suite/tree/main/packages/jdf-tab-huddle |
| Support URL | https://github.com/joaodinissf/jdf-suite/issues |
| Mature content | Off |

## Privacy policy URL

https://joaof.eu/privacy/huddle/ (on the **Privacy** tab; see [privacy-practices.md](privacy-practices.md)).
