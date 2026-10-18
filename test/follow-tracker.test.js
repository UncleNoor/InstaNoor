'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { diffSnapshots, scanFollowLists, listUrl } = require('../src/main/follow-tracker');

const u = (pk) => ({ pk: String(pk), username: `user${pk}`, fullName: '', pic: '', verified: false });

test('diffSnapshots finds non-followers, fans, unfollowers and new followers', () => {
  const prev = { takenAt: 1, followers: [u(1), u(2), u(3)], following: [] };
  const cur = { takenAt: 2, followers: [u(1), u(3), u(4)], following: [u(1), u(5)] };
  const d = diffSnapshots(cur, prev);
  assert.deepStrictEqual(d.notFollowingBack.map((x) => x.pk), ['5']);
  assert.deepStrictEqual(d.fans.map((x) => x.pk), ['3', '4']);
  assert.deepStrictEqual(d.unfollowedYou.map((x) => x.pk), ['2']);
  assert.deepStrictEqual(d.newFollowers.map((x) => x.pk), ['4']);
  assert.strictEqual(d.previousScanAt, 1);
  assert.deepStrictEqual(diffSnapshots(cur, null).unfollowedYou, []);
});

test('listUrl paginates with max_id', () => {
  const url = new URL(listUrl('42', 'followers', 'QVFC'));
  assert.strictEqual(url.pathname, '/api/v1/friendships/42/followers/');
  assert.strictEqual(url.searchParams.get('max_id'), 'QVFC');
});

test('scanFollowLists pages through both lists and retries on rate limits', async () => {
  const pages = {
    following: [{ users: [{ pk: 1, username: 'a' }], next_max_id: 'n1' }, { users: [{ pk: 2, username: 'b' }] }],
    followers: [{ users: [{ pk: 3, username: 'c' }] }],
  };
  const calls = { following: 0, followers: 0 };
  let limited = false;
  const fetchPage = async (url) => {
    const kind = /\/following\//.test(url) ? 'following' : 'followers';
    if (kind === 'followers' && !limited) { limited = true; return { status: 429, body: '' }; }
    return { status: 200, body: JSON.stringify(pages[kind][calls[kind]++]) };
  };
  const progress = [];
  const snap = await scanFollowLists('42', { fetchPage, onProgress: (p) => progress.push(p), isCancelled: () => false, delay: async () => {} });
  assert.deepStrictEqual(snap.following.map((x) => x.username), ['a', 'b']);
  assert.deepStrictEqual(snap.followers.map((x) => x.username), ['c']);
  assert.ok(progress.some((p) => p.waiting));
});

test('scanFollowLists stops when cancelled', async () => {
  await assert.rejects(scanFollowLists('1', { fetchPage: async () => ({}), onProgress() {}, isCancelled: () => true, delay: async () => {} }), /cancelled/);
});
