package com.unclenoor.instanoor;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.util.Base64;
import android.webkit.WebSettings;
import android.widget.Toast;

import androidx.webkit.JavaScriptReplyProxy;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Handles messages from the web side (src/mobile/bridge.js). "ig" messages come
 * from the Instagram page, "tool" messages from the Settings / GIF / tracker screens.
 */
final class Rpc {
    private static final Set<String> GIF_API_HOSTS = Set.of("api.giphy.com", "api.klipy.com");
    private static final int MAX_GIF_BYTES = 15 * 1024 * 1024;
    private static final Pattern MEDIA_EXT = Pattern.compile("\\.(jpe?g|png|webp|heic|mp4|mov|gif)$", Pattern.CASE_INSENSITIVE);

    private Rpc() {}

    /** Sends the result of one request back to the page that made it. */
    static final class Reply {
        private final JavaScriptReplyProxy proxy;
        private final int id;

        Reply(JavaScriptReplyProxy proxy, int id) {
            this.proxy = proxy;
            this.id = id;
        }

        void ok(Object result) {
            send("result", result == null ? JSONObject.NULL : result);
        }

        void err(String message) {
            send("error", message == null ? "Something went wrong" : message);
        }

        private void send(String key, Object value) {
            if (id == 0) return;
            String json;
            try {
                json = new JSONObject().put("id", id).put(key, value).toString();
            } catch (JSONException e) {
                return;
            }
            Hub.ui.post(() -> {
                try {
                    proxy.postMessage(json);
                } catch (RuntimeException ignored) {
                    // The page is gone.
                }
            });
        }
    }

    static void handle(Activity activity, String source, String data, JavaScriptReplyProxy proxy) {
        JSONObject msg;
        try {
            msg = new JSONObject(data);
        } catch (JSONException e) {
            return;
        }
        boolean fromIg = "ig".equals(source);
        if (fromIg) Hub.igProxy = proxy;
        else Hub.toolProxy = proxy;

        String method = msg.optString("method");
        Object args = msg.opt("args");
        Reply reply = new Reply(proxy, msg.optInt("id", 0));
        try {
            if (fromIg) handleIg(activity, method, args, reply);
            else handleTool(activity, method, args, reply);
        } catch (Exception e) {
            reply.err(e.getMessage());
        }
    }

    private static void handleIg(Activity activity, String method, Object args, Reply reply) throws Exception {
        switch (method) {
            case "hello":
                // A new page loaded; a scan running in the old one can't finish.
                if (Hub.pendingFollow != null) {
                    Hub.pendingFollow.err("The scan stopped because Instagram reloaded. Try again.");
                    Hub.pendingFollow = null;
                }
                break;
            case "stats:add": {
                JSONObject s = (JSONObject) args;
                Hub.adsBlocked += s.optInt("ads", 0);
                Hub.seenBlocked += s.optInt("seen", 0);
                break;
            }
            case "usage:get":
                reply.ok(new JSONObject().put("today", Hub.store.usageToday()));
                break;
            case "usage:add": {
                long seconds = Math.max(0, Math.min(120, ((Number) args).longValue()));
                reply.ok(new JSONObject().put("today", Hub.store.addUsage(seconds)).put("day", Store.today()));
                break;
            }
            case "download":
                download(activity, (JSONArray) args);
                reply.ok(new JSONObject().put("folder", "Downloads/InstaNoor"));
                break;
            case "gif:open":
                ToolActivity.open(activity, "gif-picker");
                reply.ok(true);
                break;
            case "app:open":
                openScreen(activity, String.valueOf(args));
                reply.ok(true);
                break;
            case "app:close":
                activity.finish();
                break;
            case "follow:progress":
                Hub.toolEvent("follow:progress", args);
                break;
            case "follow:done":
                finishFollowScan((JSONObject) args);
                break;
            default:
                reply.err("Unknown method " + method);
        }
    }

