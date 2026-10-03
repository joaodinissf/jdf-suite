# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Heavy-tab power users: people who keep dozens to hundreds of tabs across several windows and tidy them in quick keyboard bursts between tasks. They open the popup with Option+Shift+U (Alt+Shift+U elsewhere) and run an action with a single letter. The maintainer is the first user; Chrome Web Store users become an audience from v1.0.0 ([#7](https://github.com/joaodinissf/jdf-suite/issues/7)).

## Product Purpose

Huddle gathers scattered tabs back into order on the real tab strip. From the toolbar popup it can:
- sort a window, or every window, by URL;
- remove duplicates within a window, within each window, or across all windows;
- ungroup a window;
- move one domain's tabs into a new window, or split every domain into its own window;
- merge all windows into one;
- copy the tab URLs of this window or of all windows;
- organize tabs into groups with AI;
- snooze tabs, windows or groups until a chosen time, with the nap room as the full list of sleeping tabs;
- compact neighbouring tabs into Split Views, and expand them again (Chrome 155+).

## Positioning

- **Instant and local.** One keystroke operates on the real tab strip. There's no account, no sync and no cloud service in the way.
- **It respects your structure.** Tab groups, pinned tabs and Split Views are preserved or restored rather than trampled, and Groups vs Flat is a first-class choice for every action.
- **Snooze and the nap room** are core features: tabs are put to sleep and wake on schedule.
- **AI is optional and uses your own key.** Organize with AI runs through the user's own OpenRouter key and model choice, with a review step before anything changes.

## Operating Context

- A Chrome extension (Manifest V3). The popup opens from the toolbar button or the Option+Shift+U / Alt+Shift+U command. The other surfaces are the options page, AI setup, the AI proposal review, the nap room and the Split domains confirmation, each opened as a tab.
- Actions run in the background service worker. The popup sends a message and the work happens on the user's live tab strip, often across several windows.
- Link clumping is a content script on every http and https page, on by default, and never on `file:`, `ftp:` or other pages. Its access to every website is accepted as the price of clumping working out of the box (audit L9, decided 2026-09-29).
- Split View support is feature-detected: it reads `splitViewId` on Chrome 140+, and creates and removes splits on Chrome 155+.

## Capabilities and Constraints

**Binding constraints on all design work:**
- **Keyboard-first.** Every popup action has a visible single-key shortcut, and the popup is fully usable without a mouse.
- **WCAG AA.** Contrast, focus and screen-reader support must meet WCAG AA.
- **Fits Chrome's popup.** 380 px wide, with no scrolling in normal use: under Chrome's 600 px popup height cap.

**Undecided:** whether "nothing leaves the machine" is a binding privacy commitment. Today the only network use is the AI feature calling OpenRouter with the user's own key.

## Brand Commitments

- The user-facing name is **Huddle**; the package slug is `jdf-tab-huddle`. The old name "Tab Organizer" is retired.
- The chosen direction for the redesign ([#16](https://github.com/joaodinissf/jdf-suite/issues/16)) is to grow the identity from the product's own metaphors: **huddle** (gathering scattered things together) and **nap** (snooze, sleeping tabs, the nap room). The snooze and nap-room copy is the established voice: human, specific, and honest about counts.

## Evidence on Hand

- Feature documentation: `README.md` and the specs in `specs/` (tab snoozing, extract to tab groups, reconciler-based updates, Split View Compact).
- 374 unit tests and 91 Playwright e2e tests that describe behaviour.
- The design review of 2026-09-27 (Impeccable audit and critique) is the baseline for the redesign.
- There are no users outside the maintainer yet, and no testimonials, usage data or store listing. Future work must not invent any.

## Product Principles

1. **One keystroke, visibly.** An action is only as good as its shortcut and the feedback that it worked.
2. **Never trample structure.** Groups, pinned tabs and Split Views survive what Huddle does to them, or are restored afterwards.
3. **The popup is the product.** It must fit, scan and operate within Chrome's popup limits. Secondary pages support it and don't compete with it.
4. **AI is a guest.** Useful and optional; the core actions work instantly without it.

## Accessibility & Inclusion

WCAG AA is a hard requirement (see Capabilities and Constraints). Keyboard and screen-reader use are first-class, because the product's primary interaction is the keyboard.
