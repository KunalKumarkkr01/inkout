# Inkout v1.0 — design

Status: draft for approval · 2026-10-28
Mockups: https://claude.ai/artifact/YbXcXSM5KkJWxSDzaxtHZH (private canvas; the owner can share it)

## Intent

Inkout is a free Chrome extension that hides sensitive text on web pages: email addresses, phone numbers, card numbers and similar. When you share your screen on a video call, the people watching never see it. It grows out of the working prototype in this folder, "Screen Share Privacy Guard". v1.0 is the first public release on the Chrome Web Store.

The user's moment: sharing a screen with Gmail or a similar app open, and an email address showing that should not have.

## Goals

- Works automatically on every site from the moment it's installed, with nothing to configure.
- Hides reliably: no flash of unhidden text when a page loads or updates, and selecting hidden text never reveals it.
- Polished enough to publish: a proper popup, settings page, welcome page, icon, store listing and privacy policy.
- Useful worldwide. Nothing is specific to one country.

## Non-goals (v1.0)

- Hiding Chrome's own interface (address bar, autofill dropdowns, bookmarks). An extension can't.
- Text inside images, canvas, PDFs, or closed shadow DOM.
- Firefox, Edge and other browsers; translations.
- Accounts, sync servers, paid tiers.

## Anti-goals (a failure even if it technically works)

- Sending any page content or usage data anywhere. No analytics, no network requests, no remote code. The privacy promise is the product.
- Breaking the sites it runs on, for example by rewriting the page's DOM structure the way wrapping text in spans does.
- Any "peek" feature that shows the real value on screen while sharing, such as hover to reveal.
- Nags, upsells or ratings pop-ups.

## Constraints

- Manifest V3, plain JavaScript, no build step, no runtime dependencies. This matches the prototype.
- No new dependencies of any kind without asking the user first (their standing rule).
- Chrome Web Store policy: a single purpose, the narrowest permissions possible, no remote code. Permissions are expected to be `storage`, content scripts on `<all_urls>`, and whatever the popup's per-tab count needs (no `tabs` if avoidable). `<all_urls>` means a longer first review; accept that.
- Extension pages must not load anything remotely. In particular the Manrope font must be bundled (it is under the Open Font License), not loaded from Google Fonts.
- Popup at most 360×600 px (Chrome's popup cap is 600 px tall), with no scrollbars at the default content.
- Accessibility: real buttons and inputs, keyboard focus visible, 4.5:1 text contrast, touch targets of 44 px or more where space allows.
- Tests: Node's built-in test runner (`node --test`), as today. All tests must pass before any commit (user's rule).

## Decided by the user

