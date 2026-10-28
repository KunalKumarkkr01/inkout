// Web worker for the settings page: tries a custom pattern on awkward text and reports how long the
// slowest try took. It runs apart from the page, so a pattern that never finishes can be stopped.

/**
 * Summary: texts that make badly written patterns slow: long runs of one character, followed by a
 *          character that stops a match, for each letter or digit the pattern mentions.
 * Parameters: source — the pattern's text.
 * Returns: array of strings.
 */
function probesFor(source) {
  const RUN_LENGTH = 28;
  const LONG_RUN_LENGTH = 10000;
  const MAX_CHARACTERS = 12;
  const characters = [...new Set(['a', '1', ' ', ...(source.match(/[\p{L}\p{N}]/gu) ?? [])])].slice(0, MAX_CHARACTERS);
  return [
    'a'.repeat(LONG_RUN_LENGTH),
    'Hello priya@example.com, call +91 98765 43210 about Project Falcon. '.repeat(150),
    ...characters.map((character) => character.repeat(RUN_LENGTH) + '!'),
  ];
}

self.onmessage = (event) => {
  const { source, flags } = event.data;
  const pattern = new RegExp(source, flags);
  let slowestMs = 0;
  for (const probe of probesFor(source)) {
    const start = performance.now();
    for (const _match of probe.matchAll(pattern)) {
      // Running through every match is the work the content script would do.
    }
    slowestMs = Math.max(slowestMs, performance.now() - start);
  }
  self.postMessage({ slowestMs });
};
