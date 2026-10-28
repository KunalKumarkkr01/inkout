// Hides sensitive text using the CSS Custom Highlight API: matches are painted over
// without changing the page's DOM, so apps like Gmail keep working normally.
(function () {
  'use strict';

  const { findMatches, createCustomPattern, TYPES } = globalThis.PiiDetectors;
  const Settings = globalThis.PrivacyGuardSettings;
  const { isSiteActive } = globalThis.InkoutSites;

  const HIGHLIGHT_PREFIX = 'privacy-guard-';
  const FIELD_MASK_ATTRIBUTE = 'data-privacy-guard-masked';
  // Selection paints above custom highlights, so elements holding hidden text are tagged
  // with their types and content.css blurs their ::selection too.
  const SELECTION_GUARD_ATTRIBUTE = 'data-privacy-guard-selection';
  const ACTIVE_TYPES_ATTRIBUTE = 'data-privacy-guard-active';
  // Announced by page-hooks.js from the page's own world; keep the names in sync.
  const VALUE_CHANGED_EVENT = 'inkout:value-changed';
  const SHADOW_ATTACHED_EVENT = 'inkout:shadow-attached';
  const PRUNE_DELAY_MS = 2000;
  // <title> text isn't drawn in the page; maskTitle() rewrites it instead.
  const SKIPPED_PARENT_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'TITLE']);
  const TITLE_MASK = '•••••';
  const IS_TOP_FRAME = window === window.top;
  const TEXT_FIELD_SELECTOR = [
    'input:not([type])',
    'input[type="text"]',
    'input[type="email"]',
    'input[type="tel"]',
    'input[type="search"]',
    'input[type="url"]',
    'input[type="number"]',
    'textarea',
  ].join(', ');
  const OBSERVER_OPTIONS = {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['value'],
  };

  // Page stylesheets (and content.css) don't reach inside shadow roots, so each one adopts
  // this copy of content.css. Inside a shadow tree, :host-context() stands in for `html`.
  // tests/styles.test.js checks it stays in line with content.css.
  const STYLE_ATTRIBUTE = 'data-privacy-guard-style';
  const STRENGTH_ATTRIBUTE = 'data-privacy-guard-strength';
  const BLUR = '0 0 0.6em #3c4043, 0 0 0.6em #3c4043, 0 0 0.6em #3c4043';
  const LIGHT_BLUR = '0 0 0.6em #3c4043, 0 0 0.6em #3c4043';
  const STRONG_BLUR = '0 0 0.8em #3c4043, 0 0 0.8em #3c4043, 0 0 0.8em #3c4043, 0 0 0.8em #3c4043';
  const NO_SHADOW = 'none';
  const onPage = (htmlAttributes, inner) => `:host-context(html${htmlAttributes}) ${inner}`;
  const highlightSelectors = (htmlAttributes = '') =>
    TYPES.map((type) => {
      const highlight = `::highlight(${HIGHLIGHT_PREFIX}${type})`;
      return htmlAttributes ? onPage(htmlAttributes, highlight) : highlight;
    });
  const selectionSelectors = (htmlAttributes = '') =>
    TYPES.map((type) =>
      onPage(`${htmlAttributes}[${ACTIVE_TYPES_ATTRIBUTE}~='${type}']`, `[${SELECTION_GUARD_ATTRIBUTE}~='${type}']::selection`)
    );
  const variantRule = (htmlAttributes, declarations) => `
    ${[
      ...highlightSelectors(htmlAttributes),
      ...selectionSelectors(htmlAttributes),
      onPage(htmlAttributes, `[${FIELD_MASK_ATTRIBUTE}]`),
      onPage(htmlAttributes, `[${FIELD_MASK_ATTRIBUTE}]::selection`),
    ].join(', ')} { ${declarations} }`;
  const SHADOW_STYLES = `
    ${highlightSelectors().join(', ')} {
      color: transparent;
      -webkit-text-fill-color: transparent;
      text-shadow: ${BLUR};
      text-decoration: none;
    }
    ${selectionSelectors().join(', ')},
    [${FIELD_MASK_ATTRIBUTE}]::selection {
      color: transparent !important;
      -webkit-text-fill-color: transparent !important;
      text-shadow: ${BLUR} !important;
      background-color: Highlight !important;
    }
    ${TYPES.map((type) =>
      onPage(
        `[${ACTIVE_TYPES_ATTRIBUTE}~='${type}']`,
        `svg text:is([${SELECTION_GUARD_ATTRIBUTE}~='${type}'], :has([${SELECTION_GUARD_ATTRIBUTE}~='${type}']))`
      )
    ).join(', ')} {
      fill: #3c4043 !important;
      stroke: #3c4043 !important;
      stroke-width: 0.12em !important;
      filter: blur(0.35em);
    }
    [${FIELD_MASK_ATTRIBUTE}] {
      color: transparent !important;
      -webkit-text-fill-color: transparent !important;
      text-shadow: ${BLUR} !important;
      caret-color: #5f6368 !important;
    }
    ${variantRule(`[${STRENGTH_ATTRIBUTE}='light']`, `text-shadow: ${LIGHT_BLUR} !important;`)}
    ${variantRule(`[${STRENGTH_ATTRIBUTE}='strong']`, `text-shadow: ${STRONG_BLUR} !important;`)}
    ${variantRule(
      `[${STYLE_ATTRIBUTE}='bar']`,
      `text-shadow: ${NO_SHADOW} !important; background-color: #0F1B2D !important;`
    )}`;

  // Fail closed: hide everything with the defaults until stored settings arrive.
  let settings = Settings.DEFAULTS;
  let customPattern = null;
  let customPatternKey = '';
  // Whether this page is being protected at all (on, and allowed on this site). While not,
  // the page isn't watched or scanned, and nothing is painted over.
  let protecting = true;
  // The page's own title, and the masked one this script last wrote (to tell the two apart).
  let rawTitle = null;
  let lastWrittenTitle = null;
  const highlights = new Map(TYPES.map((type) => [type, new Highlight()]));
  const rangesByTextNode = new Map();
  const shadowRoots = new Set();
  const shadowSheet = new CSSStyleSheet();
  shadowSheet.replaceSync(SHADOW_STYLES);
  const observer = new MutationObserver(handleMutations);
  let pruneTimer = null;

  /**
   * Summary: whether a data type should currently be hidden.
   * Parameters: type — one of PiiDetectors.TYPES, such as 'email' or 'apiKey'.
   * Returns: true when hiding is on overall and for this type.
   * Usage: isTypeActive('email') → false after the user unticks Emails in the popup.
   */
  function isTypeActive(type) {
    return protecting && settings.types[type];
  }

  /**
   * Summary: the host of the tab's top page, so frames follow the rules of the site they're shown on.
   * Returns: a host such as "mail.example.com" or "localhost:3000" ('' for pages without one).
   * Usage: isSiteActive(settings, topHost()).
   */
  function topHost() {
    if (IS_TOP_FRAME) return location.host;
    const origins = location.ancestorOrigins;
    try {
      return new URL(origins[origins.length - 1]).host;
    } catch {
      return location.host;
    }
  }

  /**
   * Summary: shows or hides each type's highlight according to the settings.
   * Usage: called after settings change; ranges stay tracked, only their painting toggles.
   */
  function applyHighlightRegistry() {
    const html = document.documentElement;
    html.setAttribute(ACTIVE_TYPES_ATTRIBUTE, TYPES.filter(isTypeActive).join(' '));
    html.setAttribute(STYLE_ATTRIBUTE, settings.style);
    html.setAttribute(STRENGTH_ATTRIBUTE, settings.blurStrength);
    for (const [type, highlight] of highlights) {
      const name = HIGHLIGHT_PREFIX + type;
      if (isTypeActive(type)) {
        CSS.highlights.set(name, highlight);
      } else {
        CSS.highlights.delete(name);
      }
    }
  }

  /**
   * Summary: removes every tracked highlight range for one text node.
   * Parameters: node — a Text node.
   * Usage: before rescanning a changed node, or once the node leaves the page.
   */
  function forgetTextNode(node) {
    const tracked = rangesByTextNode.get(node);
    if (!tracked) return;
    for (const { type, range } of tracked.entries) highlights.get(type).delete(range);
    rangesByTextNode.delete(node);
    refreshSelectionGuard(tracked.element);
  }

  /**
   * Summary: tags an element with the types of hidden text it directly contains, so selecting
   *          that text keeps it blurred (see content.css); removes the tag when none remain.
   * Parameters: element — the parent element of a tracked text node.
   * Usage: called whenever a text node under the element is masked or forgotten.
   */
  function refreshSelectionGuard(element) {
    const types = new Set();
    for (const child of element.childNodes) {
      rangesByTextNode.get(child)?.entries.forEach(({ type }) => types.add(type));
    }
    if (types.size === 0) {
      element.removeAttribute(SELECTION_GUARD_ATTRIBUTE);
    } else {
      element.setAttribute(SELECTION_GUARD_ATTRIBUTE, [...types].join(' '));
    }
  }

  /**
   * Summary: finds sensitive values in one text node and paints over them.
   * Parameters: node — a Text node on the page.
   * Usage: maskTextNode(textNode) after the node is added or its text changes.
   */
  function maskTextNode(node) {
    forgetTextNode(node);
    const parent = node.parentElement;
    if (!parent) return;
    // A text area's child text is its default value: check the field itself instead.
    if (parent.tagName === 'TEXTAREA') maskTextField(parent);
    if (SKIPPED_PARENT_TAGS.has(parent.tagName)) return;

    const matches = findMatches(node.data, customPattern);
    if (matches.length === 0) return;

    const entries = matches.map(({ type, start, end }) => {
      const range = new Range();
      range.setStart(node, start);
      range.setEnd(node, end);
      highlights.get(type).add(range);
      return { type, range };
    });
    rangesByTextNode.set(node, { element: parent, entries });
    refreshSelectionGuard(parent);
  }

  /**
   * Summary: hides the whole value of a text field when it contains sensitive data.
   * Parameters: field — an <input> or <textarea> element.
   * Usage: maskTextField(emailInput) on page load, on every keystroke and when page code sets the value.
   */
  function maskTextField(field) {
    const shouldMask = findMatches(field.value, customPattern).some((match) => isTypeActive(match.type));
    field.toggleAttribute(FIELD_MASK_ATTRIBUTE, shouldMask);
  }

  /**
   * Summary: starts hiding inside a shadow root: adopts the hiding styles, watches it for changes, scans it.
   * Parameters: shadowRoot — an open or closed ShadowRoot.
   * Usage: watchShadowRoot(host.shadowRoot) when a web component is found or attaches one.
   */
  function watchShadowRoot(shadowRoot) {
    if (shadowRoots.has(shadowRoot)) return;
    shadowRoots.add(shadowRoot);
    shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, shadowSheet];
    if (!protecting) return;
    observer.observe(shadowRoot, OBSERVER_OPTIONS);
    scanSubtree(shadowRoot);
  }

  /**
   * Summary: watches an element's shadow root, if it has one. Closed roots are reached through
   *          chrome.dom, which only extensions can use; only custom elements are asked, to stay fast.
   * Parameters: element — any element.
   */
  function watchShadowOf(element) {
    const shadowRoot =
      element.shadowRoot ?? (element.localName.includes('-') ? chrome.dom.openOrClosedShadowRoot(element) : null);
    if (shadowRoot) watchShadowRoot(shadowRoot);
  }

  /**
   * Summary: scans a node and everything inside it: text, text fields and web components.
   * Parameters: root — any DOM node (text node, element, document fragment or shadow root).
   * Usage: scanSubtree(document.documentElement) at start; scanSubtree(addedNode) for new content.
   */
  function scanSubtree(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      maskTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;

    if (root.nodeType === Node.ELEMENT_NODE) scanElement(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === Node.TEXT_NODE) maskTextNode(node);
      else scanElement(node);
    }
  }

  /**
   * Summary: per-element part of a scan: text fields get checked, web components get watched.
   * Parameters: element — an element found during a scan.
   */
  function scanElement(element) {
    if (element.matches(TEXT_FIELD_SELECTOR)) maskTextField(element);
    watchShadowOf(element);
  }

  /**
   * Summary: every text field on the page, including those inside watched shadow roots.
   * Returns: array of input and textarea elements.
   */
  function allTextFields() {
    const roots = [document, ...shadowRoots];
    return roots.flatMap((root) => [...root.querySelectorAll(TEXT_FIELD_SELECTOR)]);
  }

  /**
   * Summary: drops tracked ranges and shadow roots that are no longer on the page (frees memory).
   * Usage: runs a short while after nodes are removed; batched by schedulePrune.
   */
  function pruneDetachedNodes() {
    pruneTimer = null;
    for (const node of rangesByTextNode.keys()) {
      if (!node.isConnected) forgetTextNode(node);
    }
    for (const shadowRoot of shadowRoots) {
      if (!shadowRoot.host.isConnected) shadowRoots.delete(shadowRoot);
    }
  }

  /**
   * Summary: schedules one prune pass, however many removals happen meanwhile.
   * Usage: called from the mutation observer whenever nodes are removed.
   */
  function schedulePrune() {
    if (pruneTimer !== null) return;
    pruneTimer = setTimeout(pruneDetachedNodes, PRUNE_DELAY_MS);
  }

  /**
   * Summary: handles page changes; runs before the browser paints, so new content never flashes unmasked.
   * Parameters: records — MutationRecord list from the MutationObserver.
   * Usage: new MutationObserver(handleMutations).observe(...)
   */
  function handleMutations(records) {
    for (const record of records) {
      if (record.type === 'characterData') {
        maskTextNode(record.target);
        continue;
      }
      if (record.type === 'attributes') {
        if (record.target.matches(TEXT_FIELD_SELECTOR)) maskTextField(record.target);
        continue;
      }
      record.addedNodes.forEach(scanSubtree);
      if (record.removedNodes.length > 0) schedulePrune();
    }
    if (IS_TOP_FRAME && document.title !== lastWrittenTitle) maskTitle();
  }

  /**
   * Summary: hides sensitive values in the tab title (top frame only), or puts the real title back.
   * Usage: after the page changes its title, and whenever settings change. A title equal to the one this
   *        script last wrote is its own, so writing it never loops.
   */
  function maskTitle() {
    if (!IS_TOP_FRAME) return;
    const current = document.title;
    if (rawTitle === null || current !== lastWrittenTitle) rawTitle = current;
    const wanted = protecting && settings.hideTitles ? maskText(rawTitle) : rawTitle;
    lastWrittenTitle = wanted;
    if (wanted !== current) document.title = wanted;
  }

  /**
   * Summary: replaces each sensitive value of an active type in a string with dots.
   * Parameters: text — any string.
   * Returns: the string with matches replaced, e.g. "Inbox - ••••• - Mail".
   */
  function maskText(text) {
    let masked = text;
    const matches = findMatches(text, customPattern).filter((match) => isTypeActive(match.type));
    for (const { start, end } of matches.reverse()) {
      masked = masked.slice(0, start) + TITLE_MASK + masked.slice(end);
    }
    return masked;
  }

  /**
   * Summary: rechecks the field an input-type event came from, even inside a shadow root.
   * Parameters: event — input event, or the value-changed event from page-hooks.js.
   */
  function handleFieldEvent(event) {
    if (!protecting) return;
    const field = event.composedPath()[0];
    if (field instanceof Element && field.matches(TEXT_FIELD_SELECTOR)) maskTextField(field);
  }

  /**
   * Summary: watches a shadow root attached after its host was already scanned.
   * Parameters: event — the shadow-attached event from page-hooks.js.
   */
  function handleShadowAttached(event) {
    const host = event.composedPath()[0];
    const shadowRoot = host.shadowRoot ?? chrome.dom.openOrClosedShadowRoot(host);
    if (shadowRoot) watchShadowRoot(shadowRoot);
  }

  /**
   * Summary: rebuilds the custom-words pattern when the user's words or their options change.
   * Returns: true when the pattern changed, so the page must be rescanned.
   * Usage: if (updateCustomPattern()) rescanEverything();
   */
  function updateCustomPattern() {
    const { customWords, customWordsIgnoreCase, customWordsAsPatterns } = settings;
    const key = JSON.stringify([customWords, customWordsIgnoreCase, customWordsAsPatterns]);
    if (key === customPatternKey) return false;
    customPatternKey = key;
    customPattern = createCustomPattern(customWords, {
      ignoreCase: customWordsIgnoreCase,
      asPatterns: customWordsAsPatterns,
    });
    return true;
  }

  /**
   * Summary: scans the whole page again, including every watched shadow root.
   * Usage: after the custom words change, since what counts as a match changed.
   */
  function rescanEverything() {
    scanSubtree(document.documentElement);
    shadowRoots.forEach(scanSubtree);
  }

  /**
   * Summary: applies new settings to this page.
   * Parameters: nextSettings — complete settings object.
   * Usage: called once settings load and whenever they change.
   */
  function applySettings(nextSettings) {
    settings = nextSettings;
    const patternChanged = updateCustomPattern();
    const shouldProtect = settings.enabled && isSiteActive(settings, topHost());
    if (shouldProtect !== protecting) {
      setProtecting(shouldProtect);
      return;
    }
    applyHighlightRegistry();
    maskTitle();
    if (!protecting) return;
    if (patternChanged) rescanEverything();
    else allTextFields().forEach(maskTextField);
  }

  /**
   * Summary: starts or stops protecting this page as a whole.
   * Parameters: on — true to watch, scan and hide; false to stop all work and show everything.
   * Usage: setProtecting(false) on a never-hide site; setProtecting(true) once it's removed from the list.
   */
  function setProtecting(on) {
    protecting = on;
    applyHighlightRegistry();
    maskTitle();
    if (on) {
      observer.observe(document.documentElement, OBSERVER_OPTIONS);
      shadowRoots.forEach((shadowRoot) => observer.observe(shadowRoot, OBSERVER_OPTIONS));
      rescanEverything();
      return;
    }
    observer.disconnect();
    [...rangesByTextNode.keys()].forEach(forgetTextNode);
    allTextFields().forEach((field) => field.removeAttribute(FIELD_MASK_ATTRIBUTE));
  }

  applyHighlightRegistry();
  updateCustomPattern();
  scanSubtree(document.documentElement);
  maskTitle();
  observer.observe(document.documentElement, OBSERVER_OPTIONS);
  document.addEventListener('input', handleFieldEvent, true);
  document.addEventListener(VALUE_CHANGED_EVENT, handleFieldEvent, true);
  document.addEventListener(SHADOW_ATTACHED_EVENT, handleShadowAttached, true);

  Settings.load().then(applySettings);
  Settings.onChange(applySettings);
})();
