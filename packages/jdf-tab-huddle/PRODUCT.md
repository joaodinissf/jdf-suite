# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Heavy-tab power users: people who keep dozens to hundreds of tabs across several windows and tidy them in quick keyboard bursts between tasks. They open the popup with Option+Shift+U (Alt+Shift+U elsewhere) and run an action with a single letter. The maintainer is the first user; Chrome Web Store users become an audience from v1.0.0 ([#7](https://github.com/joaodinissf/jdf-suite/issues/7)).

## Product Purpose

**Huddle organizes your browser tabs.** It gathers scattered tabs back into order on the real tab strip. Every feature is a part of tab organization, which is what makes Huddle a single-purpose extension. From the toolbar popup it can:
- sort a window, or every window, by URL;
- remove duplicates within a window, within each window, or across all windows;
- ungroup a window;
- move one domain's tabs into a new window, or split every domain into its own window;
- merge all windows into one;
- copy the tab URLs of this window or of all windows;
- suggest tab groups with AI, for review before anything moves;
- snooze tabs, windows or groups until a chosen time, with the nap room as the full list of sleeping tabs;
- open a set of links on a page as tabs (Open links as tabs: hold a key and drag over them);
- compact neighbouring tabs into Split Views, and expand them again (Chrome 155+).

## Positioning

- **Instant and local.** One keystroke operates on the real tab strip. There's no account, no sync and no cloud service in the way.
- **It respects your structure.** Tab groups, pinned tabs and Split Views are preserved or restored rather than trampled, and Groups vs Flat is a first-class choice for every action.
- **Snooze and the nap room** are core features: tabs are put to sleep and wake on schedule.
- **AI is optional and uses your own key.** Organize with AI runs through the user's own OpenRouter key and model choice, with a review step before anything changes.

## Operating Context

- A Chrome extension (Manifest V3). The popup opens from the toolbar button or the Option+Shift+U / Alt+Shift+U command. The other surfaces are Settings, the organize page (the AI proposal review), the nap room and the Split domains confirmation, each opened as a tab.
- Actions run in the background service worker. The popup sends a message and the work happens on the user's live tab strip, often across several windows.
- Open links as tabs (`content-clumper.js` in the code) runs only in a page the user starts it on, with its shortcut (⌥⇧L / Alt+Shift+L) or the popup's Open links as tabs. That gesture gives Huddle the one tab through `activeTab`, so Huddle asks for no access to websites in general, and it stays on until the page reloads. This reverses audit L9 and decision D1 (2026-09-29), which had accepted access to every website so the feature worked out of the box; decided 2026-10-10 for the Chrome Web Store. There is no always-on option, and no setting to turn it off: starting it on a page is the opt-in.
- Split View support is feature-detected: it reads `splitViewId` on Chrome 140+, and creates and removes splits on Chrome 155+.

## Capabilities and Constraints

**Binding constraints on all design work:**
- **Keyboard-first.** Every popup action has a visible single-key shortcut, and the popup is fully usable without a mouse.
- **WCAG AA.** Contrast, focus and screen-reader support must meet WCAG AA.
- **Fits Chrome's popup.** 380 px wide, with no scrolling in normal use: under Chrome's 600 px popup height cap.

**Undecided:** whether "nothing leaves the machine" is a binding privacy commitment. Today the only network use is the AI feature calling OpenRouter with the user's own key, and OpenRouter's public model list, which Settings loads when it opens with a key on file, or when you browse or save models. None of it needs access to a website: OpenRouter's API accepts requests from any origin, so Huddle asks for no host permission, OpenRouter's included.

## Brand Commitments

- The user-facing name is **Huddle**; the package slug is `jdf-tab-huddle`. The old name "Tab Organizer" is retired.
- The chosen direction for the redesign ([#16](https://github.com/joaodinissf/jdf-suite/issues/16)) is to grow the identity from the product's own metaphors: **huddle** (gathering scattered things together) and **nap** (snooze, sleeping tabs, the nap room). The snooze and nap-room copy is the established voice: human, specific, and honest about counts.

## Evidence on Hand

- Feature documentation: `README.md` and the specs in `specs/` (tab snoozing, extract to tab groups, reconciler-based updates, Split View Compact).
- 1058 unit tests and 139 Playwright e2e tests that describe behaviour ([docs/TESTS.MD](docs/TESTS.MD)).
- The design review of 2026-09-27 (Impeccable audit and critique) is the baseline for the redesign.
- There are no users outside the maintainer yet, and no testimonials, usage data or store listing. Future work must not invent any.

## Product Principles

1. **One keystroke, visibly.** An action is only as good as its shortcut and the feedback that it worked.
2. **Never trample structure.** Groups, pinned tabs and Split Views survive what Huddle does to them, or are restored afterwards.
3. **The popup is the product.** It must fit, scan and operate within Chrome's popup limits. Secondary pages support it and don't compete with it.
4. **AI is a guest.** Useful and optional; the core actions work instantly without it.

## Accessibility & Inclusion

WCAG AA is a hard requirement (see Capabilities and Constraints). Keyboard and screen-reader use are first-class, because the product's primary interaction is the keyboard.
