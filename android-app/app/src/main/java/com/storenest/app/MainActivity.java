package com.storenest.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

/**
 * StoreNest Android preview. Shows the verified HTTPS StoreNest website in
 * an Android app window (no browser shortcut or address bar).
 *
 * Real authentication, order processing and payments are not implemented yet.
 */
public final class MainActivity extends Activity {
    private static final String APP_URL = "https://storenest-eight.vercel.app/";
    private static final String APP_HOST = "storenest-eight.vercel.app";
    private WebView webView;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(16, 23, 29));
        getWindow().setNavigationBarColor(Color.rgb(16, 23, 29));
        getWindow().getDecorView().setSystemUiVisibility(0);

        FrameLayout container = new FrameLayout(this);
        container.setBackgroundColor(Color.rgb(16, 23, 29));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(16, 23, 29));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String scheme = url.getScheme();
                if ("https".equals(scheme) && APP_HOST.equalsIgnoreCase(url.getHost())) {
                    return false;
                }
                if ("https".equals(scheme) || "http".equals(scheme)
                    || "mailto".equals(scheme) || "tel".equals(scheme)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, url));
                    } catch (Exception error) {
                        Toast.makeText(MainActivity.this, "Could not open link", Toast.LENGTH_SHORT).show();
                    }
                }
                return true;
            }
        });

        container.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(container);

        if (state == null) {
            webView.loadUrl(APP_URL);
        } else {
            webView.restoreState(state);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        webView.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
