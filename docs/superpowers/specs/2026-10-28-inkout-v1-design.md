# Inkout v1.0 — design

Status: ready for approval · 2026-10-28
Mockups: https://claude.ai/artifact/YbXcXSM5KkJWxSDzaxtHZH (private canvas; the owner can share it). The source of each board is copied into [`docs/mockups/`](../../mockups/) for reference.

## Intent

Inkout is a free Chrome extension that hides sensitive text on web pages: email addresses, phone numbers, card numbers and similar. When you share your screen on a video call, the people watching never see it. It grows out of the working, tested prototype in this repository ("Screen Share Privacy Guard"). v1.0 is the first public release on the Chrome Web Store.

The user's moment: sharing a screen with Gmail or a similar app open, and an email address showing that should not have.

## Goals

- Works automatically on every site from the moment it's installed, with nothing to configure.
- Hides reliably: no flash of unhidden text when a page loads or updates, and selecting hidden text never reveals it.
- Polished enough to publish: a proper popup, settings page, welcome page, icon, store listing and privacy policy.
- Useful worldwide. Nothing is specific to one country.

## Non-goals (v1.0)

- Hiding Chrome's own interface (address bar, autofill dropdowns, bookmarks). An extension can't.
- Text drawn as images, on a canvas, or in Chrome's PDF viewer.
- Detecting screen shares started from desktop apps (installed Zoom or Teams). An extension can't see them.
- A "Label" hide style (see decision 2).
- Firefox, Edge and other browsers; translations.
- Accounts, sync servers, paid tiers.

## Anti-goals (a failure even if it technically works)

- Sending any page content or usage data anywhere. No analytics, no network requests, no remote code. The privacy promise is the product.
- Breaking the sites it runs on, for example by rewriting the page's DOM structure the way wrapping text in spans does.
- Any "peek" feature that shows the real value on screen while sharing, such as hover to reveal.
- Protection silently staying off: a pause or an off state the user can't see before they share.
- Nags, upsells or ratings pop-ups.

## Constraints

