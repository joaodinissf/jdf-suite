# Chrome Web Store: Huddle v1.0.0

Everything the Chrome Web Store Developer Dashboard asks for, ready to review and paste in. Nothing here is uploaded automatically: publishing stays a manual step ([#7](https://github.com/joaodinissf/jdf-suite/issues/7)), Unlisted first.

| File | Dashboard tab |
|---|---|
| [listing.md](listing.md) | **Store listing**: title, summary, description, category, language, images, URLs |
| [privacy-practices.md](privacy-practices.md) | **Privacy**: single purpose, permission justifications, remote code, data usage, certifications, policy URL |
| [reviewer-notes.md](reviewer-notes.md) | **Test instructions**: how a reviewer can try every feature without a key |
| [screenshots/](screenshots/) | The five 1280 × 800 screenshots and the 440 × 280 small promo tile, and the script that makes them |

`tests/store-listing.test.js` keeps these files in step with the manifest: the summary is the manifest's description, every permission has a justification (and none that isn't in the manifest), the policy URL is the same everywhere, and the images are the sizes the store asks for, with no alpha channel.

## What you do by hand in the dashboard

1. **Change the manifest's name** to `Huddle — tab organizer` in the v1.0.0 version-bump PR, since the store takes its title from the manifest (see [listing.md](listing.md#title-huddle--tab-organizer) for what else changes with it). Then build the zip with `pnpm run package` or take it from the GitHub Release.
2. **Developer account**: register (one-time fee), verify the contact email, and fill in the publisher name and, if the dashboard asks, the trader declaration.
3. **New item**: upload the v1.0.0 zip.
4. **Store listing**: paste the description, pick the category and language, upload the store icon, the five screenshots in order and the small promo tile, and fill in the homepage and support URLs ([listing.md](listing.md)).
   - **Video**: the listing page says a YouTube video is required, but the images page lists only the icon, a small promo tile and one screenshot as mandatory. Leave it empty; record a short video only if the dashboard refuses to submit without one.
   - **Official URL**: only if you verify `joaof.eu` in Google Search Console first.
5. **Privacy**: paste the single purpose and each permission's justification, answer No to remote code, tick the data categories and the three certifications, and enter the policy URL ([privacy-practices.md](privacy-practices.md)). **Decide Website content and User activity first** (the note in that file).
6. **Test instructions**: paste [reviewer-notes.md](reviewer-notes.md)'s block.
7. **Distribution**: free, all regions, visibility **Unlisted** for the first release.
8. **Submit for review**, then, once it's published, install from the store and run the manual checklist in the release PR on the store copy (its extension ID differs from an unpacked one, see the README's "Moving from an unpacked copy").
9. **After publishing**: add the store link to the README's Install section and the privacy policy.

## The store's requirements, as checked on 10 October 2026

