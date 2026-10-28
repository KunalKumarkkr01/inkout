const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSiteEntry, matchesSite, isSiteActive, meetingLabel } = require('../src/sites.js');
const { withDefaults } = require('../src/settings.js');

test.describe('normalizeSiteEntry', () => {
  test('strips scheme, www, path and query, and lower-cases', () => {
    assert.equal(normalizeSiteEntry('https://WWW.Example.com/path?q=1'), 'example.com');
  });

  test('keeps a port', () => {
    assert.equal(normalizeSiteEntry('localhost:3000'), 'localhost:3000');
  });

  test('keeps subdomains other than www', () => {
    assert.equal(normalizeSiteEntry('mail.example.com/inbox'), 'mail.example.com');
  });

  test('trims spaces', () => {
    assert.equal(normalizeSiteEntry('  example.org  '), 'example.org');
  });

  test('returns null when no host is left', () => {
    assert.equal(normalizeSiteEntry('   '), null);
    assert.equal(normalizeSiteEntry('https://'), null);
    assert.equal(normalizeSiteEntry('has spaces.com'), null);
  });
});

test.describe('matchesSite', () => {
  test('matches the same host', () => {
    assert.equal(matchesSite('example.com', 'example.com'), true);
  });

  test('matches subdomains', () => {
    assert.equal(matchesSite('example.com', 'mail.example.com'), true);
  });

  test('does not match a host that only ends with the same letters', () => {
    assert.equal(matchesSite('example.com', 'notexample.com'), false);
  });

  test('an entry with a port only matches that port', () => {
    assert.equal(matchesSite('localhost:3000', 'localhost:4000'), false);
    assert.equal(matchesSite('localhost:3000', 'localhost:3000'), true);
  });

  test('an entry without a port matches any port', () => {
    assert.equal(matchesSite('localhost', 'localhost:4000'), true);
  });
});

test.describe('isSiteActive', () => {
  test('active everywhere by default', () => {
    assert.equal(isSiteActive(withDefaults(undefined), 'example.com'), true);
  });

  test('the never-hide list wins', () => {
    const settings = withDefaults({ siteMode: 'chosen', chosenSites: ['example.com'], neverHideSites: ['example.com'] });
    assert.equal(isSiteActive(settings, 'mail.example.com'), false);
  });

  test('chosen mode leaves out sites that are not chosen', () => {
    const settings = withDefaults({ siteMode: 'chosen', chosenSites: ['example.com'] });
    assert.equal(isSiteActive(settings, 'example.org'), false);
  });

  test('chosen mode includes chosen sites', () => {
    const settings = withDefaults({ siteMode: 'chosen', chosenSites: ['example.com'] });
    assert.equal(isSiteActive(settings, 'mail.example.com'), true);
  });
});

test.describe('meetingLabel', () => {
  test('names the common meeting sites', () => {
    assert.equal(meetingLabel('meet.google.com'), 'Google Meet');
    assert.equal(meetingLabel('teams.microsoft.com'), 'Microsoft Teams');
    assert.equal(meetingLabel('teams.live.com'), 'Microsoft Teams');
    assert.equal(meetingLabel('zoom.us'), 'Zoom');
    assert.equal(meetingLabel('us02web.zoom.us'), 'Zoom');
  });

  test('falls back to the host', () => {
    assert.equal(meetingLabel('example.org'), 'example.org');
  });
});
