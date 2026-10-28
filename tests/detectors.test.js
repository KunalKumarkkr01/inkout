const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { findMatches, isLuhnValid } = require('../src/detectors.js');

// Adversarial inputs must finish well inside one frame budget so a page never freezes.
const SLOW_INPUT_LIMIT_MS = 250;

/**
 * Summary: returns the matched substrings of `text` as "type:value" strings for easy assertions.
 * Parameters: text — the string to scan.
 * Returns: array like ["email:a@b.com", "phone:+91 98765 43210"].
 * Usage: assert.deepEqual(found('mail a@b.com'), ['email:a@b.com']).
 */
function found(text) {
  return findMatches(text).map((m) => `${m.type}:${text.slice(m.start, m.end)}`);
}

/**
 * Summary: appends the Luhn check digit to a digit string, producing a valid card-style number.
 * Parameters: digits — digit string without the check digit.
 * Returns: digits plus the one check digit that makes isLuhnValid true.
 * Usage: withLuhnCheckDigit('411111111111111') → '4111111111111111'.
 */
function withLuhnCheckDigit(digits) {
  for (let check = 0; check <= 9; check++) {
    if (isLuhnValid(digits + check)) return digits + check;
  }
  throw new Error('unreachable: one check digit always satisfies Luhn');
}

/**
 * Summary: measures how long findMatches takes on one input.
 * Parameters: text — the string to scan.
 * Returns: elapsed milliseconds.
 * Usage: assert.ok(elapsedMs(hugeText) < SLOW_INPUT_LIMIT_MS).
 */
function elapsedMs(text) {
  const start = process.hrtime.bigint();
  findMatches(text);
  return Number(process.hrtime.bigint() - start) / 1e6;
}

describe('emails', () => {
  test('detects common address shapes', () => {
    for (const email of [
      'john.doe@example.com',
      'a+tag@mail.co.uk',
      'UPPER.CASE@EXAMPLE.COM',
      'first_last-99@sub.domain.example.org',
      'x@a.io',
      'priya%team@example.in',
    ]) {
      assert.deepEqual(found(email), [`email:${email}`], email);
    }
  });

  test('detects internationalised addresses', () => {
    assert.deepEqual(found('Write to josé@exämple.com'), ['email:josé@exämple.com']);
    assert.deepEqual(found('用户@例子.广告'), ['email:用户@例子.广告']);
    assert.deepEqual(found('user@example.xn--p1ai'), ['email:user@example.xn--p1ai']);
  });

  test('stops at surrounding punctuation', () => {
    assert.deepEqual(found('Mail me at a@b.com.'), ['email:a@b.com']);
    assert.deepEqual(found('(a@b.com)'), ['email:a@b.com']);
    assert.deepEqual(found('<a@b.com>'), ['email:a@b.com']);
    assert.deepEqual(found('"a@b.com",'), ['email:a@b.com']);
    assert.deepEqual(found('mailto:a@b.com'), ['email:a@b.com']);
  });

  test('detects several addresses in one string', () => {
    assert.deepEqual(found('x@a.io, y@b.org; z@c.net'), ['email:x@a.io', 'email:y@b.org', 'email:z@c.net']);
  });

  test('hides credentials embedded in a URL', () => {
    assert.deepEqual(found('https://user:secret@host.example.com/x'), ['email:secret@host.example.com']);
  });

  test('ignores handles, bare domains and addresses without a real top-level domain', () => {
    for (const text of ['ping @kunal', 'example.com', 'a@b', 'user@localhost', 'a@b.c', 'score 5@3']) {
      assert.deepEqual(found(text), [], text);
    }
  });

  test('an address made of digits is one email, not a phone', () => {
    assert.deepEqual(found('9876543210@gmail.com'), ['email:9876543210@gmail.com']);
  });
});

