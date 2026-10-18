package com.unclenoor.instanoor;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;

import androidx.webkit.JavaScriptReplyProxy;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/** App-wide state shared by the Instagram screen and the tool screens. */
final class Hub {
    static final String IG_ORIGIN = "https://www.instagram.com";
    static final String IG_HOME = IG_ORIGIN + "/";

    static Store store;
    static final Handler ui = new Handler(Looper.getMainLooper());
    static final ExecutorService io = Executors.newCachedThreadPool();

    /** Reply channel to the Instagram page that is currently loaded. */
    static JavaScriptReplyProxy igProxy;
    /** Reply channel to the open tool screen (settings, GIF picker, tracker). */
    static JavaScriptReplyProxy toolProxy;
    static WeakReference<MainActivity> main = new WeakReference<>(null);
    static WeakReference<ToolActivity> tool = new WeakReference<>(null);
    /** The tool-screen request waiting for a follower scan to finish. */
    static Rpc.Reply pendingFollow;

    static int adsBlocked;
    static int trackersBlocked;
    static int seenBlocked;

    private static String pageScript;
    private static final List<Pattern> trackingPatterns = new ArrayList<>();
    private static final List<Pattern> storySeenPatterns = new ArrayList<>();

    private Hub() {}

    static synchronized void init(Context context) {
        if (store != null) return;
        Context app = context.getApplicationContext();
        store = new Store(app);
        try {
            pageScript = readAsset(app, "instanoor-page.js");
            JSONObject patterns = new JSONObject(readAsset(app, "block-patterns.json"));
            compile(patterns.getJSONArray("tracking"), trackingPatterns);
            compile(patterns.getJSONArray("storySeen"), storySeenPatterns);
        } catch (IOException | JSONException e) {
            throw new IllegalStateException("InstaNoor assets are missing; run scripts/build-mobile.js", e);
        }
    }

    private static void compile(JSONArray sources, List<Pattern> out) throws JSONException {
        for (int i = 0; i < sources.length(); i++) out.add(Pattern.compile(sources.getString(i)));
    }

    static String readAsset(Context context, String name) throws IOException {
        try (InputStream in = context.getAssets().open(name)) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[16384];
            for (int n; (n = in.read(chunk)) > 0; ) buf.write(chunk, 0, n);
            return buf.toString(StandardCharsets.UTF_8.name());
        }
    }

    /** The script injected into every instagram.com page, with the current settings. */
    static String documentStartScript() {
        return "window.__inoorSettings=" + store.settings() + ";\n" + pageScript;
    }

    /** True when a request should be cancelled (trackers, story "seen" receipts). */
    static boolean shouldBlock(String url) {
        JSONObject s = store.settings();
        if (s.optBoolean("blockTracking", true) && matches(trackingPatterns, url)) {
            trackersBlocked++;
            return true;
        }
        if (s.optBoolean("anonymousStories", false) && matches(storySeenPatterns, url)) {
            seenBlocked++;
            return true;
        }
        return false;
    }

    private static boolean matches(List<Pattern> patterns, String url) {
        for (Pattern p : patterns) if (p.matcher(url).find()) return true;
        return false;
    }

    static String currentUserId() {
        String cookies = CookieManager.getInstance().getCookie(IG_HOME);
        if (cookies == null) return null;
        for (String part : cookies.split(";")) {
            String c = part.trim();
            if (c.startsWith("ds_user_id=")) {
                String id = c.substring("ds_user_id=".length());
                return id.matches("\\d+") ? id : null;
            }
        }
        return null;
    }

    static void igEvent(String event, Object data) {
        post(igProxy, event, data);
    }

    static void toolEvent(String event, Object data) {
        post(toolProxy, event, data);
    }

    private static void post(JavaScriptReplyProxy proxy, String event, Object data) {
        if (proxy == null) return;
        String json;
        try {
            json = new JSONObject().put("event", event).put("data", data == null ? JSONObject.NULL : data).toString();
        } catch (JSONException e) {
            return;
        }
        ui.post(() -> {
            try {
                proxy.postMessage(json);
            } catch (RuntimeException ignored) {
                // The page navigated away; its proxy is gone.
            }
        });
    }
}
