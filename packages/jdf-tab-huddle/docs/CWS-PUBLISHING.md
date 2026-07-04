# Chrome Web Store Publishing Checklist — Huddle (`jdf-tab-huddle`)

Expands [jdf-suite#7](https://github.com/joaodinissf/jdf-suite/issues/7). Target: publish v1.0.0.

---

## 1. One-Time Account Setup

- [ ] Create/confirm a Google account to be used as the publisher identity (consider whether this should be a personal account or a dedicated "jdf-suite" Google account — decide before registering, it's hard to change later)
- [ ] Register as a Chrome Web Store developer at the [Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
- [ ] Pay the one-time **$5 USD registration fee**
- [ ] Enable **2-Step Verification (2FA)** on the Google account — CWS requires this for publishing accounts
- [ ] Verify publisher email address (check for a confirmation email from Google)
- [ ] (Optional) Set up a Google Group or shared contact as the support/contact email so account access isn't tied to one person's inbox

---

## 2. Listing Assets

- [ ] **Icon**: 128×128 PNG — already exists at `packages/jdf-tab-huddle/src/icons/icon128.png`, reuse as the store icon
- [ ] **Screenshots**: 1–5 images, either **1280×800** or **640×400** (pick one size, don't mix), PNG or JPEG, no alpha channel
  - [ ] Screenshot 1: Popup showing Tab Groups Mode with an organized set of tabs
  - [ ] Screenshot 2: "Extract All Domains" or "Sort All Tabs" in action (before/after or with tab groups visible)
  - [ ] Screenshot 3: AI "Organize" feature — proposal/confirmation UI (do NOT include a real API key in the screenshot; use a placeholder/blank field)
  - [ ] Screenshot 4: Link-clumping drag-select in action on a page with links
  - [ ] Screenshot 5 (optional): Options/settings page (link-clump key config, snooze settings)
- [ ] **Small promo tile** (440×280) — optional but recommended, improves category-page visibility
- [ ] **Marquee promo tile** (1400×560) — only needed if seeking featured placement; skip for v1.0.0
- [ ] **Short description** (≤132 characters) — draft:
  > Organize, sort, and de-duplicate your Chrome tabs by domain or group — with optional AI-powered organization.
- [ ] **Detailed description** — draft (expand/trim to taste, reuse README feature list):
  ```
  Huddle is a fast, no-nonsense tab manager for Chrome.

  • Sort tabs by URL/domain across all windows or just the current one
  • Extract a domain (or all domains) into their own windows
  • Consolidate all tabs into a single window
  • Remove duplicate tabs — within a window, per-window, or globally
  • Full Chrome Tab Groups support: preserves group membership, color, and title during every operation
  • Respects pinned tabs — they are never moved or removed
  • Link Clumping: hold a hotkey and drag-select a rectangle of links to open them all in new background tabs at once
  • Optional AI "Organize": sends only tab titles and URLs (never page content) to an LLM via OpenRouter, using your own API key, to propose logical tab groups — entirely opt-in, nothing is sent unless you invoke it
  • Snooze tabs for later with reminders (alarms + notifications)

  Huddle does not track you, does not collect analytics, and does not transmit your browsing data anywhere except the single, explicit, user-initiated AI Organize request described above and in our Privacy Policy.
  ```
- [ ] **Category**: Productivity
- [ ] **Language**: English (add others only if UI is actually localized — it isn't, so just English for v1.0.0)
- [ ] **Homepage / support URL**: link to the GitHub repo (`https://github.com/joaodinissf/jdf-suite`) or a dedicated `packages/jdf-tab-huddle` subpage

---

## 3. Privacy

### 3.1 Privacy Policy (host this, then link it from the CWS listing)

- [ ] Decide where to host it — **gap: not yet decided**. Options: GitHub Pages for the repo, a raw `PRIVACY.md` served via `raw.githubusercontent.com` (works but ugly), or a simple page under an existing personal domain. CWS requires a **live, publicly reachable URL**, not just a markdown file in the repo.
- [ ] Publish the following text at that URL (ready-to-host draft — adjust the "Contact" line and hosting URL before publishing):

```markdown
# Privacy Policy — Huddle (Chrome Extension)

Last updated: [DATE]

Huddle ("the extension") is a tab-management tool for Google Chrome. This
policy explains what data Huddle accesses, stores, and transmits.

## Data Huddle Collects

Huddle reads the **titles and URLs of your open browser tabs** in order to
provide its core sorting, grouping, and duplicate-removal features. This
data is processed **locally, in your browser**, and is never transmitted
anywhere as part of normal use (sorting, extracting domains, removing
duplicates, link-clumping, snoozing).

## Data Sent to Third Parties (AI Organize feature only)

Huddle includes an optional "Organize" feature that uses an AI language
model to suggest tab groupings. This feature is **off by default and only
runs when you explicitly click "Organize"**.

When you invoke this feature:

- The **titles and URLs of your currently open tabs** are sent to
  [OpenRouter](https://openrouter.ai) (a third-party LLM routing service)
  using an API key you provide, in order to generate grouping suggestions.
- **No other data** — no page content, no browsing history, no personal
  information — is sent to OpenRouter or any other third party.
- This transmission happens **only** when you manually trigger the
  Organize feature. It does not run automatically, on a schedule, or in
  the background.
- Data sent to OpenRouter is subject to OpenRouter's own privacy policy
  and terms; Huddle does not control how OpenRouter or its upstream model
  providers process that data.

## Local Storage

Huddle stores the following in Chrome's local extension storage
(`chrome.storage.local`), which stays on your device and syncs only via
your own Chrome sign-in (for `sync`-scoped preferences) — it is never
sent to us or to any Huddle-operated server, because Huddle has no
server:

- Your OpenRouter **API key**, obfuscated (not encrypted) before storage.
  Treat this key as you would any credential: if you use a shared or
  managed computer, be aware the key is retrievable by anyone with local
  access to your Chrome profile.
- **Snoozed-tab records**, including the URL and title of each snoozed
  tab, so the extension can reopen it and notify you later.
- Your UI preferences (Tab Groups vs. Individual mode, link-clump hotkey
  configuration).

## What Huddle Does NOT Do

- Huddle has no backend server of its own and does not operate any
  analytics, tracking, or telemetry.
- Huddle does not sell, rent, or share your data with advertisers.
- Huddle does not transmit tab data anywhere except the single,
  user-initiated OpenRouter request described above.

## Changes to This Policy

If this policy changes, the "Last updated" date above will change and
the new version will be posted at this same URL.

## Contact

Questions about this policy: [CONTACT EMAIL / GITHUB ISSUES LINK]
```

- [ ] Fill in `[DATE]` and `[CONTACT EMAIL / GITHUB ISSUES LINK]` before publishing
- [ ] Paste the live URL into the CWS listing's **Privacy Policy** field

### 3.2 Single Purpose Description (CWS "Privacy" tab, required field)

- [ ] Draft:
  > Huddle's single purpose is to help users organize, sort, and de-duplicate their open browser tabs (including optional AI-assisted grouping and link-collection via click-drag), so all requested permissions exist solely to read, move, group, and restore tabs and windows on the user's behalf.

### 3.3 Data Usage Disclosure Checkboxes (CWS Privacy tab)

Chrome Web Store now requires explicitly checking which data types the extension **collects/transmits**. Based on the actual behavior:

- [ ] **Personally identifiable information** — leave unchecked (no names/emails/addresses collected)
- [ ] **Health information** — unchecked
- [ ] **Financial and payment information** — unchecked
- [ ] **Authentication information** — check if OpenRouter API key storage falls under this category in the current CWS form (it's a credential, even though stored locally) — **verify current wording in the dashboard at submission time, categories/labels change**
- [ ] **Personal communications** — unchecked
- [ ] **Location** — unchecked
- [ ] **Web history** — **check this.** Tab URLs are read and (only for AI Organize) transmitted; CWS treats "web history" broadly enough to include open-tab URLs
- [ ] **User activity** — likely unchecked (no clickstream/analytics), but review CWS's exact definition before submitting
- [ ] **Website content** — unchecked (Huddle reads tab titles/URLs, not page content, despite having a content script — the content script only listens for the link-clump drag gesture and does not read/transmit page content)
- [ ] For each checked category, fill in the required justification text, reusing language from the privacy policy draft above (data limited to tab titles/URLs; transmitted to OpenRouter only on explicit user action; otherwise processed locally only)
- [ ] Certify: "I do not sell or transfer user data to third parties outside of the approved use cases" — true here since OpenRouter transmission is a user-directed, disclosed exception; read CWS's exact certification wording before checking

### 3.4 Per-Permission Justification Table (CWS review form, "Permission justification" fields)

| Permission | One-line justification for CWS reviewers |
|---|---|
| `tabs` | Required to read tab titles/URLs and move/create/close tabs, which is the extension's core sort, extract, dedupe, and snooze functionality. |
| `windows` | Required to create, query, and consolidate browser windows when extracting domains or moving all tabs into a single window. |
| `tabGroups` | Required to detect, preserve, and recreate Chrome Tab Groups (membership, color, title) so sort/extract/dedupe operations don't destroy the user's existing group organization. |
| `storage` | Required to persist user preferences (Tab Groups vs. Individual mode, link-clump hotkey config), the user's own OpenRouter API key, and snoozed-tab records, all locally in `chrome.storage.local`. |
| `alarms` | Required to schedule the wake-up time for snoozed tabs so they reopen at the time the user chose, without keeping the service worker alive continuously. |
| `notifications` | Required to show a system notification when a snoozed tab is restored, since the user is not necessarily looking at Chrome at that moment. |
| `host_permissions: https://openrouter.ai/*` | Required to call the OpenRouter API directly from the extension when the user explicitly invokes the optional "Organize" (AI grouping) feature; only tab titles and URLs are sent, only on explicit user action, and never to any other host. |

- [ ] Paste each justification into the corresponding field in the CWS "Permissions" section of the submission form
- [ ] Double check the reviewer-facing justification for `host_permissions` explicitly states the AI feature is **opt-in** and **user-triggered** — this is the single most likely rejection point (broad-looking host permission + third-party data transmission) and reviewers weight explicitness heavily here

---

## 4. Build & Submit

- [ ] Bump `packages/jdf-tab-huddle/src/manifest.json` `version` field from `0.1.0` to `1.0.0`
- [ ] Update the README's "Version History" section with a `v1.0.0` entry noting first public CWS release
- [ ] Run `pnpm run validate` to confirm manifest correctness
- [ ] Run the full test suite: `pnpm test` and `pnpm test:e2e`
- [ ] Run `pnpm run package` to produce the release zip
- [ ] Manually smoke-test the packaged zip via `chrome://extensions/` → Load unpacked (or unzip + load) before uploading, to catch build artifacts CI wouldn't
- [ ] In CWS Developer Dashboard: create new item, upload the zip from `pnpm run package`
- [ ] Fill in all listing fields from Section 2 (assets, descriptions, category, language)
- [ ] Fill in all Privacy tab fields from Section 3 (policy URL, single purpose, data usage checkboxes)
- [ ] Fill in all per-permission justifications from Section 3.4
- [ ] Add **reviewer test instructions** in the submission notes, e.g.: "To test AI Organize, go to Options → paste any valid OpenRouter API key → open popup → click Organize. All other features work without any key or network access."
- [ ] Choose visibility: **Public** (or "Unlisted" first if you want a soft-launch/dry run before public listing — consider this given it's a first-ever CWS submission)
- [ ] Submit for review
- [ ] Note: first review of a **new** listing commonly takes **a few hours to ~a few business days**, but can extend to **1–2+ weeks** for extensions requesting broad permissions or host permissions (this one has both `tabs`/`windows`/`tabGroups` and a remote host permission with data transmission, so budget for the longer end — plan the v1.0.0 tag/release announcement accordingly, don't promise a same-day launch)

---

## 5. Post-Submit

- [ ] Monitor the Developer Dashboard and registered email for review status/messages
- [ ] **If rejected**: read the rejection reason carefully (usually cites a specific policy — most likely candidates for this extension: permission justification, privacy policy completeness/reachability, or the "single purpose" clarity given the AI feature's optional host permission); fix the specific issue, do **not** just resubmit the same package; re-upload and resubmit
- [ ] **If approved**: consider a **staged rollout** (CWS supports rolling out to a percentage of users first, e.g. 10% → 50% → 100%) rather than 100% immediately, especially since this is the first-ever public release of this codebase
- [ ] Once live, verify the store listing renders correctly (screenshots, description formatting, privacy policy link resolves)
- [ ] Create and push the git tag: `jdf-tab-huddle-v1.0.0` (matches the reserved tag pattern `jdf-tab-huddle-v*`)
- [ ] Create a GitHub Release off that tag with release notes (reuse the detailed description / version history entry)
- [ ] Update `packages/jdf-tab-huddle/README.md` "Release (CWS upload)" line to mark it done, and link the live CWS listing URL
- [ ] Close jdf-suite#7, referencing the CWS listing URL and the tag
- [ ] Add a reminder/follow-up task: monitor CWS reviewer messages and user reviews for the first ~2 weeks post-launch (new listings get extra scrutiny and occasional post-publish policy re-review)

---

## Open Gaps for the Team to Fill

1. **Where to host the privacy policy** — not decided (GitHub Pages vs. raw file vs. personal domain). Needs a public HTTPS URL before submission.
2. **Publisher Google account identity** — personal vs. dedicated jdf-suite account; affects 2FA setup and long-term maintenance access.
3. **Screenshots** — none exist yet; need to be captured from a real running build.
4. **Support/contact email** — placeholder in the privacy policy draft (`[CONTACT EMAIL / GITHUB ISSUES LINK]`) needs a real value.
5. **CWS "Authentication information" / "User activity" checkbox wording** — verify exact current category definitions in the live dashboard at submission time, since CWS has changed these labels before.
