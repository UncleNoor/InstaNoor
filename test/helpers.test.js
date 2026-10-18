'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { shortcodeToPk, parseIgPath, acceptsType, fileBaseName, formatDuration } = require('../src/preload/helpers');
const { normalizeSettings, DEFAULTS, SCHEMA } = require('../src/shared/settings-schema');

test('shortcodeToPk decodes Instagram shortcodes', () => {
  // instagram.com/p/B/ is media 1; "BA" is 64.
  assert.strictEqual(shortcodeToPk('B'), '1');
  assert.strictEqual(shortcodeToPk('BA'), '64');
  assert.strictEqual(shortcodeToPk('CVdGbxQIkNE'), shortcodeToPk('CVdGbxQIkNEsomeprivatetail'));
  assert.strictEqual(shortcodeToPk('bad!'), null);
});

test('parseIgPath classifies Instagram URLs', () => {
  assert.deepStrictEqual(parseIgPath('/'), { kind: 'home' });
  assert.deepStrictEqual(parseIgPath('/p/ABC/'), { kind: 'post', code: 'ABC' });
  assert.deepStrictEqual(parseIgPath('/reel/XYZ/'), { kind: 'post', code: 'XYZ' });
  assert.deepStrictEqual(parseIgPath('/reels/XYZ/'), { kind: 'post', code: 'XYZ' });
  assert.deepStrictEqual(parseIgPath('/reels/'), { kind: 'reels-feed' });
  assert.deepStrictEqual(parseIgPath('/natgeo/p/ABC/'), { kind: 'post', code: 'ABC', username: 'natgeo' });
  assert.deepStrictEqual(parseIgPath('/stories/natgeo/3456/'), { kind: 'story', username: 'natgeo', pk: '3456' });
  assert.deepStrictEqual(parseIgPath('/stories/highlights/1789/'), { kind: 'story', pk: null });
  assert.deepStrictEqual(parseIgPath('/direct/t/1234/'), { kind: 'dm-thread' });
  assert.deepStrictEqual(parseIgPath('/direct/inbox/'), { kind: 'dm' });
  assert.deepStrictEqual(parseIgPath('/explore/'), { kind: 'explore' });
  assert.deepStrictEqual(parseIgPath('/explore/tags/cats/'), { kind: 'other' });
  assert.deepStrictEqual(parseIgPath('/natgeo/'), { kind: 'profile', username: 'natgeo' });
  assert.deepStrictEqual(parseIgPath('/accounts/edit/'), { kind: 'other' });
});

test('acceptsType matches input accept lists', () => {
  assert.ok(acceptsType('image/jpeg,image/png,video/mp4,video/quicktime', 'video/mp4'));
  assert.ok(acceptsType('image/*, video/*', 'image/gif'));
  assert.ok(!acceptsType('image/jpeg,image/png', 'video/mp4'));
  assert.ok(acceptsType('', 'video/mp4'));
});

test('fileBaseName and formatDuration', () => {
  assert.strictEqual(fileBaseName({ username: 'a.b', code: 'X', items: [{}] }, 0), 'a.b_X');
  assert.strictEqual(fileBaseName({ username: null, pk: '9', items: [{}, {}] }, 1), 'instagram_9_2');
  assert.strictEqual(formatDuration(65), '1m 05s');
  assert.strictEqual(formatDuration(3720), '1h 02m');
});

test('normalizeSettings fills defaults and rejects bad values', () => {
  assert.deepStrictEqual(normalizeSettings(undefined), DEFAULTS);
  const s = normalizeSettings({ blockAds: 'yes', feedMode: 'nonsense', dailyLimitMinutes: '45', breakReminderMinutes: -5, theme: 'amoled', junk: 1 });
  assert.strictEqual(s.blockAds, true);
  assert.strictEqual(s.feedMode, 'following');
  assert.strictEqual(s.dailyLimitMinutes, 45);
  assert.strictEqual(s.breakReminderMinutes, 0);
  assert.strictEqual(s.theme, 'amoled');
  assert.ok(!('junk' in s));
  assert.strictEqual(new Set(SCHEMA.map((x) => x.key)).size, SCHEMA.length);
});
