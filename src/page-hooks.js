// Runs in the page's own JavaScript world ("world": "MAIN"), before any page script.
// The content script lives in an isolated world and cannot see these things, so they are
// announced to it as DOM events:
//   - a field's value set by page code (no input event fires),
//   - a shadow root attached after its host is already on the page (no mutation fires), and
//   - the page starting or stopping a screen share (for presenter mode).
(function () {
  'use strict';

  // Keep these names in sync with content.js.
  const VALUE_CHANGED_EVENT = 'inkout:value-changed';
  const SHADOW_ATTACHED_EVENT = 'inkout:shadow-attached';
  const SHARE_STARTED_EVENT = 'inkout:share-started';
  const SHARE_ENDED_EVENT = 'inkout:share-ended';

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

  // A share ends when the user stops it in Chrome's own bar ("ended" fires) or when the page
  // stops the video track itself, as meeting sites' Stop buttons do ("ended" doesn't fire then).
  const sharedTracks = new WeakSet();

  /**
   * Summary: announces the end of a share once, however it ended.
   * Parameters: track — the shared video track.
   */
  function endShare(track) {
    if (!sharedTracks.has(track)) return;
    sharedTracks.delete(track);
    announce(document, SHARE_ENDED_EVENT);
  }

  if (typeof MediaDevices === 'function' && MediaDevices.prototype.getDisplayMedia) {
    const originalGetDisplayMedia = MediaDevices.prototype.getDisplayMedia;
    MediaDevices.prototype.getDisplayMedia = async function getDisplayMedia(...args) {
      const stream = await originalGetDisplayMedia.apply(this, args);
      const [track] = stream.getVideoTracks();
      if (track) {
        sharedTracks.add(track);
        track.addEventListener('ended', () => endShare(track), { once: true });
        announce(document, SHARE_STARTED_EVENT);
      }
      return stream;
    };

    const originalStop = MediaStreamTrack.prototype.stop;
    MediaStreamTrack.prototype.stop = function stop(...args) {
      const result = originalStop.apply(this, args);
      endShare(this);
      return result;
    };
  }
})();
