package com.unclenoor.instanoor;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.lang.ref.WeakReference;
import java.util.Set;

/** Settings, GIF picker and Follower Tracker: the shared HTML screens from src/renderer. */
public class ToolActivity extends Activity {
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final Set<String> PAGES = Set.of("settings", "gif-picker", "follow");

    private WebView web;

    static void open(Context context, String page) {
        Intent i = new Intent(context, ToolActivity.class).putExtra("page", page);
        if (!(context instanceof Activity)) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(i);
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Hub.init(this);
        Hub.tool = new WeakReference<>(this);

        String page = getIntent().getStringExtra("page");
        if (page == null || !PAGES.contains(page)) {
            finish();
            return;
        }

        web = new WebView(this);
        setContentView(web);
        WebUi.fitSystemBars(this, web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);

        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (ASSET_HOST.equals(uri.getHost())) return false;
                WebUi.openExternal(ToolActivity.this, uri);
                return true;
            }
        });

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "InoorNative", Set.of("https://" + ASSET_HOST),
                    (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                        if (message.getData() != null) Rpc.handle(this, "tool", message.getData(), replyProxy);
                    });
        }
        web.loadUrl("https://" + ASSET_HOST + "/assets/tools/" + page + ".html");
    }

    @Override
    protected void onDestroy() {
        if (Hub.tool.get() == this) Hub.toolProxy = null;
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
