# Chrome Web Store listing: Inkout

Text to paste into the Chrome Web Store developer dashboard. Images are in this folder.

## Name

Inkout

## Summary

Hides emails, phone numbers, card numbers and API keys on web pages while you share your screen.

## Category

Privacy & Security (the dashboard lists sub-categories only; this one sits under "Make Chrome Yours")

## Language

English

## Description

Share your screen, not your inbox.

Inkout automatically blurs sensitive information across websites, helping you protect private data when sharing your screen during video calls, presentations, or demonstrations.

No complicated setup required. Install Inkout and it starts protecting your browsing experience.

What it hides:
• Email addresses, including international formats
• Phone numbers, including international formats
• Payment card numbers, with validation to reduce false positives
• API keys, access tokens, and other authentication credentials
• Bank account numbers in IBAN format
• IP addresses (disabled by default)
• Custom words and phrases, such as client names, project names, or other confidential terms

How it works:
• Choose between blur and solid-bar masking styles, with three intensity levels
• Prevent sensitive information from being revealed through text selection
• Protect content in text fields, tab titles, frames, web components, and SVG text
• Automatically detect and protect dynamically loaded content
• Presenter Mode detects screen sharing started on web meeting sites and turns protection on automatically
• Press Alt+Shift+K to blur the entire page instantly
• Temporarily pause protection on individual tabs when needed, with a visible indicator
• Configure which websites Inkout should protect or exclude
• A red OFF indicator warns you when protection is turned off. Press Alt+Shift+H to turn protection on or off

Private by design:
• No data collection or external transmission. Your page content stays inside your browser.
• Settings are stored in Chrome. If Chrome Sync is enabled, your settings may sync across your devices.
• No account required, no analytics, and no advertisements.
• Free and open source: https://github.com/KunalKumarkkr01/inkout

Limitations:
Inkout cannot hide content in Chrome's own interface, including the address bar and autofill suggestions. It also cannot detect text embedded in images, canvas drawings, or PDFs. Screen sharing started from desktop apps is not detected.

Inkout is designed to help reduce accidental exposure of sensitive information, but it is not a replacement for reviewing your screen before sharing.

## Single purpose

Inkout hides sensitive text, such as email addresses, phone numbers and card numbers, on the web pages a user views, so it isn't visible when the screen is shared.

## Permission justifications

- **storage:** saves the user's settings (what to hide, hide style, site rules) with Chrome sync storage, and remembers temporary per-tab pauses in session storage. Inkout itself sends nothing anywhere; if the user has Chrome sync on, Chrome copies the settings to their other signed-in browsers.
- **Host access (content scripts on all sites):** sensitive text can appear on any website, so the hiding script has to run on every page the user opens. It only reads the page's text to find values to blur; it never sends page content anywhere and never changes the page's structure.

## Remote code

No. All code is included in the package.

## Data usage

Inkout does not collect or transmit any user data. Tick none of the data types. Certify:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Links

- Homepage: https://kunalkumarkkr01.github.io/inkout/
- Privacy policy: https://kunalkumarkkr01.github.io/inkout/privacy.html
- Support: kunaljmit036@gmail.com

## Images

| File | Use |
|------|-----|
| `../icons/icon-128.png` | Store icon (128×128) |
| `screenshot-1-inbox.png` | Screenshot 1 (1280×800) |
| `screenshot-2-popup.png` | Screenshot 2 (1280×800) |
| `screenshot-3-settings.png` | Screenshot 3 (1280×800) |
| `screenshot-4-welcome.png` | Screenshot 4 (1280×800) |
| `promo-440x280.png` | Small promo tile (440×280) |

Regenerate them with `npm run render -- store` after changing the pages.
