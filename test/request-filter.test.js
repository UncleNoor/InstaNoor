'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { blockReason } = require('../src/main/request-filter');

const all = { blockTracking: true, anonymousStories: true };

test('blocks trackers when enabled', () => {
  assert.strictEqual(blockReason('https://www.instagram.com/ajax/bz', all), 'tracking');
  assert.strictEqual(blockReason('https://graph.instagram.com/logging_client_events', all), 'tracking');
  assert.strictEqual(blockReason('https://connect.facebook.net/en_US/fbevents.js', all), 'tracking');
  assert.strictEqual(blockReason('https://www.instagram.com/ajax/bz', { blockTracking: false }), null);
});

test('blocks story "seen" calls only in anonymous mode', () => {
  assert.strictEqual(blockReason('https://i.instagram.com/api/v1/stories/reel/seen/', all), 'story-seen');
  assert.strictEqual(blockReason('https://i.instagram.com/api/v1/stories/reel/seen/', { anonymousStories: false }), null);
});

test('never blocks the site itself', () => {
  for (const url of [
    'https://www.instagram.com/',
    'https://www.instagram.com/api/graphql',
    'https://www.instagram.com/api/v1/feed/timeline/',
    'https://scontent.cdninstagram.com/v/t51/abc.jpg',
    'https://static.cdninstagram.com/rsrc.php/v3/x.js',
  ]) assert.strictEqual(blockReason(url, all), null, url);
});
