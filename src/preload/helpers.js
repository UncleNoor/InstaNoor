'use strict';

const { RESERVED_PATHS } = require('./selectors');

const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// Converts a post shortcode (instagram.com/p/<code>/) to its numeric media id.
// Codes of private posts are longer; the media id is in the first 11 characters.
function shortcodeToPk(code) {
  if (typeof code !== 'string' || !code) return null;
  let n = 0n;
  for (const ch of code.slice(0, 11)) {
    const i = SHORTCODE_ALPHABET.indexOf(ch);
    if (i < 0) return null;
    n = n * 64n + BigInt(i);
  }
  return n.toString();
}

// Works out what the current URL points at.
function parseIgPath(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  const [a, b, c] = parts;
  if ((a === 'p' || a === 'reel' || a === 'reels' || a === 'tv') && b) return { kind: 'post', code: b };
  if (a && (b === 'p' || b === 'reel') && c) return { kind: 'post', code: c, username: a };
  if (a === 'stories' && b && b !== 'highlights') return { kind: 'story', username: b, pk: c && /^\d+$/.test(c) ? c : null };
  if (a === 'stories' && b === 'highlights') return { kind: 'story', pk: parts[3] && /^\d+$/.test(parts[3]) ? parts[3] : null };
  if (a === 'direct' && b === 't') return { kind: 'dm-thread' };
  if (a === 'direct') return { kind: 'dm' };
  if (a === 'reels' && !b) return { kind: 'reels-feed' };
  if (a === 'explore' && !b) return { kind: 'explore' };
  if (!a) return { kind: 'home' };
  if (!RESERVED_PATHS.has(a) && /^[\w.]{1,30}$/.test(a)) return { kind: 'profile', username: a };
  return { kind: 'other' };
}

// True when an <input accept="..."> takes the given MIME type.
function acceptsType(accept, mime) {
  if (!accept) return true;
  return accept.split(',').map((s) => s.trim().toLowerCase()).some((a) => {
    if (a === mime) return true;
    if (a.endsWith('/*')) return mime.startsWith(a.slice(0, -1));
    return false;
  });
}

function fileBaseName(media, index) {
  const who = (media.username || 'instagram').replace(/[^\w.]/g, '');
  const id = media.code || media.pk || Date.now();
  return `${who}_${id}${media.items.length > 1 ? `_${index + 1}` : ''}`;
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

module.exports = { shortcodeToPk, parseIgPath, acceptsType, fileBaseName, formatDuration };