- **Name:** Inkout. **Logo:** a white rounded tile with an ink border, two grey lines, and the middle line blacked out by a thick marker stroke, with simplified versions at 32 and 16 px (see the "Name and logo options" board). Not trademark-checked yet.
- **Look:** as in the mockups. Deep navy ink (#0F1B2D), teal for "on" (#0B7A75), amber for "off" (#B45309), Manrope for text, and real blur on sample data. The visual design is approved.
- **Default hide style: blur.** The user asked for blur early on; keep it the default even though the name hints at a solid bar.
- **Sample data** in pages and store images may use Indian names. Nothing country-specific in features or category names.
- **No author name** anywhere in the UI; use a contact email placeholder `[SUPPORT EMAIL]` until the user supplies one.
- **Features approved for v1.0** (from the mockups and plan):
  1. **What to hide**, each with its own switch:
     - email addresses (on)
     - phone numbers, international formats (on)
     - card numbers, Luhn-checked (on)
     - API keys and tokens (on)
     - bank account numbers in IBAN format (on)
     - IP addresses (off by default)
     - custom words and phrases, with an "ignore upper and lower case" option and an advanced "use patterns (regex)" option
  2. **Hide styles:** Blur (default) and Solid bar, plus blur strength Light, Medium (default) or Strong. A third style, "Label", appears in the mockups; see open question 2.
  3. **Sites:** "On every site" (default) or "Only on sites I choose", a "Never hide on" list, and "Pause on this site" from the popup.
  4. **Tab titles:** sensitive values in the page title are hidden too. Gmail puts the user's address there. On by default.
  5. **Per-tab count:** the popup shows how many items are hidden on the current tab, by type. The toolbar icon keeps the red OFF badge when protection is off.
  6. **Keyboard shortcut:** Alt+Shift+H toggles protection.
  7. **Settings page**, as in the mockup, and a **welcome page** that opens once on install.
  8. **Dark mode** for the popup, settings and welcome pages, following the system setting.
  9. **Store assets:** icon PNGs at 16, 32, 48 and 128 px; 1 to 5 screenshots at 1280×800; a 440×280 promo tile; listing text; permission justifications; a privacy policy page.

## Carried over from the prototype (keep)

- The CSS Custom Highlight API paints over matches without changing the page's DOM.
- Hiding starts at `document_start` with a MutationObserver, and fails closed: it hides with the defaults until settings load.
- Selection guard: elements holding hidden text get a data attribute, so `::selection` stays blurred.
- Text fields are hidden as a whole when their value contains a match.
- Settings live in `chrome.storage.sync`.

## Open — needs the user

1. **Which popup design: A (calm switch), B (control panel) or C (presenter mode)?** Recommendation: B, because it exposes the per-type switches and the per-site pause that v1.0 includes.
2. **The "Label" style can't be built the way the rest works.** The Highlight API can only recolor text; it can't replace it with "[email hidden]". Building it would mean changing the page's DOM, or drawing overlay boxes that follow the text, which is fragile while scrolling. Recommendation: ship Blur and Solid bar only, and drop Label from the settings page.
3. **Presenter-mode features** (turn on automatically when sharing starts, and "Blur the whole page" with Alt+Shift+B) appear in Popup C and on the settings page's Shortcuts section. Recommendation: move them to v1.1, so v1.0 ships sooner. The Alt+Shift+B row comes off the settings page for now.

## Left to the builder

- Exact detection patterns:
  - API keys: at least the common prefixed formats, such as GitHub `ghp_`/`gho_`/`github_pat_`, AWS `AKIA…`, Stripe `sk_live_`/`rk_live_`, Slack `xox…`, Google `AIza…`, OpenAI-style `sk-…`, and JWTs `eyJ…`.
  - IBAN: country code, check digits and a mod-97 check, with or without spaces.
  - IPv4, with IPv6 if it's cheap.
  - Custom words: matched literally, with regex as the opt-in.
- Each new detector gets tests in the style of `tests/detectors.test.js`, including false-positive cases.
- How the per-tab counts flow from content scripts in every frame to the popup, e.g. runtime messages to the service worker keyed by tab.
- How tab-title hiding is done (e.g. rewrite `document.title` with the value masked, and restore it when protection is turned off), without fighting pages that update their own title.
- How "Only on sites I choose" and the never-hide list are checked, so the content script does no work on excluded sites.
- File structure inside `src/`, and the popup, settings and welcome page markup, following the approved mockups.
- How to turn the SVG logo into PNG icons and store images without adding dependencies (for example the installed Chrome in headless mode, `--screenshot`).
- A packaging script that zips the extension with `manifest.json` at the archive root, without adding dependencies.
- Wording of the privacy policy and store listing. The policy says nothing is collected or transmitted. Where it gets hosted is the user's choice.
- How in-page behavior is verified: the manual demo page (`tests/demo.html`), extended with the new categories. My call: no jsdom or other test dependency; the user can ask for one.

## What the user must do for release (not code)

- Register a Chrome Web Store developer account (one-time $5, two-step verification).
- Choose where the privacy policy is hosted (for example GitHub Pages) and provide the support email.
- Run a trademark and domain check on "Inkout".
