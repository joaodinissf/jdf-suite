# Design

Huddle's visual system, as built. Product facts live in [PRODUCT.md](PRODUCT.md); this file records the visual decisions that later work should extend rather than reinvent. The tokens themselves are in [`src/huddle-theme.css`](src/huddle-theme.css), which every extension page links.

## The world

Huddle gathers tabs, so its interface borrows the one visual language every Chrome user already reads: **the tab strip's groups**. Chrome shows a tab group as a coloured label chip, with a line in the same colour under the group's tabs. Huddle's sections are drawn the same way:
- a `.group-chip` heading in one of Chrome's nine group colours;
- a `.group-line` in that colour running to the edge.

Sleeping tabs keep their own voice, **nap**: Chrome's yellow group (amber), the moon, and the nap room.

The mark is three tabs huddled into one group, on Chrome blue, over a group line in nap amber ([`src/icons/huddle-mark.svg`](src/icons/huddle-mark.svg)). The toolbar PNGs are rasterised from it. `src/icons/icon.afphoto` is the retired folder icon's source and no longer matches anything. The `package` script's exclusion of it lands with the release-workflow PR (#58); until then it still ships in a locally built zip. At 16px the tabs stay distinct, because they're 6 units wide with 2-unit gaps.

## Colour

- **Strategy:** restrained. Neutral grounds carry the work; colour appears only where it means something: a section's group, the action colour, the nap voice, danger.
- **Light and dark** follow the system (`prefers-color-scheme`), as Chrome's own UI does. Light is the default in the file; dark overrides the same token names.
- **Group colours** are Chrome's own, in both its light and dark renditions: grey, blue, red, yellow, green, pink, purple, cyan, orange. Each has an `-ink` token picked for contrast: white on light-mode fills except yellow and orange; dark ink on every dark-mode fill.
- **Section assignment in the popup:**

  | Section | Group colour |
  |---|---|
  | This window | blue |
  | Extract & copy | green |
  | Snooze, Sleeping | yellow (nap) |
  | All windows | purple |

- **Action colour** is the blue group. Fills use Chrome's own blue. *Text* in blue uses `--ac-txt`: a darker blue in light mode, because the fill blue is only 4.2:1 on the light ground.
- **Destructive** actions use `--danger`, which only turns red when you reach for the control (hover or focus). At rest, Discard is a quiet icon.
- **Warnings** (for example "Many windows will be created", "You are responsible for your API key") use Chrome's orange group: a 1px `--warn-edge` and a `--warn-soft` tint. Errors use `--danger` with `--danger-soft`. Callouts never use a coloured side bar.
- **Neutral sections** on the other pages (a summary, a settings group) take grey or cyan chips, so blue keeps meaning "action".

## Contrast rules

- **Every text pair** meets WCAG AA (4.5:1) in both themes. This was measured, not estimated: each visible text node was composited through its backgrounds in Chrome and its contrast computed, for every page in light and dark.
- **Every control edge** meets 3:1 (WCAG 1.4.11), via `--bd-control`. `--bd` is for dividers and panels only, which are decoration.
- **Disabled controls** are exempt and may fall below.

## Type

- **Atkinson Hyperlegible Next** for all UI text, and **Atkinson Hyperlegible Mono** for keys, counts and times. Both are bundled in `src/fonts/` (OFL) rather than loaded from Google, so the popup doesn't wait on the network or fail offline.
- They were chosen for legibility at the popup's small sizes (10.5–12px), which is where Huddle lives, not for a subject association.
- **Scale:**
  - popup body text 11–12px;
  - a **compact 10.5px** step for the popup's small control labels (the Groups/Flat toggle, the mini and snooze buttons, Wake, Undo, Nap room, Open links as tabs, Settings) and for its mono counts and times (group counts, sleeping times, the footer's tab count and shortcuts);
  - section chips 10.5px/700;
  - brand 15px/700;
  - hotkey badges 8.5px mono, the only text below 10.5px.
- The brand has no subtitle: the Groups/Flat toggle beside it already shows the mode.

## Layout and components (popup)

- **Width** is fixed at 380px, and the popup must stay under Chrome's **600px** cap in its heaviest normal state (the Split View row, several sleeping items). Measured: 593px with the Split View row and three sleeping items (Chrome for Testing 151).
- **Buttons** are neutral surfaces (`--comp`) with a `--bd-control` edge. The Groups/Flat toggle's active side is a solid blue fill. "Organize with AI" is a button like any other. Under WCAG 1.4.12 text spacing, a label that no longer fits wraps onto a second line rather than pushing its hotkey badge out of the button.
- **Hotkey badges** use `--kbd-bg`/`--kbd-tx` and show the bare key (`D`, or a row digit).
- **Feedback** (the result line, Undo, "Copied!") floats as toasts over the bottom edge. The popup's Undo takes focus and has no time limit; the next press of another button dismisses it. The nap room's Undo notice behaves the same way, and has a close mark as well. While one shows, the page reserves its height at the bottom, so a toast never covers the footer or the picker's last row, and the same height is the page's scroll padding, so Tab to a control behind a toast (Settings, in the tallest states) scrolls it clear. Errors keep an opaque surface and wrap instead of truncating.
- **The footer** is two rows, each laid out on its own: this window's count with **Open links as tabs** (hotkey K) and Settings, both quiet `.gear` text buttons with a drawn icon; then the all-windows count with the shortcuts as Chrome has bound them ("⌥⇧L for links · ⌥⇧U to open", or "Set a shortcut at chrome://extensions/shortcuts" when the open-links command is unbound). The shortcut line is one row tall: when a long all-windows count leaves room for one shortcut only, the other wraps out of sight, so the footer never grows past the popup's cap. Over a page Chrome keeps from extensions, Open links as tabs is `aria-disabled` (dimmed to 0.6, still focusable, the reason as its description and tooltip) and pressing it shows the reason as a toast. Otherwise it closes the popup, so the page's hint can be seen.
- **The snooze picker is modal:** the rest of the popup steps aside while it's open, the header is `inert`, and opening it by hotkey puts focus on its unit chip.
- **A running action** marks its button `aria-busy`, which dims it to 0.7 with a progress cursor until the reply.
- **Icons** are drawn SVG at a 1.5px stroke in `currentColor`: settings sliders, "open" arrow, and a close mark for discarding a sleeping item and for dismissing the nap room's Undo notice (a dismissal in the nap voice, not a trash can). No emoji or Unicode glyphs stand in for icons. `⇧` and `⌘` appear only as key notation.

