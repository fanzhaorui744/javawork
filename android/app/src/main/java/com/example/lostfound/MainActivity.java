package com.example.lostfound;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

/**
 * 全屏 WebView 壳：加载 file:///android_asset/www/index.html。
 *
 * 设计要点：
 * 1. 无地址栏 / 无浏览器痕迹，启动时显示深色品牌启动图，页面首帧就绪后淡出；
 * 2. 开启 JavaScript、DOM Storage（localStorage）、file 访问资源；
 * 3. 返回键优先交给网页历史（canGoBack → goBack），到根页面才退出；
 * 4. 状态栏 / 导航栏深色背景 + 浅色图标，页面为沉浸式全屏原生观感。
 */
public class MainActivity extends Activity {

    private static final String START_URL = "file:///android_asset/www/index.html";
    private static final int REQ_FILE_CHOOSER = 1001;

    private WebView webView;
    private FrameLayout rootLayout;
    private View splashView;
    private boolean splashHidden = false;

    private ValueCallback<Uri[]> filePathCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        configureSystemBars();

        rootLayout = new FrameLayout(this);
        rootLayout.setBackgroundColor(getColor(R.color.brand_bg));
        rootLayout.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(getColor(R.color.brand_bg));
        // 去掉长按选中 / 滚动条带来的“网页感”
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setLongClickable(false);
        webView.setHapticFeedbackEnabled(false);

        configureWebView(webView);

        // 原生 AI 桥：window.NativeAI.chat(prompt)
        webView.addJavascriptInterface(new AiBridge(this, webView), "NativeAI");

        rootLayout.addView(webView);

        splashView = buildSplash();
        rootLayout.addView(splashView);

        setContentView(rootLayout);
        applyEdgeToEdgeInsets();