    private static void handleTool(Activity activity, String method, Object args, Reply reply) throws Exception {
        switch (method) {
            case "settings:get":
                reply.ok(new JSONObject()
                        .put("settings", Hub.store.settings())
                        .put("stats", new JSONObject()
                                .put("ads", Hub.adsBlocked)
                                .put("tracking", Hub.trackersBlocked)
                                .put("seen", Hub.seenBlocked)));
                break;
            case "settings:save": {
                JSONObject settings = (JSONObject) args;
                Hub.store.saveSettings(settings);
                MainActivity m = Hub.main.get();
                if (m != null) m.onSettingsChanged();
                Hub.igEvent("settings:changed", settings);
                reply.ok(true);
                break;
            }
            case "app:open":
                openScreen(activity, String.valueOf(args));
                reply.ok(true);
                break;
            case "app:info":
                reply.ok(new JSONObject().put("customerId", Hub.store.customerId()).put("version", BuildConfig.VERSION_NAME));
                break;
            case "usage:get":
                reply.ok(new JSONObject().put("today", Hub.store.usageToday()).put("history", Hub.store.usage()));
                break;
            case "http:get":
                httpGet(String.valueOf(args), reply);
                break;
            case "gif:choose":
                chooseGif(activity, (JSONObject) args, reply);
                break;
            case "follow:last":
                followLast(reply);
                break;
            case "follow:scan":
                startFollowScan(reply);
                break;
            case "follow:cancel":
                Hub.igEvent("follow:cancel", null);
                break;
            case "follow:open-profile": {
                String username = String.valueOf(args);
                MainActivity m = Hub.main.get();
                if (m != null && username.matches("[\\w.]{1,30}")) {
                    m.load(Hub.IG_HOME + username + "/");
                    activity.finish();
                }
                break;
            }
            default:
                reply.err("Unknown method " + method);
        }
    }