## Open links as tabs: the page hint

Starting Open links as tabs shows a hint in the page itself: "Huddle: hold `Z` and drag over links to open them as tabs. On until this page reloads.", or "Huddle is already on: …" when it was already on.
- **Drawn like the popup's toasts:** fixed at the bottom centre, 24px up, a `--comp-hi` surface with a `--bd-hi` edge, 10px radius and `--shadow-float`, 13px text (a web page's scale, not the popup's), the key as a mono `--kbd-bg` badge. Light and dark follow the system. The token values are copied into the hint, since a web page can't load Huddle's stylesheet or fonts (no web_accessible_resources), so it uses the system UI and mono fonts.
- **Out of the page's reach:** it lives in a shadow root, and its host's position is set inline with `!important`, so the page's CSS can't restyle or move it.
- **Never in the way:** `pointer-events: none`, it never takes focus, and it is a polite `role="status"` (filled after it is inserted, so it is announced). It goes after 3 s, and Escape puts it away sooner without taking the key from the page. It fades and rises in 160ms only without `prefers-reduced-motion`.
- The drag's own selection box and link highlights keep their orange: they mark what the drag will open, over any page's colours.
- **Where it can't start,** the shortcut has no popup to answer in: Huddle's toolbar button shows a "!" badge in the warning orange (`--warn-edge`) for 5 s, with the reason as its tooltip.

## AI configuration

- **Not in the popup.** "Organize with AI" is a plain action there: no settings cog, no model line.
- **Settings** holds the lasting setup in a grey "Organize with AI" section: key status, replacing or deleting the key, its expiry, and the default model with the "Don't use providers that train on my prompts" checkbox (on by default) saved alongside it. While a new key is checked (up to 15 s), the status line says "Checking the key with OpenRouter…" and Save is `aria-disabled`, so focus stays on it. Enter in the model picker saves the default model. An error describes its field (`aria-invalid`, `aria-describedby`). The delete question keeps Delete and Keep together on one row, and Keep is described by the question.
- **The organize page** holds the choice for one run: a plain toolbar under the title (a dim "Model" label, the model's name truncated with its id as a tooltip, a small neutral "Default" badge in the UI font, and Make default and Change as links on the right). It has no group chip or group line, so it never reads as one of the proposed groups. Change opens the filterable picker below it; Enter keeps the choice and moves focus to the button that runs it, and Escape restores the one it opened with. The page's buttons sit right under the bar (Apply groups, Run again and Cancel with a proposal on screen, or the form's buttons), so the bar's dim note ("This proposal came from … Run again to use …") is next to the button it names. Once a model other than the proposal's is picked, or the popup's O brings the other mode (the note then reads "Made in Flat mode · Run again to use Groups"), Run again becomes the primary button and takes Cmd/Ctrl+Enter; Apply stays a plain button and keeps the proposal's own mode. Cmd/Ctrl+Enter in the instructions for Run again always runs again. The bar keeps its room but shows no name until the config loads, and it is gone while an older background is running (Reload Huddle) and after Apply. With no key, an expired one or one OpenRouter rejected, the same page shows the key form inline (a cyan "OpenRouter key" chip) and starts the run once the key is saved. Whenever the form is on screen, a dim 12.5px line under its buttons says what a run sends: "Organize sends this window's tab titles and addresses to OpenRouter, which passes them to a provider it picks for <model>." It names no provider, because OpenRouter chooses one.
- **Every state but a running run keeps the form**: after an error, a stop or a reload the notice sits above the instructions (kept across a reload) and the one button that fits the error (Retry, Change model, Add credits, Organize all tabs (Flat), Reload Huddle). When a retry of the same model can't work (a batch model, a model with no endpoint, an unknown model id, a prompt too long for it, a request the model or its provider refuses, too few credits), the fix is the primary button, not Retry; after Add credits it turns into Retry. While a run goes there is a spinner (still under reduced motion) and Stop; focus rests on the progress, one Tab before Stop, so a second Enter on the button that started the run never stops it. Cmd/Ctrl+Enter does the primary action, and Escape stops a run or closes the page. In a text field (the instructions, a group name, the key) Escape puts back the value the field had when it took focus and leaves the field; the next Escape closes the page. The keys are shown as `--kbd-bg` badges.
- **The picker's rows** read "name · provider · $in · $out per M" in one style; the filter applies to every row, and an empty result says so. Until the catalog has loaded, the chosen id gets no warning.
- The key form and the model picker are one shared component (`src/ai-config.js`, `src/ai-config.css`), so both pages look and check the same way.

## Motion

Minimal and functional: 120ms colour transitions on hover, and the page hint's 160ms fade. `prefers-reduced-motion` removes them.
