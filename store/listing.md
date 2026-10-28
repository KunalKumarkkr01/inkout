# Chrome Web Store listing: Inkout

Text to paste into the Chrome Web Store developer dashboard. Images are in this folder.

## Name

Inkout

## Summary

Hides emails, phone numbers, card numbers and API keys on web pages while you share your screen.

## Category

Productivity

## Language

English

## Description

Share your screen, not your inbox.

Inkout blurs sensitive text on every website, automatically, so it never reaches the people on your video call. Nothing to set up: it works from the moment it's installed.

What it hides:
• Email addresses, including international ones
• Phone numbers in international formats
• Card numbers (checked, so random numbers are left alone)
• API keys and tokens (GitHub, AWS, Stripe, OpenAI, Slack, Google and similar)
• Bank account numbers in IBAN format
• IP addresses (off by default)
• Your own words and phrases, such as client or project names

How it works:
• Blur or a solid bar, in three strengths
• Hidden values stay hidden when you select text
• Also covers text fields, tab titles, frames, web components and SVG text
• Works on apps that keep loading new content, like web mail
• Presenter mode: notices when you start sharing in Meet, Teams, Zoom and other meeting sites on the web, and switches protection on
• Alt+Shift+K blurs the whole page in an instant, for surprises
• Pause a single tab when you need to see something; a badge shows it's paused
• Choose the sites it runs on, or list sites to leave alone
• A red OFF badge tells you before you share if protection is off (Alt+Shift+H)

Private by design:
• Everything runs on your device. Nothing is collected, stored elsewhere or sent anywhere.
• No account, no analytics, no ads.
• Free and open source: https://github.com/KunalKumarkkr01/inkout

What it can't hide: Chrome's own interface (address bar, autofill), text inside images or canvas drawings, PDFs, and screen shares started from desktop apps.

## Single purpose

Inkout hides sensitive text, such as email addresses, phone numbers and card numbers, on the web pages a user views, so it isn't visible when the screen is shared.

## Permission justifications

- **storage:** saves the user's settings (what to hide, hide style, site rules) with Chrome sync storage, and remembers temporary per-tab pauses in session storage. Nothing leaves the browser.
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
