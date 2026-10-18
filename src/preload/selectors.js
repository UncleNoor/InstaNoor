'use strict';

// Everything that depends on Instagram's markup lives here, so when Instagram
// changes its site this is the one file to update.

// "Sponsored" in the languages Instagram ships, matched against short leaf text.
const SPONSORED_LABELS = new Set([
  'Sponsored', 'Gesponsert', 'Sponsorisé', 'Sponsorizzato', 'Patrocinado', 'Patrocinada',
  'Gesponsord', 'Sponsorowane', 'Sponzorováno', 'Реклама', 'Sponsorlu', 'Sponset', 'Sponsrad',
  'Sponsoreret', 'Sponsoroitu', 'Χορηγούμενη', 'Hirdetés', 'Sponsorizat', 'Спонзорисано',
  '広告', '광고', '赞助内容', '贊助', 'ممول', 'מודעה', 'प्रायोजित', 'ได้รับการสนับสนุน',
  'Bersponsor', 'Disponsori', 'Được tài trợ', 'Naka-sponsor', 'Ad',
]);

const SUGGESTED_LABELS = new Set([
  'Suggested for you', 'Suggested posts', 'Suggested reels', 'Suggested threads',
  'Vorschläge für dich', 'Suggestions pour vous', 'Sugerencias para ti', 'Suggeriti per te',
  'Sugestões para você', 'Voorgesteld voor jou', 'Рекомендации для вас', 'Senin için önerilenler',
]);

const NAV = {
  reels: 'a[href="/reels/"], a[href^="/reels/?"]',
  explore: 'a[href="/explore/"]',
  home: 'a[href="/"]',
};

const POST = {
  article: 'main article, article[role="presentation"]',
  // Links whose href contains the post's shortcode.
  permalink: 'a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]',
  likeIcon: 'svg[aria-label="Like"], svg[aria-label="Unlike"]',
  saveIcon: 'svg[aria-label="Save"], svg[aria-label="Remove"]',
  mutedButton: '[aria-label*="Audio is muted" i], [aria-label*="Toggle audio" i]',
  storyNext: '[aria-label="Next"]',
};

const DM = {
  composer: 'div[role="textbox"][contenteditable="true"], textarea[placeholder^="Message"]',
  fileInput: 'input[type="file"]',
};

// First path segments that are not usernames.
const RESERVED_PATHS = new Set([
  '', 'direct', 'explore', 'reels', 'reel', 'p', 'tv', 'stories', 'accounts', 'notifications',
  'saved', 'about', 'legal', 'developer', 'emails', 'challenge', 'privacy', 'web', 'api', 'ar',
  'threads', 'your_activity', 'session', 'meta-verified', 'download',
]);

module.exports = { SPONSORED_LABELS, SUGGESTED_LABELS, NAV, POST, DM, RESERVED_PATHS };
