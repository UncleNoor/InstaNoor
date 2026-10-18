'use strict';

// GIF search for the DM GIF picker. Tenor's public API shut down on
// 30 June 2026, so GIPHY and KLIPY are supported. Both need a free API key.

const PER_PAGE = 24;

function giphyUrl({ key, query, offset = 0, rating = 'pg-13' }) {
  const base = query ? 'https://api.giphy.com/v1/gifs/search' : 'https://api.giphy.com/v1/gifs/trending';
  const p = new URLSearchParams({ api_key: key, limit: String(PER_PAGE), offset: String(offset), rating, bundle: 'messaging_non_clips' });
  if (query) p.set('q', query);
  return `${base}?${p}`;
}

function normalizeGiphy(json, offset = 0) {
  const data = Array.isArray(json && json.data) ? json.data : [];
  const results = data.map((g) => {
    const im = g.images || {};
    return {
      id: `giphy:${g.id}`,
      title: g.title || '',
      preview: (im.fixed_width && (im.fixed_width.webp || im.fixed_width.url)) || (im.downsized && im.downsized.url) || null,
      gif: (im.original && im.original.url) || (im.downsized && im.downsized.url) || null,
      mp4: (im.original_mp4 && im.original_mp4.mp4) || (im.original && im.original.mp4) || null,
      page: g.url || null,
      width: Number((im.fixed_width && im.fixed_width.width) || 200),
      height: Number((im.fixed_width && im.fixed_width.height) || 200),
    };
  }).filter((r) => r.preview && (r.gif || r.mp4));
  const pg = (json && json.pagination) || {};
  const total = Number(pg.total_count || 0);
  const next = offset + data.length;
  return { results, next: data.length && next < total ? next : null };
}

function klipyUrl({ key, query, page = 1, rating = 'pg-13', customerId }) {
  const kind = query ? 'search' : 'trending';
  const p = new URLSearchParams({ per_page: String(PER_PAGE), page: String(page), rating });
  if (query) p.set('q', query);
  if (customerId) p.set('customer_id', customerId);
  return `https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/${kind}?${p}`;
}

// KLIPY returns renditions per size (hd/md/sm/xs), each with gif/webp/mp4 files.
function klipyPick(files, sizes, format) {
  if (!files) return null;
  for (const s of sizes) {
    const f = files[s] && files[s][format];
    if (f && (f.url || typeof f === 'string')) return f.url || f;
  }
  return null;
}

function normalizeKlipy(json, page = 1) {
  const outer = (json && json.data) || {};
  const data = Array.isArray(outer.data) ? outer.data : Array.isArray(outer) ? outer : [];
  const results = data.filter((g) => !g.type || g.type === 'gif').map((g) => {
    const files = g.file || g.files || {};
    const sm = files.sm || files.xs || files.md || {};
    const smGif = sm.gif || sm.webp || {};
    return {
      id: `klipy:${g.id || g.slug}`,
      title: g.title || '',
      preview: klipyPick(files, ['sm', 'xs', 'md'], 'webp') || klipyPick(files, ['sm', 'xs', 'md'], 'gif'),
      gif: klipyPick(files, ['hd', 'md', 'sm'], 'gif'),
      mp4: klipyPick(files, ['hd', 'md', 'sm'], 'mp4'),
      page: g.slug ? `https://klipy.com/gifs/${g.slug}` : null,
      width: Number(smGif.width || 200),
      height: Number(smGif.height || 200),
    };
  }).filter((r) => r.preview && (r.gif || r.mp4));
  return { results, next: outer.has_next ? page + 1 : null };
}

// Searches the configured provider. `cursor` is opaque to the caller.
async function searchGifs(fetchImpl, settings, { query, cursor, customerId }) {
  const q = (query || '').trim();
  const rating = settings.gifRating || 'pg-13';
  if (settings.gifProvider === 'klipy') {
    if (!settings.klipyKey) throw new Error('Add your free KLIPY API key in Settings → Chat & GIFs.');
    const page = cursor || 1;
    const res = await fetchImpl(klipyUrl({ key: settings.klipyKey, query: q, page, rating, customerId }));
    if (!res.ok) throw new Error(`KLIPY returned ${res.status}. Check your API key.`);
    return normalizeKlipy(await res.json(), page);
  }
  if (!settings.giphyKey) throw new Error('Add your free GIPHY API key in Settings → Chat & GIFs.');
  const offset = cursor || 0;
  const res = await fetchImpl(giphyUrl({ key: settings.giphyKey, query: q, offset, rating }));
  if (!res.ok) throw new Error(`GIPHY returned ${res.status}. Check your API key.`);
  return normalizeGiphy(await res.json(), offset);
}

module.exports = { searchGifs, giphyUrl, klipyUrl, normalizeGiphy, normalizeKlipy };
