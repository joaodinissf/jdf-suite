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
- They were chosen for legibility at the popup's small sizes (10–12px), which is where Huddle lives, not for a subject association.
- **Scale:**
  - popup body text 11–12px;
  - section chips 10.5px/700;
  - brand 15px/700;
  - keys and counts 8.5–10px mono.

## Layout and components (popup)

- **Width** is fixed at 380px, and the popup must stay under Chrome's **600px** cap in its heaviest normal state (the Split View row, several sleeping items, AI configured). Measured: 598px on Chrome 155.
- **Buttons** are neutral surfaces (`--comp`) with a `--bd-control` edge. The Groups/Flat toggle's active side is a solid blue fill. "Organize with AI" is a soft blue action, deliberately not a solid hero: AI is a guest.
- **Hotkey badges** use `--kbd-bg`/`--kbd-tx` and show the bare key (`D`, or a row digit).
- **Feedback** (the result line, Undo, "Copied!") floats as toasts over the bottom edge, so it never adds height.
- **The snooze picker is modal:** the rest of the popup steps aside while it's open.
- **Icons** are drawn SVG at a 1.5px stroke in `currentColor`: settings sliders, a key for AI settings, "open" arrow, and a close mark for discarding a sleeping item (a dismissal in the nap voice, not a trash can). No emoji or Unicode glyphs stand in for icons. `⇧` and `⌘` appear only as key notation.

## Motion

Minimal and functional: 120ms colour transitions on hover. `prefers-reduced-motion` removes them.
