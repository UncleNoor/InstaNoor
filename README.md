# InstaNoor

An Instagram client for **Android** and for **Windows, macOS and Linux** with the features people keep asking Instagram for: an ad blocker, a chronological feed, downloads, anonymous story viewing, a follower tracker, focus tools, and **GIFs in DMs**.

On Android, InstaNoor is a separate app (`com.unclenoor.instanoor`), so it installs **next to** the official Instagram app. You don't have to uninstall Instagram.

InstaNoor runs the real instagram.com inside its own window and adds features on top. You log in with your normal account. Your password goes only to Instagram, and nothing is sent to any other server (except GIF searches, which go to the GIF provider you pick).

## Features

| | |
|---|---|
| **Ad blocker** | Removes sponsored posts from the feed, reels and Explore, and skips story ads. Ads are stripped from Instagram's API responses before the page sees them, and a DOM check catches anything left. |
| **Tracker blocker** | Blocks Meta's logging and analytics requests. |
| **Hide "Suggested for you"** | Hides suggested posts, suggested accounts and promo blocks. |
| **Chronological feed** | Opens the *Following* feed (newest first) by default. You can choose *Favorites only* instead. |
| **Hide Reels / Explore / stories bar** | Removes the tabs and blocks the Reels and Explore feeds. Reels sent to you in DMs still open. |
| **GIFs in DMs** | A **GIF** button (or `Ctrl+G`) in every chat opens a GIPHY or KLIPY picker with search, trending and recents. GIFs are sent as looping videos so they stay animated. |
| **Downloads** | Save photos, whole carousels, videos, reels, stories and full-size profile pictures. Downloads use the original quality. |
| **Anonymous stories** | Watch stories without showing up in the viewer list. |
| **Hide "Seen" in DMs** | Experimental. For a reliable result, also turn off *Read receipts* in Instagram's own settings. |
| **Follower tracker** | Shows who doesn't follow you back, who unfollowed you since your last scan, and your new followers. |
| **Focus mode** | A timer for time spent today, a daily limit with a break screen, and break reminders. |
| **Multiple accounts** | Each account gets its own window and stays logged in (`Accounts` menu, `Ctrl+Shift+1…9`). |
| **Themes** | AMOLED black, Midnight blue, Sepia, a wide feed layout, and your own custom CSS. |
| **Keyboard shortcuts** | `j`/`k` next/previous post, `l` like, `s` save, `d` download, `m` mute, `p` picture-in-picture, `g h`/`g m`/`g n`/`g s` go to Home/Messages/Notifications/Saved, `?` show all shortcuts. |
| **Also** | Unread badge on the dock/taskbar, desktop notifications, auto-unmute, back/forward with `Alt+←/→`, zoom, and external links that open in your browser (Instagram's link tracker is removed). |

All of these can be switched on or off in **Settings** (`Ctrl+,` / `Cmd+,`).

## Android

### Install

1. Copy `InstaNoor-1.0.0.apk` to your phone, or download it from the latest *Android APK* run under the repository's **Actions** tab.
2. Open it. When Android asks, allow your browser or file manager to **install unknown apps**.
3. Open **InstaNoor** and log in. Your Instagram app stays installed and keeps working as usual.

Tap the round **N** button to open Settings, the Follower Tracker and Downloads. Downloads are saved to `Downloads/InstaNoor`. Android 10 or newer is required.

To make Instagram links open in InstaNoor, tap a link and pick *InstaNoor* (or set it in *Settings → Apps → InstaNoor → Open by default*).

### Build the APK

Requires Node.js 20+, JDK 17+ and the Android SDK (set `sdk.dir` in `android/local.properties` or `ANDROID_HOME`).

```bash
cd android
./gradlew assembleRelease     # → android/app/build/outputs/apk/release/
```

The build runs `scripts/build-mobile.js` first, which bundles the shared code from `src/` into the app's assets.

Release builds are signed with the key in `android/keystore.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`), or with the debug key if that file doesn't exist. Keep your key safe: Android only installs an update when it is signed with the same key as the installed app. In GitHub Actions, add the secrets `INSTANOOR_KEYSTORE_BASE64`, `INSTANOOR_STORE_PASSWORD`, `INSTANOOR_KEY_ALIAS` and `INSTANOOR_KEY_PASSWORD`.

**Not available on Android yet:** multiple accounts in separate windows (use Instagram's own account switcher instead), desktop notifications, keyboard shortcuts and the wide layout.

iPhone isn't supported. iOS doesn't allow installing apps from outside the App Store without a paid developer account and a Mac.

## Desktop

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm start
```

Build an installer for your platform (it is saved in `dist/`):

```bash
npm run dist          # current platform
npm run dist:win      # Windows .exe (installer + portable)
npm run dist:mac      # macOS .dmg
npm run dist:linux    # AppImage + .deb
```

### Setting up GIFs

GIF providers need a free API key. Tenor is not an option, because Google shut down its public API on 30 June 2026.

1. Get a key from [GIPHY](https://developers.giphy.com) (*Create an App → API*) or from [KLIPY](https://partner.klipy.com).
2. Paste it into **Settings → Chat & GIFs**.
3. Open a chat and click **GIF** above the message box, or press `Ctrl+G`.

If Instagram ever rejects video attachments, set **Send GIFs as** to *Link*.

## How it works

```
android/         Android app (Java): WebView, native bridge, downloads, file uploads
src/
  main/          Electron main process
    main.js            windows, accounts, menu, IPC, downloads
    request-filter.js  network-level blocking (trackers, story "seen")
    gif-providers.js   GIPHY + KLIPY search
    follow-tracker.js  follower/following scans and diffs
    store.js           settings and usage stored as JSON in the app data folder
  shared/
    settings-schema.js every setting (the Settings window is generated from it)
    page-hooks.js      runs inside Instagram's page: wraps fetch/XHR/WebSocket to
                       remove ads, block "seen" receipts and index media for downloads
  preload/
    features.js        DOM features: hiding, download buttons, GIF button, shortcuts, focus timer
                       (shared by desktop and Android)
    instagram.js       desktop host for features.js
    selectors.js       every Instagram-specific selector and label, in one place
    styles.js          themes and InstaNoor's own UI styles
    helpers.js         URL parsing, shortcode → media id, etc.
  renderer/            Settings, GIF picker and Follower Tracker screens (desktop and Android)
  mobile/              Android glue: native bridge, page script entry, tool-screen bridge
```

Instagram changes its website often. When something stops working, it is usually a selector or label in `src/preload/selectors.js` or a pattern in `src/shared/page-hooks.js`.

Run the tests with:

```bash
npm test
```

## Good to know

- **Unofficial.** InstaNoor is not made by, or connected to, Instagram or Meta. Some features (downloading, anonymous viewing, the follower tracker, blocking ads) go against Instagram's Terms of Use. Use them at your own risk.
- **Follower tracker pacing.** Scans are deliberately slow (about one request every 1.5–3 seconds) and back off when Instagram asks. Don't run scans back to back.
- **Respect people's content.** Downloaded photos and videos belong to the people who posted them.
- **Security.** The Instagram page has no access to Node.js (`contextIsolation` is on and `nodeIntegration` is off). InstaNoor's own windows are sandboxed and use a strict Content Security Policy.

## License

MIT
