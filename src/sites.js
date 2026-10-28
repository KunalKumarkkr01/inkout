// Site rules shared by the content script, settings page and service worker.
// Exposes globalThis.InkoutSites (and module.exports for Node tests).
(function (root) {
  'use strict';

  const HOST_PATTERN = /^[a-z0-9.-]+(?::\d+)?$/;
  const MEETING_SITES = [
    { domain: 'meet.google.com', label: 'Google Meet' },
    { domain: 'teams.microsoft.com', label: 'Microsoft Teams' },
    { domain: 'teams.live.com', label: 'Microsoft Teams' },
    { domain: 'zoom.us', label: 'Zoom' },
  ];

  /**
   * Summary: turns whatever the user typed into a bare site entry.
   * Parameters: input — text such as "https://www.example.com/path".
   * Returns: the host (with port if given) in lower case, without "www."; null if no host is left.
   * Usage: normalizeSiteEntry('https://WWW.Example.com/x') → 'example.com'.
   */
  function normalizeSiteEntry(input) {
    const host = String(input)
      .trim()
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .split(/[/?#]/)[0]
      .replace(/^www\./, '');
    return HOST_PATTERN.test(host) && /[a-z0-9]/.test(host) ? host : null;
  }

  /**
   * Summary: checks whether a site entry covers a host.
   * Parameters: entry — normalized entry ("example.com" or "localhost:3000"); host — a page's location.host.
   * Returns: true for the same host or a subdomain of it. An entry with a port only matches that port.
   * Usage: matchesSite('example.com', 'mail.example.com') → true.
   */
  function matchesSite(entry, host) {
    const target = entry.includes(':') ? host : host.replace(/:\d+$/, '');
    return target === entry || target.endsWith('.' + entry);
  }

  /**
   * Summary: decides whether Inkout should hide anything on a site, from the user's site rules.
   * Parameters: settings — complete settings object; host — the tab's location.host.
   * Returns: false on never-hide sites, and on sites not chosen in "Only on sites I choose" mode.
   * Usage: if (!isSiteActive(settings, location.host)) stop hiding on this page.
   */
  function isSiteActive(settings, host) {
    if (settings.neverHideSites.some((entry) => matchesSite(entry, host))) return false;
    if (settings.siteMode === 'chosen') return settings.chosenSites.some((entry) => matchesSite(entry, host));
    return true;
  }

  /**
   * Summary: gives a friendly name for the site a screen share started on.
   * Parameters: host — the sharing tab's host.
   * Returns: "Google Meet", "Microsoft Teams" or "Zoom" for those sites, otherwise the host itself.
   * Usage: the popup banner reads "You are sharing your screen · " + meetingLabel(host).
   */
  function meetingLabel(host) {
    const site = MEETING_SITES.find(({ domain }) => matchesSite(domain, host));
    return site ? site.label : host;
  }

  const api = { normalizeSiteEntry, matchesSite, isSiteActive, meetingLabel };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.InkoutSites = api;
  }
})(globalThis);