| Field | Requirement | Source |
|---|---|---|
| Title | The manifest's `name`, at most 75 characters; shown in the store, the install dialog and `chrome://extensions`. The listing tab holds only what "isn't included in the metadata of the manifest". | [Manifest: name](https://developer.chrome.com/docs/extensions/reference/manifest/name), [Store listing tab](https://developer.chrome.com/docs/webstore/cws-dashboard-listing) |
| Summary | The manifest's `description`, plain text, at most 132 characters | [Manifest: description](https://developer.chrome.com/docs/extensions/reference/manifest/description), [Best listing](https://developer.chrome.com/docs/webstore/best-listing) |
| Description | Free text; start with what the item does, then features; no keyword spam. No limit is documented. | [Store listing tab](https://developer.chrome.com/docs/webstore/cws-dashboard-listing), [Best listing](https://developer.chrome.com/docs/webstore/best-listing) |
| Category, language | A primary category; the item's language | [Store listing tab](https://developer.chrome.com/docs/webstore/cws-dashboard-listing) |
| Store icon | 128 × 128 PNG (96 × 96 artwork with transparent padding is recommended; an image without alpha gets rounded corners) | [Supplying images](https://developer.chrome.com/docs/webstore/images) |
| Screenshots | At least 1, up to 5; 1280 × 800 (preferred) or 640 × 400; square corners, no padding (full bleed); they show at 640 × 400 | [Supplying images](https://developer.chrome.com/docs/webstore/images), [Best listing](https://developer.chrome.com/docs/webstore/best-listing) |
| Small promo tile | 440 × 280, PNG or JPEG, required; avoid much text, must work at half size | [Store listing tab](https://developer.chrome.com/docs/webstore/cws-dashboard-listing), [Supplying images](https://developer.chrome.com/docs/webstore/images) |
| Marquee promo tile | 1400 × 560, optional; needed only to be featured in the marquee | [Supplying images](https://developer.chrome.com/docs/webstore/images) |
| Homepage, support, official URL | Optional; the official URL must be a site verified in Search Console | [Store listing tab](https://developer.chrome.com/docs/webstore/cws-dashboard-listing) |
| Single purpose | "A single purpose that is narrow and easy to understand" | [Privacy tab](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [Quality guidelines](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines) |
| Permission justifications | One per permission in the manifest; broader permissions than needed may be rejected | [Privacy tab](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) |
| Remote code | Declare it or answer "No, I am not using remote code"; MV3 can't run remotely hosted code | [Privacy tab](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) |
| Data usage | Disclose each type of user data handled, even if it is only processed or stored on the device, and certify compliance with the Limited Use policy | [Privacy tab](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) |
| Privacy policy | A URL; required even when data is only stored locally or in Chrome sync. The site must state that the use of data complies with Limited Use (the joaof.eu policy does). | [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) |
| Test instructions | Optional | [Test instructions tab](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions) |

What the documentation doesn't say, so check it in the dashboard:
- **The category names.** The docs list none. The store's current menu splits Productivity into sub-categories; [listing.md](listing.md#category) suggests Workflow & Planning.
- **The data categories and the certifications' wording.** The Privacy tab's documentation shows them only in a screenshot. [privacy-practices.md](privacy-practices.md) uses the dashboard's nine categories (personally identifiable, health, financial and payment, authentication, personal communications, location, web history, user activity, website content) and its three certifications (no sale, no unrelated use, no creditworthiness).
- **Screenshot format and alpha.** The images page names no format for screenshots, and says nothing about alpha. These are 24-bit PNGs with no alpha channel, the safe choice either way.
- **Character limits** for the description, single purpose and justifications. The texts here are short; the dashboard shows a counter.

## The screenshots

[`screenshots/make-screenshots.mjs`](screenshots/make-screenshots.mjs) makes them from this checkout's `src/`, so run it again whenever the interface changes:

```bash
cd packages/jdf-tab-huddle
PW_EXECUTABLE="$HOME/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
  node store/screenshots/make-screenshots.mjs
```

- It runs Chrome for Testing (branded Chrome ignores `--load-extension`) on a throwaway profile, light theme, in the Europe/Lisbon time zone, so the snooze times it shows are the run's own.
- Every tab is invented, on reserved `example.com` addresses served by Playwright. OpenRouter is the e2e suite's fake (`e2e/helpers/fake-openrouter.js`) with its test key; the script replaces only its chat answer, so the proposal groups tabs by purpose. Every other host resolves to nowhere, so nothing reaches the network.
- The popup is shown at its real size (380 px wide) beside a caption, since a screenshot can't include the toolbar. The organize page is shown at 90 % zoom so its three groups fit.
- It stops with an error when a page doesn't fit its picture or the popup's Sleeping list would scroll, and checks each image's size.

| # | File | Shows |
|---|---|---|
| 1 | `1-popup.png` | The popup over a window with three tab groups, two sleeping items and a second window |
| 2 | `2-snooze.png` | The popup's snooze picker |
| 3 | `3-nap-room.png` | The nap room with four snoozes, one of them a tab group |
| 4 | `4-open-links-as-tabs.png` | Open links as tabs on a reading list: the drag's rectangle and highlighted links, and the page hint |
| 5 | `5-organize-with-ai.png` | Organize with AI's proposal: three named groups, before Apply |
| | `promo-small-440x280.png` | Huddle's mark and name on Chrome blue |

Organize with AI comes last because it is optional: everything else works without it (PRODUCT.md, "AI is a guest").
