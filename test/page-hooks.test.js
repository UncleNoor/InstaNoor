'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  isAdNode, scrubAds, extractMedia, classifySeenRequest, parseIgBody, serializeIgBody, processIgBody, buildPageScript,
} = require('../src/shared/page-hooks');

const organic = (pk) => ({ node: { media: { pk, code: `C${pk}`, ad: null, image_versions2: { candidates: [{ url: `https://cdn/${pk}.jpg`, width: 1080, height: 1080 }] } } } });

test('isAdNode recognises the ad shapes Instagram uses', () => {
  assert.ok(isAdNode({ ad_id: '123' }));
  assert.ok(isAdNode({ media: { ad_id: 987 } }));
  assert.ok(isAdNode({ node: { ad: { ad_id: '1', tracking_token: 'x' } } }));
  assert.ok(isAdNode({ injected: { label: 'Sponsored' } }));
  assert.ok(isAdNode({ media_or_ad: { is_ad: true } }));
  assert.ok(isAdNode({ __typename: 'XDTSponsoredItem' }));
});

test('isAdNode leaves organic posts alone', () => {
  assert.ok(!isAdNode(organic(1)));
  assert.ok(!isAdNode({ ad_id: null, injected: null, ad: {} }));
  assert.ok(!isAdNode({ is_paid_partnership: true, pk: '5' }));
  assert.ok(!isAdNode({ __typename: 'XDTMediaDict' }));
  assert.ok(!isAdNode(null));
  assert.ok(!isAdNode([1, 2]));
});

test('scrubAds removes ads from nested feed arrays only', () => {
  const feed = {
    data: {
      xdt_api__v1__feed__timeline__connection: {
        edges: [organic(1), { node: { ad: { id: 'a1' }, media: null } }, organic(2), { node: { media: { ad_id: 'x' } } }],
      },
    },
    reels: { items: [{ media: { pk: 3 } }, { media: { pk: 4, ad_id: 'ad' } }] },
  };
  assert.strictEqual(scrubAds(feed), 3);
  assert.deepStrictEqual(feed.data.xdt_api__v1__feed__timeline__connection.edges.map((e) => e.node.media.pk), [1, 2]);
  assert.deepStrictEqual(feed.reels.items.map((i) => i.media.pk), [3]);
});

test('extractMedia finds posts, carousels, videos and HD profile pictures', () => {
  const json = {
    items: [
      { pk: '11', code: 'AAA', user: { username: 'alice' }, image_versions2: { candidates: [{ url: 'small', width: 150, height: 150 }, { url: 'big', width: 1440, height: 1800 }] } },
      { id: '22_999', code: 'BBB', user: { username: 'bob' }, video_versions: [{ url: 'v-low', width: 480, height: 852 }, { url: 'v-hd', width: 1080, height: 1920 }], image_versions2: { candidates: [{ url: 'thumb' }] } },
      { pk: '33', code: 'CCC', image_versions2: { candidates: [{ url: 'cover' }] }, carousel_media: [
        { pk: '331', image_versions2: { candidates: [{ url: 'c1', width: 1, height: 1 }] } },
        { pk: '332', video_versions: [{ url: 'c2', width: 1, height: 1 }] },
      ] },
    ],
    user: { username: 'carol', hd_profile_pic_url_info: { url: 'carol-hd' } },
  };
  const { media, profiles } = extractMedia(json);
  const byCode = Object.fromEntries(media.map((m) => [m.code, m]));
  assert.deepStrictEqual(byCode.AAA.items, [{ url: 'big', isVideo: false }]);
  assert.strictEqual(byCode.AAA.username, 'alice');
  assert.strictEqual(byCode.BBB.pk, '22');
  assert.deepStrictEqual(byCode.BBB.items, [{ url: 'v-hd', isVideo: true }]);
  assert.deepStrictEqual(byCode.CCC.items, [{ url: 'c1', isVideo: false }, { url: 'c2', isVideo: true }]);
  assert.deepStrictEqual(profiles, [{ username: 'carol', url: 'carol-hd' }]);
});

test('classifySeenRequest only blocks what the user turned on', () => {
  const story = 'https://www.instagram.com/api/graphql\nfb_api_req_friendly_name=PolarisAPIReelSeenMutation&variables=%7B%7D';
  const dm = 'https://www.instagram.com/api/graphql\nfb_api_req_friendly_name=IGDMarkThreadReadMutation';
  const like = 'https://www.instagram.com/api/graphql\nfb_api_req_friendly_name=usePolarisLikeMediaLikeMutation';
  assert.strictEqual(classifySeenRequest(story, { anonymousStories: true }), 'story');
  assert.strictEqual(classifySeenRequest(story, { anonymousStories: false }), null);
  assert.strictEqual(classifySeenRequest('https://i.instagram.com/api/v1/stories/reel/seen', { anonymousStories: true }), 'story');
  assert.strictEqual(classifySeenRequest(dm, { blockDmSeen: true }), 'dm');
  assert.strictEqual(classifySeenRequest(dm, { anonymousStories: true }), null);
  assert.strictEqual(classifySeenRequest(like, { anonymousStories: true, blockDmSeen: true }), null);
});

test('parseIgBody handles the for(;;) prefix and multi-part bodies', () => {
  const single = parseIgBody('for (;;);{"a":1}');
  assert.strictEqual(single.prefix, 'for (;;);');
  assert.strictEqual(serializeIgBody(single), 'for (;;);{"a":1}');
  const multi = parseIgBody('{"a":1}\r\n{"b":2}\r\n');
  assert.deepStrictEqual(multi.parts, [{ a: 1 }, { b: 2 }, null]);
  assert.strictEqual(serializeIgBody(multi), '{"a":1}\r\n{"b":2}\r\n');
  assert.strictEqual(parseIgBody('<html>'), null);
});

test('processIgBody rewrites only when it removed something', () => {
  const reports = [];
  const report = (m) => reports.push(m);
  const clean = JSON.stringify({ items: [organic(1).node.media] });
  assert.strictEqual(processIgBody(clean, { blockAds: true }, report), null);
  assert.ok(reports.some((r) => r.type === 'media' && r.media[0].pk === '1'));

  const withAd = JSON.stringify({ items: [organic(1).node.media, { pk: 2, ad_id: 'x' }] });
  const out = processIgBody(withAd, { blockAds: true }, report);
  assert.deepStrictEqual(JSON.parse(out).items.map((i) => i.pk), [1]);
  assert.ok(reports.some((r) => r.type === 'stat' && r.ads === 1));
  assert.strictEqual(processIgBody(withAd, { blockAds: false }, report), null);
});

test('buildPageScript produces valid, self-contained JavaScript', () => {
  const src = buildPageScript({ blockAds: true, anonymousStories: false, blockDmSeen: false });
  assert.doesNotThrow(() => new Function(src));
});