- Manifest V3, plain JavaScript, no build step, no runtime dependencies. This matches the prototype.
- No new dependencies of any kind without asking the user first (their standing rule).
- Chrome Web Store policy: a single purpose, the narrowest permissions possible, no remote code. Expected permissions: `storage`, plus content scripts on `<all_urls>`. Avoid `tabs` if possible. `<all_urls>` means a longer first review; accept that.
- Extension pages must not load anything remotely. In particular the Manrope font is bundled (it is under the Open Font License), not loaded from Google Fonts.
- Popup at most 360×600 px (Chrome's popup cap is 600 px tall), with no scrollbars.
- Accessibility: real buttons and inputs, keyboard focus visible, 4.5:1 text contrast, touch targets of 44 px or more where space allows.
- **Tests:** every change keeps `npm test` green. Each new piece of logic gets unit tests in `tests/`. Each new in-page behavior gets an end-to-end test in `tests/browser/`, which loads the real extension into headless Chrome and checks what is actually drawn: fixtures use pure red text, and any red pixel left over a value means it is showing. The prototype has 69 such tests. All tests must pass before any commit (user's rule).
- **Repository:** public at `KunalKumarkkr01/inkout`. `main` only takes squash-merged pull requests whose `test` check passes. Work happens on branches.

## Decided by the user

- **Name:** Inkout. **Logo:** a white rounded tile with an ink border, two grey lines, and the middle line blacked out by a thick marker stroke, with simplified versions at 32 and 16 px (see the "Name and logo options" board). Not trademark-checked yet.
- **Look:** as in the mockups. Deep navy ink (#0F1B2D), teal for "on" (#0B7A75), amber for "off" (#B45309), Manrope for text, and real blur on sample data. The visual design is approved.
- **Default hide style: blur.** The user asked for blur early on; keep it the default even though the name hints at a solid bar.
- **Sample data** in pages and store images may use Indian names. Nothing country-specific in features or category names.
- **No author name** anywhere in the UI. **Support email:** kunaljmit036@gmail.com (also the Chrome Web Store developer account). The user approved showing it publicly in the store listing, the welcome page footer and the privacy policy.
- **Free and open source:** the extension is free to install, and the code is MIT-licensed. Publishing to the Chrome Web Store needs the publisher's one-time registration fee; the Microsoft Edge Add-ons store is free to publish to and may be added later.
- **Features for v1.0:**
  1. **What to hide**, each with its own switch on the settings page:
     - email addresses (on)
     - phone numbers, international formats (on)
     - card numbers, Luhn-checked (on)
     - API keys and tokens (on)
     - bank account numbers in IBAN format (on)
     - IP addresses (off by default)
     - custom words and phrases, with an "ignore upper and lower case" option and an advanced "use patterns (regex)" option
  2. **Hide styles:** Blur (default) and Solid bar, plus blur strength Light, Medium (default) or Strong.
  3. **Sites:** "On every site" (default) or "Only on sites I choose", a "Never hide on" list, and "Pause on this site" from the popup (decision 4).
  4. **Tab titles:** sensitive values in the page title are hidden too. Gmail puts the user's address there. On by default.
  5. **Per-tab count:** the popup shows how many items are hidden on the current tab, by type. The toolbar icon shows a red OFF badge when protection is off.
  6. **Keyboard shortcuts:** Alt+Shift+H toggles protection; Alt+Shift+B blurs the whole page (decision 3).
  7. **Settings page**, as in the mockup, and a **welcome page** that opens once on install.
  8. **Dark mode** for the popup, settings and welcome pages, following the system setting.
  9. **Presenter mode** (decision 3).
  10. **Store assets:** icon PNGs at 16, 32, 48 and 128 px; 1 to 5 screenshots at 1280×800; a 440×280 promo tile; listing text; permission justifications.
  11. **Project website** (added by the user after approval): a small public showcase hosted on GitHub Pages at `https://kunalkumarkkr01.github.io/inkout/`. It has:
      - a landing page: what Inkout does, screenshots, features, a "Get it for Chrome" button and a link to the source code;
      - the privacy policy at `/privacy.html`, which is the store listing's privacy policy URL.

      The extension links to the site: `homepage_url` in the manifest, the welcome page footer, and the settings page. The site follows the extension's look, bundles its font, and loads nothing from third parties (no analytics, no Google Fonts).
  12. **README screenshots** (added by the user after approval): the README shows real screenshots of Inkout at work (a blurred inbox, the popup, the settings page), generated from the same pages as the store screenshots.

## Decided during review

1. **Popup A (calm switch).** It has:
   - one large on/off button;
   - the current site with its count of hidden items by type (for example "9 emails · 3 phones · 2 cards");
   - a "Pause on this site" button;
   - a footer with the shortcut and "Stays on your device".

   The per-type switches live only on the settings page, reached through the gear button.
2. **No "Label" style. Ship Blur (default) and Solid bar only.** Label would need the page's DOM rewritten, or overlay boxes that track the text, and both go against the anti-goals. The settings mockup's Appearance section shows only the two styles.
3. **Presenter mode is in v1.0.**
   - **Sharing detection:** notice when a tab starts sharing the screen through the browser (`navigator.mediaDevices.getDisplayMedia`, as Meet, Teams and Zoom on the web use), and when that share ends (its video track's `ended` event). Say "on the web" wherever the feature is described.
   - **Two settings**, with the mockup's defaults:
     - "Turn on when I start sharing" (on) switches protection on if it was off.
     - "Turn off when sharing ends" (off) only reverts what the automatic switch-on did, never a manual choice.
   - **Blur the whole page:** shortcut Alt+Shift+B, on the current tab, for surprises. Press it again to undo. It must cover the page's own content, including frames, and must be undone when the tab navigates.
   - **In Popup A:** a slim banner at the top while a share is active ("You are sharing your screen · Google Meet"), and a "Blur the whole page" button below the site card. Both appear only when relevant, and the popup still fits in 600 px.
   - **No new permissions:** the page-world script (`src/page-hooks.js`) reports share start and end to the content script, which tells the service worker.
4. **"Pause on this site" is temporary and always visible.**
   - A pause applies to one tab on one site. It ends when the user resumes, closes the tab, or the tab moves to a different site.
   - It is never saved to synced settings.
   - While a tab is paused, the toolbar icon on that tab shows an amber "PAUSED" badge, and Popup A shows the paused state with a Resume button.
   - Sites the user never wants hidden go on the "Never hide on" list in settings, on purpose.

## The prototype this builds on (keep all of it)

- The CSS Custom Highlight API paints over matches without changing the page's DOM.
- Hiding starts at `document_start` with a MutationObserver, and fails closed: it hides with the defaults until settings load.
- Selection guard: elements holding hidden text get a data attribute, so `::selection` stays hidden.
- Text fields (text, email, phone, search, URL and number inputs, and text areas) are hidden as a whole when their value contains a match, whether typed or set by page code.
- Open and closed shadow roots are scanned and get a copy of the hiding styles, including components defined after load. Same-site, cross-site and blank frames are covered. SVG text is blurred as a whole element.
- `src/page-hooks.js` runs in the page's own world and announces script-set field values and newly attached shadow roots. Presenter mode's share detection goes here too.
- Detection handles internationalised emails and international phone formats, and doesn't mistake dates, times, versions, prices or IPs for phones. It stays linear on hostile input: no page freezes.
- Settings live in `chrome.storage.sync`.

## Left to the builder

- Exact detection patterns:
  - API keys: at least the common prefixed formats, such as GitHub `ghp_`/`gho_`/`github_pat_`, AWS `AKIA…`, Stripe `sk_live_`/`rk_live_`, Slack `xox…`, Google `AIza…`, OpenAI-style `sk-…`, and JWTs `eyJ…`.
  - IBAN: country code, check digits and a mod-97 check, with or without spaces.
  - IPv4, with IPv6 if it's cheap.
  - Custom words: matched literally, with regex as the opt-in.
- Each new detector gets tests in the style of `tests/detectors.test.js`, including false-positive cases and the hostile-input speed checks.
- How the per-tab counts flow from content scripts in every frame to the popup, e.g. runtime messages to the service worker keyed by tab.
- Where pause state lives (e.g. `chrome.storage.session`, relayed by the service worker), and how the per-tab badge is set.
- How tab-title hiding is done (e.g. rewrite `document.title` with the value masked, and restore it when protection is turned off), without fighting pages that update their own title.
- How "Only on sites I choose" and the never-hide list are checked, so the content script does no work on excluded sites.
- How "Blur the whole page" is drawn so it covers every frame and can't be undone by the page.
- File structure inside `src/`, and the popup, settings and welcome page markup, following the approved mockups.
- How to turn the SVG logo into PNG icons and store images without adding dependencies, for example the installed Chrome via the existing headless harness.
- A packaging script that zips the extension with `manifest.json` at the archive root, without adding dependencies.
- Wording of the privacy policy and store listing. The policy says nothing is collected or transmitted.

## Calls I made (for the user to check)

- The presenter banner and the "Blur the whole page" button placement in Popup A.
- Starting a screen share ends every pause, so a forgotten pause can't leak during a call.
- A pause also ends when the tab moves to a different site.
- "Turn off when sharing ends" never overrides a manual on/off.
- Manrope is bundled with the extension instead of loaded from Google Fonts.
- No new test dependencies. In-page behavior is tested with the existing headless-Chrome harness.

## What the user must do for release (not code)

- Run a trademark and domain check on "Inkout".
