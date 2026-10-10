# Notes for Chrome Web Store reviewers

For the dashboard's **Test instructions** tab (optional, but it saves the reviewer guessing). Huddle needs no account, and has no credentials to share. Paste the block below.

```text
Huddle needs no account, no sign-in and no network. Every feature except Organize with AI works offline, straight after install.

Try it
1. Open a few tabs on any websites, including two of the same page, and press Alt+Shift+U (Option+Shift+U on a Mac) or click Huddle's toolbar button.
2. Each button shows its key. Press S to sort the window by address, D to close the duplicate, X to move each site with several tabs into its own window, M to merge them back.
3. Snooze: press T, then a time. The tab closes and is listed under Sleeping. Choose a custom time a minute or two ahead to see it come back with a notification, or use Wake (1) right away. N opens the nap room, the full list.
4. Groups and Flat at the top decide whether actions keep Chrome's tab groups together.

Open links as tabs
1. Go to an ordinary web page with several links (for example a Wikipedia article). It can't start on chrome:// pages, other extensions' pages or the Chrome Web Store itself; there the popup's button is dimmed and says why, and the shortcut shows a "!" on the toolbar button.
2. Press Alt+Shift+L, or open the popup and press K (Open links as tabs). A hint at the bottom of the page says it is on.
3. Hold Z and drag a rectangle over some links. On release they open as background tabs next to the current one. More than 10 links asks first; at most 25 open.
This is the only time Huddle touches a page: the shortcut or button grants activeTab for that one tab, and Huddle injects its bundled content-clumper.js there. It ends when the page reloads.

Organize with AI (optional)
This feature uses the user's own OpenRouter API key (https://openrouter.ai), which we can't share. Without a key:
1. Press O in the popup. The organize page opens and asks for an OpenRouter key inline; any made-up key is checked with OpenRouter and refused ("OpenRouter rejected this key"), and nothing else is sent.
2. Screenshot 5 of the listing shows what a run looks like with a key: the page proposes named, coloured groups for the current window's tabs, and nothing changes until Apply groups.
If you have an OpenRouter key, paste it there: the run sends that window's tab titles and addresses (without their query and fragment) to OpenRouter, as the line under the Organize button says, and the proposal can be edited, applied or cancelled.

Privacy: no host permissions, no remote code, no analytics. Policy: https://joaof.eu/privacy/huddle/
Source: https://github.com/joaodinissf/jdf-suite/tree/main/packages/jdf-tab-huddle
```

## What the notes rely on

Checked against this branch's `src/`:
- The popup keys: S Sort, D Deduplicate, X Split domains, M Merge windows, T Tab (snooze), digits 1–9 Wake, N Nap room, O Organize with AI, K Open links as tabs (`src/popup.js`, the hotkey map).
- A custom snooze time must be at least a minute ahead (`clampWakeAt` in `src/background.js`).
- Open links as tabs: more than 10 links asks, at most 25 open (`src/content-clumper.js`), and the refusals on restricted pages (`armClumper`, `showOpenLinksRefusal`).
- With no key, the organize page shows the key form, and a key OpenRouter refuses reads "OpenRouter rejected this key" (`src/ai-config.js`).