describe('phone numbers', () => {
  test('detects formats used around the world', () => {
    for (const phone of [
      '+91 98765 43210',
      '+91-98765-43210',
      '+919876543210',
      '9876543210',
      '(555) 123-4567',
      '+1-555-123-4567',
      '+1 (555) 123-4567',
      '555-123-4567',
      '555.123.4567',
      '+44 20 7946 0958',
      '020 7946 0958',
      '+49 30 1234567',
      '030 1234567',
      '+33 1 23 45 67 89',
      '01 23 45 67 89',
      '01.23.45.67.89',
      '+61 2 9876 5432',
      '+81 3-1234-5678',
      '+55 11 91234-5678',
      '+86 138 0013 8000',
      '+971 50 123 4567',
    ]) {
      assert.deepEqual(found(`Call ${phone} today`), [`phone:${phone}`], phone);
    }
  });

  test('ignores short numbers, years, versions and times', () => {
    for (const text of ['Order 12345', 'In 2026', 'Version 1.2.3', 'Build 10.0.19045.3693', 'At 12:30:45', '2019-2026']) {
      assert.deepEqual(found(text), [], text);
    }
  });

  test('ignores dates, including dates followed by a time', () => {
    for (const text of [
      'Due 22.10.2026',
      'Due 22.10.2026 14:30',
      'Logged 2026-10-22 14:30:00',
      'Sent 10-22-2026 09:15',
      'On 22 10 2026 11:00',
    ]) {
      assert.deepEqual(found(text), [], text);
    }
  });

  test('ignores IPv4 addresses (they have their own category)', () => {
    assert.deepEqual(found('Server 192.168.100.200'), []);
  });

  test('ignores prices with thousands separators', () => {
    assert.deepEqual(found('Total $1,234,567.89'), []);
  });

  test('a bare 10-digit number counts as a phone (hiding too much beats leaking)', () => {
    assert.deepEqual(found('Ref 1698765432'), ['phone:1698765432']);
  });
});

describe('card numbers', () => {
  test('detects test numbers from the major networks', () => {
    for (const card of [
      '4111 1111 1111 1111',
      '4111-1111-1111-1111',
      '4111111111111111',
      '4222222222222',
      '5500 0000 0000 0004',
      '2223 0031 2200 3222',
      '3782 822463 10005',
      '378282246310005',
      '6011 1111 1111 1117',
      '3056 9309 0259 04',
      '3530 1113 3330 0000',
    ]) {
      assert.deepEqual(found(`Card ${card} on file`), [`card:${card}`], card);
    }
  });

  test('detects a 19-digit card', () => {
    const card = withLuhnCheckDigit('622126000000000000');
    assert.deepEqual(found(card), [`card:${card}`]);
  });

  test('detects a card glued to punctuation', () => {
    assert.deepEqual(found('card#4111111111111111!'), ['card:4111111111111111']);
  });

  test('a number failing the Luhn check is not a card', () => {
    assert.equal(findMatches('4111 1111 1111 1112').some((m) => m.type === 'card'), false);
  });

  test('numbers too short or too long for a card are not cards', () => {
    const tooShort = withLuhnCheckDigit('41111111111');
    const tooLong = withLuhnCheckDigit('4111111111111111111');
    assert.equal(findMatches(tooShort).some((m) => m.type === 'card'), false);
    assert.equal(findMatches(tooLong).some((m) => m.type === 'card'), false);
  });

  test('isLuhnValid checks the Luhn checksum', () => {
    assert.equal(isLuhnValid('4111111111111111'), true);
    assert.equal(isLuhnValid('4111111111111112'), false);
    assert.equal(isLuhnValid('0'), true);
  });
});

describe('mixed text', () => {
  test('matches are sorted by position and never overlap', () => {
    const text = 'Mail a@b.com, card 4111111111111111, phone +44 20 7946 0958';
    const matches = findMatches(text);
    assert.deepEqual(matches.map((m) => m.type), ['email', 'card', 'phone']);
    for (let i = 1; i < matches.length; i++) {
      assert.ok(matches[i].start >= matches[i - 1].end);
    }
  });

  test('works across line breaks', () => {
    assert.deepEqual(found('Name: Priya\nEmail: priya@example.com\nPhone: +91 98765 43210'), [
      'email:priya@example.com',
      'phone:+91 98765 43210',
    ]);
  });

  test('repeated calls give the same answer (no state left behind)', () => {
    const text = 'a@b.com 9876543210 4111111111111111';
    const first = found(text);
    for (let i = 0; i < 5; i++) assert.deepEqual(found(text), first);
  });

  test('returns nothing for empty or blank text', () => {
    assert.deepEqual(findMatches(''), []);
    assert.deepEqual(findMatches('   \n\t  '), []);
  });
});

describe('speed on hostile input', () => {
  const hostileInputs = {
    'long run of letters': 'a'.repeat(100_000),
    'long run of letters ending in @': 'a'.repeat(100_000) + '@',
    'domain-like dots with no top-level domain': 'a@' + 'b.'.repeat(50_000),
    'many @ signs': 'a@'.repeat(50_000),
    'long run of digits': '1'.repeat(100_000),
    'digits separated by spaces': '1 '.repeat(50_000),
    'digits separated by dots': '1.'.repeat(50_000),
    'one megabyte of mixed text': 'Hello priya@example.com, call +91 98765 43210. '.repeat(20_000),
  };

  for (const [name, text] of Object.entries(hostileInputs)) {
    test(`${name} finishes quickly`, () => {
      const ms = elapsedMs(text);
      assert.ok(ms < SLOW_INPUT_LIMIT_MS, `${name} took ${ms.toFixed(0)} ms`);
    });
  }
});
