// Runs in the page's own JavaScript world ("world": "MAIN"), before any page script.
// The content script lives in an isolated world and cannot see two things, so they are
// announced to it as DOM events:
//   - a field's value set by page code (no input event fires), and
//   - a shadow root attached after its host is already on the page (no mutation fires).
(function () {
  'use strict';

  // Keep these names in sync with content.js.
  const VALUE_CHANGED_EVENT = 'inkout:value-changed';
  const SHADOW_ATTACHED_EVENT = 'inkout:shadow-attached';

  /**
   * Summary: fires a non-bubbling event that crosses shadow boundaries, for the content script's capture listener.
   * Parameters: target — the field or shadow host; type — event name.
   * Usage: announce(input, VALUE_CHANGED_EVENT) right after page code sets input.value.
   */
  function announce(target, type) {
    target.dispatchEvent(new Event(type, { composed: true }));
  }

  for (const prototype of [HTMLInputElement.prototype, HTMLTextAreaElement.prototype]) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    Object.defineProperty(prototype, 'value', {
      ...descriptor,
      set(value) {
        descriptor.set.call(this, value);
        announce(this, VALUE_CHANGED_EVENT);
      },
    });
  }

  const originalAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function attachShadow(...args) {
    const shadowRoot = originalAttachShadow.apply(this, args);
    announce(this, SHADOW_ATTACHED_EVENT);
    return shadowRoot;
  };
})();
