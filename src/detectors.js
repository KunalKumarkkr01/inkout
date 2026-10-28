// Pure text detection for sensitive data. Loaded as a classic content script
// (exposes globalThis.PiiDetectors) and as a CommonJS module in Node tests.
(function (root) {
  'use strict';

  // The lookbehind makes a match start only at the beginning of a run of address characters.
  // Without it, a long run with no "@" is rescanned from every position (seconds on 100k chars).
  const EMAIL_PATTERN =
    /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:xn--[a-z0-9-]+|[a-z]{2,63}|\p{L}{2,})/giu;
  const CARD_PATTERN = /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g;
  const PHONE_PATTERN = /(?<![\w+@.-])(?:\+\d{1,3}[ .-]?)?(?:\(\d{1,4}\)[ .-]?)?\d(?:[ .-]?\d){5,13}(?![\w@-])/g;

  const CARD_MIN_DIGITS = 13;
  const CARD_MAX_DIGITS = 19;
  const PHONE_MIN_DIGITS = 10;
  const PHONE_MAX_DIGITS = 15;

  // Phone candidates that are really something else.
  const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;
  const DAY = '(?:0?[1-9]|[12]\\d|3[01])';
  const MONTH = '(?:0?[1-9]|1[0-2])';
  const YEAR = '(?:19|20)\\d{2}';
  const SEP = '[-. ]';
  const DATE_PREFIX_PATTERN = new RegExp(
    `^(?:${YEAR}${SEP}${MONTH}${SEP}${DAY}|${DAY}${SEP}${MONTH}${SEP}${YEAR}|${MONTH}${SEP}${DAY}${SEP}${YEAR})(?!\\d)`
  );
  const COUNTRY_CODE_PREFIX = /^\+\d{1,3}[ .-]?/;
  // Dotted phones use groups of 2–4 digits (01.23.45.67.89, 555.123.4567); versions and
  // timestamps with dots have 1- or 5-digit groups or mix dots with spaces.
  const DOTTED_PHONE_PATTERN = /^\d{2,4}(?:\.\d{2,4})+$/;

  /**
   * Summary: checks a digit string against the Luhn checksum used by payment cards.
   * Parameters: digits — string of digits only, e.g. "4111111111111111".
   * Returns: true when the checksum is valid.
   * Usage: isLuhnValid('4111111111111111') → true; filters random 16-digit numbers out of card matches.
   */
  function isLuhnValid(digits) {
    let sum = 0;
    let doubleIt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let value = Number(digits[i]);
      if (doubleIt) {
        value *= 2;
        if (value > 9) value -= 9;
      }
      sum += value;
      doubleIt = !doubleIt;
    }
    return sum % 10 === 0;
  }

  /**
   * Summary: counts the digits in a string.
   * Parameters: text — any string.
   * Returns: number of 0-9 characters.
   * Usage: countDigits('+91 98765 43210') → 12.
   */
  function countDigits(text) {
    return text.replace(/\D/g, '').length;
  }

  /**
   * Summary: decides whether a phone-shaped candidate is really a phone number.
   * Parameters: value — the matched text, e.g. "+91 98765 43210" or "22.10.2026 14".
   * Returns: true for a plausible phone; false for too few/many digits, IPv4 addresses,
   *          dates (with or without a time after them) and dotted version numbers.
   * Usage: isPlausiblePhone('555.123.4567') → true; isPlausiblePhone('2026-10-22 14') → false.
   */
  function isPlausiblePhone(value) {
    const digits = countDigits(value);
    if (digits < PHONE_MIN_DIGITS || digits > PHONE_MAX_DIGITS) return false;
    if (IPV4_PATTERN.test(value) || DATE_PREFIX_PATTERN.test(value)) return false;
    const localPart = value.replace(COUNTRY_CODE_PREFIX, '');
    if (localPart.includes('.') && !DOTTED_PHONE_PATTERN.test(localPart)) return false;
    return true;
  }

  const DETECTORS = [
    { type: 'email', pattern: EMAIL_PATTERN, accept: () => true },
    {
      type: 'card',
      pattern: CARD_PATTERN,
      accept: (value) => {
        const digits = value.replace(/\D/g, '');
        return digits.length >= CARD_MIN_DIGITS && digits.length <= CARD_MAX_DIGITS && isLuhnValid(digits);
      },
    },
    { type: 'phone', pattern: PHONE_PATTERN, accept: isPlausiblePhone },
  ];

  /**
   * Summary: finds emails, card numbers and phone numbers in a piece of text.
   * Parameters: text — the string to scan (typically one DOM text node's content).
   * Returns: array of { type: 'email'|'card'|'phone', start, end }, sorted by start and non-overlapping.
   *          Earlier detectors win overlaps (email > card > phone).
   * Usage: findMatches('Mail a@b.com') → [{ type: 'email', start: 5, end: 12 }].
   */
  function findMatches(text) {
    let matches = [];

    for (const detector of DETECTORS) {
      const accepted = [];
      for (const match of text.matchAll(detector.pattern)) {
        const start = match.index;
        const end = start + match[0].length;
        if (!detector.accept(match[0])) continue;
        if (overlapsSorted(matches, start, end)) continue;
        accepted.push({ type: detector.type, start, end });
      }
      matches = matches.concat(accepted).sort((a, b) => a.start - b.start);
    }
    return matches;
  }

  /**
   * Summary: checks whether [start, end) overlaps any range in a sorted, non-overlapping list.
   * Parameters: sorted — ranges sorted by start that never overlap; start, end — the candidate.
   * Returns: true when the candidate overlaps one of them.
   * Usage: overlapsSorted([{ start: 0, end: 5 }], 3, 8) → true. Binary search keeps big pages fast.
   */
  function overlapsSorted(sorted, start, end) {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sorted[middle].end <= start) low = middle + 1;
      else high = middle;
    }
    return low < sorted.length && sorted[low].start < end;
  }

  const api = { findMatches, isLuhnValid, TYPES: DETECTORS.map((d) => d.type) };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.PiiDetectors = api;
  }
})(globalThis);