        webView.loadUrl(START_URL);
    }

    /** 深色状态栏 / 导航栏 + 浅色图标，让页面视觉上铺满全屏。 */
    private void configureSystemBars() {
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        window.setStatusBarColor(getColor(R.color.brand_bg));
        window.setNavigationBarColor(getColor(R.color.brand_bg));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        window.setNavigationBarDividerColor(getColor(R.color.brand_bg));

        // 内容延伸到系统栏下方；图标保持浅色（深色图标标志位不设置）
        View decor = window.getDecorView();
        int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR; // 去掉导航栏浅色图标标记
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        decor.setSystemUiVisibility(flags);
    }

    /** 兼容通知栏 / 刘海区域：把系统栏高度作为内边距，页面内容不会被状态栏压住。 */
    private void applyEdgeToEdgeInsets() {
        rootLayout.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                android.graphics.Insets bars = insets.getSystemWindowInsets();
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                v.setPadding(0, insets.getSystemWindowInsetTop(), 0, insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        rootLayout.requestApplyInsets();
    }

    private void configureWebView(WebView view) {
        WebSettings s = view.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        // file:// 页面需要读取同目录下的 js/css 与 localStorage
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setLoadsImagesAutomatically(true);
        s.setBlockNetworkImage(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(false);
        }
        // 自定义 UA 后缀，便于前端识别“原生容器”
        s.setUserAgentString(s.getUserAgentString() + " LostFoundApp/1.0 Android");

        view.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                return handleUrl(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                super.onPageFinished(v, url);
                hideSplash();
                injectBridgeProbe(v);
            }
        });

        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(intent, REQ_FILE_CHOOSER);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
            }
        });
    }

    /** 站内页面（file:// 等）留在 WebView，外部链接交给系统浏览器。 */
    private boolean handleUrl(Uri uri) {
        if (uri == null) {
            return false;
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        if ("file".equals(scheme) || "about".equals(scheme) || "javascript".equals(scheme)
                || "data".equals(scheme)) {
            return false;
        }
        if ("http".equals(scheme) || "https".equals(scheme)) {
            // 允许本机 / 模拟器回环地址留在 WebView 内
            if (host.contains("localhost") || host.contains("127.0.0.1") || host.contains("10.0.2.2")) {
                return false;
            }
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception ignored) {
                // 无浏览器可用时忽略
            }
            return true;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
        }
        return true;
    }

    /** 把 Android 环境信息塞给前端：离线模式与原生 AI 能力探测。 */
    private void injectBridgeProbe(WebView v) {
        String js = "(function(){" +
                "  try {" +
                "    window.OFFLINE_MODE = true;" +
                "    window.IS_ANDROID_SHELL = true;" +
                "    if (typeof window.__onNativeReady === 'function') { window.__onNativeReady(); }" +
                "    document.documentElement.classList.add('native-shell');" +
                "  } catch (e) {}" +
                "})();";
        v.evaluateJavascript(js, null);
    }

    private View buildSplash() {
        FrameLayout splash = new FrameLayout(this);
        splash.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        splash.setBackgroundColor(getColor(R.color.brand_bg));
        splash.setClickable(true);
        splash.setFocusable(true);

        // 渐变光晕：用一张竖向渐变 drawable 铺底，营造深色科技感
        View glow = new View(this);
        glow.setBackgroundResource(R.drawable.bg_splash_glow);
        splash.addView(glow, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        android.widget.LinearLayout column = new android.widget.LinearLayout(this);
        column.setOrientation(android.widget.LinearLayout.VERTICAL);
        column.setGravity(android.view.Gravity.CENTER_HORIZONTAL);
        FrameLayout.LayoutParams colLp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        colLp.gravity = android.view.Gravity.CENTER;
        splash.addView(column, colLp);

        // Logo（矢量：定位针 + 放大镜意象）
        android.widget.ImageView logo = new android.widget.ImageView(this);
        logo.setImageResource(R.drawable.ic_splash_logo);
        android.widget.LinearLayout.LayoutParams logoLp =
                new android.widget.LinearLayout.LayoutParams(dp(108), dp(108));
        logoLp.bottomMargin = dp(22);
        column.addView(logo, logoLp);

        TextView title = new TextView(this);
        title.setText(R.string.splash_title);
        title.setTextColor(getColor(R.color.brand_text));
        title.setTextSize(24f);
        title.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        title.setLetterSpacing(0.08f);
        title.setGravity(android.view.Gravity.CENTER);
        column.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText(R.string.splash_subtitle);
        subtitle.setTextColor(getColor(R.color.brand_text_dim));
        subtitle.setTextSize(12.5f);
        subtitle.setLetterSpacing(0.22f);
        subtitle.setGravity(android.view.Gravity.CENTER);
        android.widget.LinearLayout.LayoutParams subLp = new android.widget.LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        subLp.topMargin = dp(10);
        column.addView(subtitle, subLp);

        // 进度条：细线，避免使用原生不确定进度条的灰色
        View bar = new View(this);
        bar.setBackgroundResource(R.drawable.bg_splash_bar);
        android.widget.LinearLayout.LayoutParams barLp =
                new android.widget.LinearLayout.LayoutParams(dp(120), dp(3));
        barLp.topMargin = dp(30);
        column.addView(bar, barLp);

        TextView footer = new TextView(this);
        footer.setText(R.string.splash_footer);
        footer.setTextColor(getColor(R.color.brand_text_faint));
        footer.setTextSize(11f);
        footer.setGravity(android.view.Gravity.CENTER);
        FrameLayout.LayoutParams footLp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        footLp.gravity = android.view.Gravity.BOTTOM | android.view.Gravity.CENTER_HORIZONTAL;
        footLp.bottomMargin = dp(36);
        splash.addView(footer, footLp);

        return splash;
    }

    private void hideSplash() {
        if (splashHidden || splashView == null) {
            return;
        }
        splashHidden = true;
        splashView.animate()
                .alpha(0f)
                .setDuration(260)
                .withEndAction(() -> {
                    if (splashView != null) {
                        rootLayout.removeView(splashView);
                        splashView = null;
                    }
                })
                .start();
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (filePathCallback != null) {
                Uri[] result = null;
                if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
                filePathCallback.onReceiveValue(result);
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("NativeAI");
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
