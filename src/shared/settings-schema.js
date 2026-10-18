'use strict';

// Single source of truth for every user setting. The settings window renders
// itself from this list, and the main process uses it to fill in defaults.
const SCHEMA = [
  // Ad blocking & privacy
  { key: 'blockAds', group: 'Ad blocking & privacy', type: 'boolean', default: true,
    label: 'Block ads', help: 'Removes sponsored posts, story ads and reel ads.' },
  { key: 'hideSuggested', group: 'Ad blocking & privacy', type: 'boolean', default: true,
    label: 'Hide "Suggested for you"', help: 'Hides suggested posts, accounts and Threads promos.' },
  { key: 'blockTracking', group: 'Ad blocking & privacy', type: 'boolean', default: true,
    label: 'Block trackers', help: 'Blocks Meta logging and analytics requests.' },
  { key: 'anonymousStories', group: 'Ad blocking & privacy', type: 'boolean', default: false,
    label: 'View stories anonymously', help: 'Stops Instagram from telling people you watched their story.' },
  { key: 'blockDmSeen', group: 'Ad blocking & privacy', type: 'boolean', default: false,
    label: 'Hide "Seen" in DMs (experimental)', help: 'Best effort. For a reliable result also turn off Read receipts in Instagram settings.' },

  // Feed
  { key: 'feedMode', group: 'Feed', type: 'select', default: 'following',
    label: 'Home feed', help: 'Following shows newest posts first from accounts you follow.',
    options: [['following', 'Following (chronological)'], ['favorites', 'Favorites only'], ['default', 'Instagram default']] },
  { key: 'hideReels', group: 'Feed', type: 'boolean', default: false,
    label: 'Hide Reels', help: 'Removes the Reels tab and blocks the Reels feed. Reels sent to you in DMs still open.' },
  { key: 'hideExplore', group: 'Feed', type: 'boolean', default: false,
    label: 'Hide Explore', help: 'Removes the Explore tab and blocks the Explore page.' },
  { key: 'hideStoriesTray', group: 'Feed', type: 'boolean', default: false,
    label: 'Hide stories bar', help: 'Hides the row of stories at the top of the home feed.' },
  { key: 'autoUnmute', group: 'Feed', type: 'boolean', default: false,
    label: 'Play videos with sound', help: 'Unmutes videos automatically.' },

  // Focus
  { key: 'showTimer', group: 'Focus', type: 'boolean', default: false,
    label: 'Show time spent today', help: 'Shows a small timer in the corner.' },
  { key: 'dailyLimitMinutes', group: 'Focus', type: 'number', default: 0, min: 0, max: 1440,
    label: 'Daily limit (minutes)', help: '0 = no limit. When you reach it, a screen asks you to take a break.' },
  { key: 'breakReminderMinutes', group: 'Focus', type: 'number', default: 0, min: 0, max: 600,
    label: 'Break reminder every (minutes)', help: '0 = off.' },

  // Downloads
  { key: 'downloadButtons', group: 'Downloads', type: 'boolean', default: true,
    label: 'Show download buttons', help: 'Download photos, videos, reels, stories and profile pictures.' },
  { key: 'downloadFolder', group: 'Downloads', type: 'folder', default: '',
    label: 'Download folder', help: 'Empty = Downloads/InstaNoor.' },

  // Chat
  { key: 'gifProvider', group: 'Chat & GIFs', type: 'select', default: 'giphy',
    label: 'GIF provider', options: [['giphy', 'GIPHY'], ['klipy', 'KLIPY']] },
  { key: 'giphyKey', group: 'Chat & GIFs', type: 'text', default: '',
    label: 'GIPHY API key', help: 'Free from developers.giphy.com → Create an App → API.' },
  { key: 'klipyKey', group: 'Chat & GIFs', type: 'text', default: '',
    label: 'KLIPY API key', help: 'Free from partner.klipy.com.' },
  { key: 'gifFormat', group: 'Chat & GIFs', type: 'select', default: 'mp4',
    label: 'Send GIFs as', help: 'Instagram only animates GIFs sent as video. Pick "Link" if uploads fail.',
    options: [['mp4', 'Looping video (animated)'], ['gif', 'GIF file'], ['link', 'Link']] },
  { key: 'gifRating', group: 'Chat & GIFs', type: 'select', default: 'pg-13',
    label: 'GIF content rating', options: [['g', 'G'], ['pg', 'PG'], ['pg-13', 'PG-13'], ['r', 'R']] },

  // Appearance
  { key: 'theme', group: 'Appearance', type: 'select', default: 'default',
    label: 'Theme', options: [['default', 'Instagram default'], ['amoled', 'AMOLED black'], ['midnight', 'Midnight blue'], ['sepia', 'Sepia']] },
  { key: 'wideLayout', group: 'Appearance', type: 'boolean', default: false,
    label: 'Wide feed', help: 'Uses more of the window for posts.' },
  { key: 'keyboardShortcuts', group: 'Appearance', type: 'boolean', default: true,
    label: 'Keyboard shortcuts', help: 'Press ? in the app to see them.' },
  { key: 'customCss', group: 'Appearance', type: 'textarea', default: '',
    label: 'Custom CSS', help: 'Advanced: CSS added to every Instagram page.' },
];

const DEFAULTS = Object.freeze(Object.fromEntries(SCHEMA.map((s) => [s.key, s.default])));

// Coerce a raw settings object into a valid one, dropping unknown keys and
// replacing values of the wrong type with defaults.
function normalizeSettings(raw) {
  const out = {};
  const src = raw && typeof raw === 'object' ? raw : {};
  for (const s of SCHEMA) {
    let v = src[s.key];
    switch (s.type) {
      case 'boolean':
        v = typeof v === 'boolean' ? v : s.default;
        break;
      case 'number':
        v = Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : s.default;
        if (s.min !== undefined) v = Math.max(s.min, v);
        if (s.max !== undefined) v = Math.min(s.max, v);
        break;
      case 'select':
        v = s.options.some(([val]) => val === v) ? v : s.default;
        break;
      default:
        v = typeof v === 'string' ? v : s.default;
    }
    out[s.key] = v;
  }
  return out;
}

module.exports = { SCHEMA, DEFAULTS, normalizeSettings };