    private static void openScreen(Activity activity, String what) {
        switch (what) {
            case "settings":
                ToolActivity.open(activity, "settings");
                break;
            case "follow":
                ToolActivity.open(activity, "follow");
                break;
            case "downloads":
                Intent i = new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    activity.startActivity(i);
                } catch (RuntimeException e) {
                    Toast.makeText(activity, "Your files are in Downloads/InstaNoor", Toast.LENGTH_LONG).show();
                }
                break;
            default:
                break;
        }
    }

    // ---------- downloads ----------

    static String safeName(String name) {
        String clean = name.replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f]", "_");
        if (clean.isEmpty()) clean = "instagram";
        return clean.length() > 150 ? clean.substring(0, 150) : clean;
    }

    static String extension(String url, boolean isVideo) {
        String path = Uri.parse(url).getPath();
        Matcher m = MEDIA_EXT.matcher(path == null ? "" : path);
        if (m.find()) return "." + m.group(1).toLowerCase(Locale.US).replace("jpeg", "jpg");
        return isVideo ? ".mp4" : ".jpg";
    }

    static void enqueueDownload(Context context, String url, String filename) {
        DownloadManager dm = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url))
                .setTitle(filename)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "InstaNoor/" + filename)
                .addRequestHeader("User-Agent", WebSettings.getDefaultUserAgent(context));
        dm.enqueue(req);
    }

    private static void download(Activity activity, JSONArray files) throws JSONException {
        if (files == null || files.length() == 0) throw new IllegalArgumentException("Nothing to download");
        for (int i = 0; i < files.length(); i++) {
            JSONObject f = files.getJSONObject(i);
            String url = f.getString("url");
            if (!url.startsWith("https://")) continue;
            enqueueDownload(activity, url, safeName(f.optString("name", "instagram")) + extension(url, f.optBoolean("isVideo")));
        }
    }

    // ---------- GIFs ----------

    private static byte[] fetchBytes(String url, int max, int[] statusOut) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        c.setRequestProperty("Accept", "*/*");
        try {
            int status = c.getResponseCode();
            if (statusOut != null) statusOut[0] = status;
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in == null) return new byte[0];
            try (InputStream body = in) {
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] chunk = new byte[16384];
                for (int n; (n = body.read(chunk)) > 0; ) {
                    if (buf.size() + n > max) throw new IOException("File is too large");
                    buf.write(chunk, 0, n);
                }
                return buf.toByteArray();
            }
        } finally {
            c.disconnect();
        }
    }

    private static void httpGet(String url, Reply reply) {
        Uri u = Uri.parse(url);
        if (!"https".equals(u.getScheme()) || !GIF_API_HOSTS.contains(u.getHost())) {
            reply.err("Blocked request to " + u.getHost());
            return;
        }
        Hub.io.execute(() -> {
            try {
                int[] status = new int[1];
                byte[] body = fetchBytes(url, 4 * 1024 * 1024, status);
                reply.ok(new JSONObject().put("status", status[0]).put("body", new String(body, StandardCharsets.UTF_8)));
            } catch (IOException | JSONException e) {
                reply.err("Network error: " + e.getMessage());
            }
        });
    }

    private static void chooseGif(Activity activity, JSONObject args, Reply reply) throws JSONException {
        if (Hub.igProxy == null) throw new IllegalStateException("Open a chat first.");
        JSONObject gif = args.getJSONObject("gif");
        String format = args.optString("format", "mp4");
        String mp4 = gif.optString("mp4", "");
        String gifUrl = gif.optString("gif", "");
        String link = gif.optString("page", "");
        if (link.isEmpty()) link = gifUrl.isEmpty() ? mp4 : gifUrl;
        final String pageLink = link;

        if ("link".equals(format) || (mp4.isEmpty() && gifUrl.isEmpty())) {
            Hub.igEvent("gif:attach", new JSONObject().put("link", pageLink));
            reply.ok(true);
            activity.finish();
            return;
        }
        boolean useMp4 = "mp4".equals(format) ? !mp4.isEmpty() : gifUrl.isEmpty();
        String url = useMp4 ? mp4 : gifUrl;
        if (!url.startsWith("https://")) throw new IllegalArgumentException("Invalid GIF URL");
        Hub.io.execute(() -> {
            try {
                int[] status = new int[1];
                byte[] bytes = fetchBytes(url, MAX_GIF_BYTES, status);
                if (status[0] >= 400) throw new IOException("Could not download the GIF (" + status[0] + ")");
                Hub.igEvent("gif:attach", new JSONObject()
                        .put("b64", Base64.encodeToString(bytes, Base64.NO_WRAP))
                        .put("mime", useMp4 ? "video/mp4" : "image/gif")
                        .put("name", "gif-" + System.currentTimeMillis() + (useMp4 ? ".mp4" : ".gif"))
                        .put("link", pageLink));
                reply.ok(true);
                Hub.ui.post(activity::finish);
            } catch (IOException | JSONException e) {
                reply.err(e.getMessage());
            }
        });
    }

    // ---------- follower tracker ----------

    private static void followLast(Reply reply) throws JSONException {
        String userId = Hub.currentUserId();
        if (userId == null) {
            reply.ok(new JSONObject().put("loggedIn", false));
            return;
        }
        JSONObject snap = Hub.store.readSnapshot(userId);
        JSONObject out = new JSONObject().put("loggedIn", true);
        if (snap != null) {
            out.put("snapshot", new JSONObject()
                    .put("takenAt", snap.optLong("takenAt"))
                    .put("followers", snap.optJSONArray("followers") == null ? 0 : snap.getJSONArray("followers").length())
                    .put("following", snap.optJSONArray("following") == null ? 0 : snap.getJSONArray("following").length()));
            out.put("result", snap.opt("result"));
        } else {
            out.put("snapshot", JSONObject.NULL);
        }
        reply.ok(out);
    }

    private static void startFollowScan(Reply reply) throws JSONException {
        String userId = Hub.currentUserId();
        if (userId == null) throw new IllegalStateException("Log in to Instagram first.");
        if (Hub.igProxy == null) throw new IllegalStateException("Open Instagram first.");
        if (Hub.pendingFollow != null) throw new IllegalStateException("A scan is already running.");
        JSONObject prev = Hub.store.readSnapshot(userId);
        Hub.pendingFollow = reply;
        Hub.igEvent("follow:scan", new JSONObject().put("userId", userId).put("prev", prev == null ? JSONObject.NULL : prev));
    }

    private static void finishFollowScan(JSONObject args) {
        Reply pending = Hub.pendingFollow;
        Hub.pendingFollow = null;
        if (pending == null) return;
        if (args.has("error")) {
            pending.err(args.optString("error"));
            return;
        }
        JSONObject snapshot = args.optJSONObject("snapshot");
        try {
            if (snapshot != null) Hub.store.writeSnapshot(snapshot.optString("userId"), snapshot);
        } catch (IOException e) {
            pending.err("Could not save the scan: " + e.getMessage());
            return;
        }
        pending.ok(args.opt("result"));
    }
}
