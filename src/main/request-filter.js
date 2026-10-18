'use strict';

// Network-level blocking, applied by the main process to every request the
// Instagram window makes. Page-level hooks (src/shared/page-hooks.js) handle the
// cases that need to look inside request bodies.

const TRACKING_PATTERNS = [
  /^https:\/\/www\.instagram\.com\/ajax\/bz/,
  /^https:\/\/www\.instagram\.com\/logging\//,
  /^https:\/\/www\.instagram\.com\/api\/v1\/web\/(logging|log_)/,
  /^https:\/\/graph\.instagram\.com\/logging_client_events/,
  /^https:\/\/(www\.)?facebook\.com\/(tr|security\/hsts-pixel)/,
  /^https:\/\/connect\.facebook\.net\//,
  /^https:\/\/[^/]*\.doubleclick\.net\//,
  /^https:\/\/[^/]*google-analytics\.com\//,
];

const STORY_SEEN_PATTERNS = [
  /^https:\/\/[^/]*instagram\.com\/api\/v1\/stories\/reel\/seen/,
  /^https:\/\/[^/]*instagram\.com\/api\/v1\/media\/seen/,
];

// Returns a short reason string when the request should be cancelled, else null.
function blockReason(url, settings) {
  if (typeof url !== 'string') return null;
  if (settings.blockTracking && TRACKING_PATTERNS.some((re) => re.test(url))) return 'tracking';
  if (settings.anonymousStories && STORY_SEEN_PATTERNS.some((re) => re.test(url))) return 'story-seen';
  return null;
}

module.exports = { blockReason, TRACKING_PATTERNS, STORY_SEEN_PATTERNS };
