# Screen Share Privacy Guard

A Chrome extension that blurs email addresses, phone numbers and card numbers on every web page, so they don't show up when you share your screen on a video call.

It works on any site, including apps like Gmail that keep loading new content. It doesn't change the page's structure: it paints a blur over the matching text using the CSS Custom Highlight API, so sites keep working normally.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (`D:\ChromeExtenstions`).
4. Reload any tabs that were already open.

## Use

- Hiding is **on** by default for all three types.
- Click the toolbar icon to switch hiding on or off, or to choose which types to hide.
- Press **Alt+Shift+H** to toggle quickly. To change the shortcut, go to `chrome://extensions/shortcuts`.
- While hiding is off, the toolbar icon shows a red **OFF** badge, so you can check it before you share.

What gets hidden:

| Type | Examples |
|------|----------|
| Email | `priya.sharma@example.com`, `a+tag@mail.co.uk`, `josé@exämple.com` |
| Phone (10–15 digits) | `+91 98765 43210`, `(555) 123-4567`, `+44 20 7946 0958`, `01.23.45.67.89` |
| Card (13–19 digits, Luhn-checked) | `4111 1111 1111 1111`, `3782 822463 10005` |

Dates (`22.10.2026 14:30`, `2026-10-22 14:30`), times, versions, prices and IP addresses are not mistaken for phone numbers.

It also covers:

- **Text fields** (text, email, phone, search, URL and number inputs, and text areas): blurred as a whole when they contain any of these, whether you typed the value or the page's own script filled it in.
- **Web components**: text inside open and closed shadow roots, including components the page defines later.
- **Frames**: same-site, cross-site and blank frames.
- **SVG text**: blurred as a whole element.

Hidden text stays blurred when you select it. While a selection is active, other text in the same element blurs too (for example, the rest of a line like `Discarded · name@example.com · 1 day ago`). It returns to normal when you deselect.

## Limitations

- Only the web page's content is hidden. Chrome's own interface is not: the address bar, tab titles, bookmarks, and autofill dropdowns.
- The page's own tab title is not hidden yet (Gmail shows your address there). This is planned.
- A value split across elements is missed, for example `john` in one tag and `@example.com` in the next.
- Text drawn as images, on a canvas, or in Chrome's PDF viewer can't be read, so it isn't hidden.
- Phone numbers shorter than 10 digits without a country code (such as an 8-digit local number) are not detected.
- Chrome doesn't run extensions on `chrome://` pages or the Chrome Web Store.
- Some long numbers, such as 10-digit order IDs, get blurred as phone numbers. This is intentional: hiding too much is safer than hiding too little.
- To catch values set by page scripts and components created later, `src/page-hooks.js` wraps the `value` setter of inputs and text areas and `Element.attachShadow` in the page's own JavaScript world. A small number of anti-tampering scripts (some banking sites) check whether built-in functions were changed.

## Development

```bash
npm test
```

This runs every test with Node's built-in test runner (Node 22+, no dependencies):

- **Unit tests** (`tests/*.test.js`): detection across international formats, lookalikes that must not match, and hostile input that must not freeze a page.
- **Browser tests** (`tests/browser/`): load the real extension into headless Chrome with a throwaway profile, open the pages in `tests/browser/fixtures/`, and check what is hidden and what is actually drawn. The fixtures use pure red text, so any red pixel left where a value should be hidden means the original text is showing. They need Chrome installed; set `CHROME_PATH` if it isn't in the default location. Without Chrome they are skipped locally but required on CI.

`tests/demo.html` is a manual test page. It loads the content script with an in-memory stand-in for `chrome.storage`. Serve the folder over HTTP (not `file://`) and open `/tests/demo.html`.

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (MV3) |
| `src/detectors.js` | Finds emails, phones and cards in text |
| `src/content.js` | Scans the page, watches for changes, applies the blur |
| `src/content.css` | Blur styles |
| `src/page-hooks.js` | Runs in the page's world; announces script-set values and new shadow roots |
| `src/settings.js` | Shared settings: load, save, change listener |
| `src/popup.*` | Toolbar popup |
| `src/background.js` | Keyboard shortcut and OFF badge |
| `tests/browser/` | Headless-Chrome test harness, fixtures and end-to-end tests |
