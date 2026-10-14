package com.sikkaind.sikkafleet;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Logger;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "SikkaFleet";
    private static final String REMOTE_PRODUCTION_URL = "https://sikka-fleet.vercel.app";
    private static final String LOCAL_FALLBACK_URL = "https://localhost/";

    private boolean isOfflineFallback = false;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        setupWebViewSettings();
        setupOfflineFallbackListener();
        setupNetworkMonitoring();
    }

    private void setupWebViewSettings() {
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                WebView webView = getBridge().getWebView();
                WebSettings settings = webView.getSettings();

                // Enable standard browser storage and modern caching
                settings.setDomStorageEnabled(true);
                settings.setDatabaseEnabled(true);
                settings.setCacheMode(WebSettings.LOAD_DEFAULT);
                settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
                Logger.info(TAG, "WebView settings successfully configured for live production updates.");
            }
        } catch (Exception e) {
            Logger.warn(TAG, "Failed to apply custom WebView settings: " + e.getMessage());
        }
    }

    private void setupOfflineFallbackListener() {
        try {
            if (getBridge() != null) {
                getBridge().addWebViewListener(new WebViewListener() {
                    @Override
                    public void onReceivedError(WebView webView) {
                        Logger.warn(TAG, "Remote server unreachable. Activating local offline fallback.");
                        isOfflineFallback = true;
                        webView.post(() -> {
                            String currentUrl = webView.getUrl();
                            if (currentUrl == null || !currentUrl.startsWith(LOCAL_FALLBACK_URL)) {
                                webView.loadUrl(LOCAL_FALLBACK_URL);
                            }
                        });
                    }
                });
            }
        } catch (Exception e) {
            Logger.warn(TAG, "Failed to register WebView error listener: " + e.getMessage());
        }
    }

    private void setupNetworkMonitoring() {
        try {
            connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (connectivityManager != null) {
                NetworkRequest request = new NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build();

                networkCallback = new ConnectivityManager.NetworkCallback() {
                    @Override
                    public void onAvailable(Network network) {
                        runOnUiThread(() -> {
                            if (isOfflineFallback) {
                                Logger.info(TAG, "Network restored. Reconnecting to live production web application.");
                                isOfflineFallback = false;
                                if (getBridge() != null && getBridge().getWebView() != null) {
                                    getBridge().getWebView().loadUrl(REMOTE_PRODUCTION_URL);
                                }
                            }
                        });
                    }
                };

                connectivityManager.registerNetworkCallback(request, networkCallback);
            }
        } catch (Exception e) {
            Logger.warn(TAG, "Failed to initialize network callback: " + e.getMessage());
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (connectivityManager != null && networkCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            } catch (Exception ignored) {}
        }
    }
}
