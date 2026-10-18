'use strict';

// "Who unfollowed me" / "Who doesn't follow me back". Pages through your own
// followers and following lists using the logged-in Instagram web session, slowly,
// then compares against the previous scan.

const IG_APP_ID = '936619743392459';
const PAGE_SIZE = 50;

function slimUser(u) {
  return {
    pk: String(u.pk || u.id),
    username: u.username,
    fullName: u.full_name || '',
    pic: u.profile_pic_url || '',
    verified: !!u.is_verified,
  };
}

// Compares the current scan with the previous one.
function diffSnapshots(cur, prev) {
  const byPk = (list) => new Map(list.map((u) => [u.pk, u]));
  const followers = byPk(cur.followers);
  const following = byPk(cur.following);
  const result = {
    notFollowingBack: cur.following.filter((u) => !followers.has(u.pk)),
    fans: cur.followers.filter((u) => !following.has(u.pk)),
    unfollowedYou: [],
    newFollowers: [],
    previousScanAt: prev ? prev.takenAt : null,
  };
  if (prev) {
    const prevFollowers = byPk(prev.followers);
    result.unfollowedYou = prev.followers.filter((u) => !followers.has(u.pk));
    result.newFollowers = cur.followers.filter((u) => !prevFollowers.has(u.pk));
  }
  return result;
}

// Source of a snippet that runs inside the Instagram page and fetches one page
// of a follow list with the page's own cookies.
function pageFetchSnippet(url) {
  return `(async () => {
    const csrf = (document.cookie.match(/(?:^|; )csrftoken=([^;]+)/) || [])[1] || '';
    const r = await fetch(${JSON.stringify(url)}, {
      credentials: 'include',
      headers: { 'X-IG-App-ID': '${IG_APP_ID}', 'X-CSRFToken': csrf, 'X-Requested-With': 'XMLHttpRequest' },
    });
    return { status: r.status, body: await r.text() };
  })()`;
}

function listUrl(userId, kind, maxId) {
  const p = new URLSearchParams({ count: String(PAGE_SIZE) });
  if (kind === 'followers') p.set('search_surface', 'follow_list_page');
  if (maxId) p.set('max_id', maxId);
  return `https://www.instagram.com/api/v1/friendships/${encodeURIComponent(userId)}/${kind}/?${p}`;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// fetchPage(url) -> Promise<{status, body}> using the Instagram session's cookies;
// onProgress({kind, count}); isCancelled() -> bool
async function scanFollowLists(userId, { fetchPage, onProgress, isCancelled, delay = wait }) {
  const out = { takenAt: Date.now(), userId: String(userId), followers: [], following: [] };
  for (const kind of ['following', 'followers']) {
    let maxId = null;
    let retries = 0;
    for (;;) {
      if (isCancelled()) throw new Error('Scan cancelled.');
      const { status, body } = await fetchPage(listUrl(userId, kind, maxId));
      if (status === 429 || status === 401 || /please wait/i.test(body || '')) {
        if (++retries > 3) throw new Error('Instagram is rate-limiting requests. Try again in an hour.');
        onProgress({ kind, count: out[kind].length, waiting: true });
        await delay(60000 * retries);
        continue;
      }
      if (status !== 200) throw new Error(`Instagram returned ${status} while reading your ${kind}. Are you logged in?`);
      const json = JSON.parse(body);
      out[kind].push(...(json.users || []).map(slimUser));
      onProgress({ kind, count: out[kind].length });
      maxId = json.next_max_id ? String(json.next_max_id) : null;
      if (!maxId || !(json.users || []).length) break;
      retries = 0;
      // Pace like a person scrolling, so the account isn't flagged.
      await delay(1500 + Math.floor(Math.random() * 1500));
    }
  }
  return out;
}

module.exports = { diffSnapshots, scanFollowLists, listUrl, slimUser, pageFetchSnippet, IG_APP_ID };
