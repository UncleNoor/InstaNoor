package com.unclenoor.instanoor;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Toast;

/** Small helpers shared by both screens. */
final class WebUi {
    private WebUi() {}

    /**
     * Presents as regular mobile Chrome. Instagram serves a reduced site to
     * user agents that say they are a WebView ("; wv", "Version/4.0").
     */
    static String chromeUserAgent(String ua) {
        return ua.replace("; wv", "")
                .replaceAll(" Version/[\\d.]+", "")
                .replaceAll(" Build/[^;)]+", "");
    }

    /**
     * Draws edge-to-edge on every Android version that supports it (it is forced on
     * Android 15+), and pads the content clear of the system bars and the keyboard.
     * Android 10 keeps the classic layout, where adjustResize handles the keyboard.
     */
    static void fitSystemBars(Activity activity, View root) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return;
        activity.getWindow().setDecorFitsSystemWindows(false);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
    }

    static boolean isInstagramHost(String host) {
        if (host == null) return false;
        return host.equals("instagram.com") || host.endsWith(".instagram.com")
                || host.equals("facebook.com") || host.endsWith(".facebook.com");
    }

    /** Opens a link in the user's browser, unwrapping Instagram's link tracker. */
    static void openExternal(Activity activity, Uri uri) {
        if ("l.instagram.com".equals(uri.getHost()) && uri.getQueryParameter("u") != null) {
            uri = Uri.parse(uri.getQueryParameter("u"));
        }
        String scheme = uri.getScheme();
        try {
            if ("intent".equals(scheme)) {
                Intent intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                intent.setComponent(null);
                intent.setSelector(null);
                activity.startActivity(intent);
            } else if ("http".equals(scheme) || "https".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme)) {
                activity.startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
            }
        } catch (ActivityNotFoundException | java.net.URISyntaxException e) {
            Toast.makeText(activity, "No app can open this link", Toast.LENGTH_SHORT).show();
        }
    }
}
