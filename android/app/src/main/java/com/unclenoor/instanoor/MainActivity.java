package com.unclenoor.instanoor;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.ByteArrayInputStream;
import java.lang.ref.WeakReference;
import java.util.Collections;
import java.util.Set;

/** The Instagram screen: instagram.com in a WebView, with InstaNoor's script injected. */
public class MainActivity extends Activity {
    private static final int REQUEST_FILES = 1;
    private static final Set<String> IG_ORIGINS = Set.of(Hub.IG_ORIGIN);

    private WebView web;
    private FrameLayout root;
    private ScriptHandler startScript;
    private ValueCallback<Uri[]> fileCallback;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Hub.init(this);
        Hub.main = new WeakReference<>(this);

        root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        WebUi.fitSystemBars(this, root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(false);
        s.setAllowFileAccess(false);
        s.setUserAgentString(WebUi.chromeUserAgent(s.getUserAgentString()));
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Toast.makeText(this, "Update \"Android System WebView\" from the Play Store to use InstaNoor's features.", Toast.LENGTH_LONG).show();
        } else {
            WebViewCompat.addWebMessageListener(web, "InoorNative", IG_ORIGINS,
                    (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                        if (isMainFrame && message.getData() != null) Rpc.handle(this, "ig", message.getData(), replyProxy);
                    });
        }
        installStartScript();

        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, userAgent, contentDisposition, mimetype, length) -> {
            if (!url.startsWith("https://")) return;
            Rpc.enqueueDownload(this, url, URLUtil.guessFileName(url, contentDisposition, mimetype));
            Toast.makeText(this, "Downloading to Downloads/InstaNoor", Toast.LENGTH_SHORT).show();
        });

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }

        if (savedInstanceState != null && web.restoreState(savedInstanceState) != null) return;
        load(startUrl(getIntent()));
    }

    private String startUrl(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data != null && "https".equals(data.getScheme()) && WebUi.isInstagramHost(data.getHost())) {
            return data.buildUpon().authority("www.instagram.com").build().toString();
        }
        return Hub.IG_HOME;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent.getData() != null) load(startUrl(intent));
    }

    void load(String url) {
        web.loadUrl(url);
    }

    /** Re-injects the page script so the next page load starts with the new settings. */
    void onSettingsChanged() {
        installStartScript();
    }

    private void installStartScript() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        if (startScript != null) startScript.remove();
        startScript = WebViewCompat.addDocumentStartJavaScript(web, Hub.documentStartScript(), IG_ORIGINS);
    }

    private void goBack() {
        if (fullscreenView != null) {
            exitFullscreen();
        } else if (web.canGoBack()) {
            web.goBack();
        } else {
            finish();
        }
    }

    // Android 10-12 only; newer versions use the OnBackInvokedCallback registered in onCreate.
    @SuppressLint("GestureBackNavigation")
    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        goBack();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        if (Hub.main.get() == this) Hub.igProxy = null;
        web.destroy();
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_FILES || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) {
                result = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) result[i] = clip.getItemAt(i).getUri();
            } else if (data.getData() != null) {
                result = new Uri[] {data.getData()};
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    private void exitFullscreen() {
        if (fullscreenView == null) return;
        root.removeView(fullscreenView);
        fullscreenView = null;
        if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
        fullscreenCallback = null;
        web.setVisibility(View.VISIBLE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) c.show(WindowInsets.Type.systemBars());
        }
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String scheme = uri.getScheme();
            if (("https".equals(scheme) || "http".equals(scheme)) && WebUi.isInstagramHost(uri.getHost())
                    && !"l.instagram.com".equals(uri.getHost())) {
                return false;
            }
            WebUi.openExternal(MainActivity.this, uri);
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (Hub.shouldBlock(request.getUrl().toString())) {
                return new WebResourceResponse("text/plain", "utf-8", 204, "No Content",
                        Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
            return null;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            // Older WebViews without document-start scripts: inject as early as we can.
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
                    && url != null && url.startsWith(Hub.IG_HOME)) {
                view.evaluateJavascript(Hub.documentStartScript(), null);
            }
        }
    }

    private class Chrome extends WebChromeClient {
        @SuppressWarnings("deprecation")
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent intent = params.createIntent();
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            try {
                startActivityForResult(intent, REQUEST_FILES);
            } catch (RuntimeException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            exitFullscreen();
            fullscreenView = view;
            fullscreenCallback = callback;
            root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            web.setVisibility(View.GONE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsetsController c = getWindow().getInsetsController();
                if (c != null) {
                    c.hide(WindowInsets.Type.systemBars());
                    c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                }
            }
        }

        @Override
        public void onHideCustomView() {
            exitFullscreen();
        }
    }
}
