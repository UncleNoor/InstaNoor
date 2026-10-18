'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { searchGifs, giphyUrl, klipyUrl, normalizeGiphy, normalizeKlipy } = require('../src/main/gif-providers');

test('builds GIPHY search and trending URLs', () => {
  const s = new URL(giphyUrl({ key: 'K', query: 'cat', offset: 24, rating: 'g' }));
  assert.strictEqual(s.pathname, '/v1/gifs/search');
  assert.strictEqual(s.searchParams.get('q'), 'cat');
  assert.strictEqual(s.searchParams.get('offset'), '24');
  assert.strictEqual(new URL(giphyUrl({ key: 'K', query: '' })).pathname, '/v1/gifs/trending');
});

test('builds KLIPY URLs with the key in the path', () => {
  const u = new URL(klipyUrl({ key: 'abc', query: 'dog', page: 2, customerId: 'u1' }));
  assert.strictEqual(u.pathname, '/api/v1/abc/gifs/search');
  assert.strictEqual(u.searchParams.get('page'), '2');
  assert.strictEqual(u.searchParams.get('customer_id'), 'u1');
  assert.strictEqual(new URL(klipyUrl({ key: 'abc' })).pathname, '/api/v1/abc/gifs/trending');
});

test('normalizes GIPHY results and pagination', () => {
  const json = {
    data: [{ id: 'x1', title: 'Cat', url: 'https://giphy.com/gifs/x1', images: {
      fixed_width: { url: 'https://p/x1.gif', webp: 'https://p/x1.webp', width: '200', height: '150' },
      original: { url: 'https://o/x1.gif', mp4: 'https://o/x1.mp4' },
    } }, { id: 'broken', images: {} }],
    pagination: { total_count: 100, count: 2, offset: 0 },
  };
  const r = normalizeGiphy(json, 0);
  assert.strictEqual(r.results.length, 1);
  assert.deepStrictEqual(r.results[0], {
    id: 'giphy:x1', title: 'Cat', preview: 'https://p/x1.webp', gif: 'https://o/x1.gif', mp4: 'https://o/x1.mp4',
    page: 'https://giphy.com/gifs/x1', width: 200, height: 150,
  });
  assert.strictEqual(r.next, 2);
  assert.strictEqual(normalizeGiphy({ data: [], pagination: { total_count: 0 } }).next, null);
});

test('normalizes KLIPY results and pagination', () => {
  const json = { result: true, data: { data: [{ id: 7, slug: 'happy-dance', title: 'Dance', type: 'gif', file: {
    hd: { gif: { url: 'https://k/hd.gif' }, mp4: { url: 'https://k/hd.mp4' } },
    sm: { gif: { url: 'https://k/sm.gif', width: 220, height: 180 }, webp: { url: 'https://k/sm.webp' } },
  } }, { id: 8, type: 'ad' }], current_page: 1, per_page: 24, has_next: true } };
  const r = normalizeKlipy(json, 1);
  assert.strictEqual(r.results.length, 1);
  assert.strictEqual(r.results[0].preview, 'https://k/sm.webp');
  assert.strictEqual(r.results[0].gif, 'https://k/hd.gif');
  assert.strictEqual(r.results[0].mp4, 'https://k/hd.mp4');
  assert.strictEqual(r.results[0].page, 'https://klipy.com/gifs/happy-dance');
  assert.strictEqual(r.next, 2);
});

test('searchGifs asks for a key when none is set', async () => {
  await assert.rejects(searchGifs(async () => {}, { gifProvider: 'giphy', giphyKey: '' }, { query: 'x' }), /GIPHY API key/);
  await assert.rejects(searchGifs(async () => {}, { gifProvider: 'klipy', klipyKey: '' }, { query: 'x' }), /KLIPY API key/);
});

test('searchGifs calls the provider and reports HTTP errors', async () => {
  let called;
  const ok = async (url) => { called = url; return { ok: true, json: async () => ({ data: [], pagination: {} }) }; };
  await searchGifs(ok, { gifProvider: 'giphy', giphyKey: 'K', gifRating: 'g' }, { query: ' hi ' });
  assert.match(called, /q=hi/);
  const bad = async () => ({ ok: false, status: 403 });
  await assert.rejects(searchGifs(bad, { gifProvider: 'giphy', giphyKey: 'K' }, {}), /403/);
});
