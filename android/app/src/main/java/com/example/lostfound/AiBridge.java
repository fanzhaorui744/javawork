package com.example.lostfound;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * 原生 AI 桥（DeepSeek Chat API）。
 *
 * 前端用法（异步，必须由 Promise 包装）：
 * <pre>
 *   window.NativeAI.chat(prompt, requestId)   // 发起请求，立即返回
 *   window.NativeAI.onResult(requestId, ok, text)  // 由原生回调
 * </pre>
 *
 * 设计约束：
 * - 网络请求在子线程执行，绝不能阻塞 WebView 的 JS 线程；
 * - 必须用 evaluateJavascript 回调，不能同步返回（JS 接口返回值只能是基本类型）；
 * - 超时 / 失败统一回调空字符串，让前端降级到本地算法；
 * - API Key 来自 BuildConfig（编入 dex），不出现在 assets 与日志中。
 */
public class AiBridge {

    private static final String TAG = "AiBridge";
    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 10_000;
    private static final String MODEL = "deepseek-chat";
    private static final int MAX_PROMPT_CHARS = 8000;

    private final Context context;
    private final WebView webView;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    public AiBridge(Context context, WebView webView) {
        this.context = context;
        this.webView = webView;
    }

    /** 能力探测：前端可据此决定是否优先走原生 AI。 */
    @JavascriptInterface
    public boolean isAvailable() {
        String key = BuildConfig.DEEPSEEK_API_KEY;
        return key != null && !key.trim().isEmpty() && !key.contains("YOUR_");
    }

    /**
     * 发起一次对话。立即返回 true 表示请求已排队，结果通过
     * {@code window.NativeAI.onResult(requestId, ok, text)} 异步回调。
     */
    @JavascriptInterface
    public boolean chat(final String prompt, final String requestId) {
        if (prompt == null || prompt.trim().isEmpty()) {
            deliver(requestId, false, "");
            return false;
        }
        if (!isAvailable()) {
            deliver(requestId, false, "");
            return false;
        }
        final String safePrompt = prompt.length() > MAX_PROMPT_CHARS
                ? prompt.substring(0, MAX_PROMPT_CHARS) : prompt;
        new Thread(() -> {
            String content = "";
            boolean ok = false;
            try {
                content = requestCompletion(safePrompt);
                ok = content != null && !content.trim().isEmpty();
                if (!ok) {
                    content = "";
                }
            } catch (Exception e) {
                // 只记录异常类型，不输出密钥
                Log.w(TAG, "DeepSeek 调用失败: " + e.getClass().getSimpleName());
                content = "";
                ok = false;
            }
            deliver(requestId, ok, content);
        }, "ai-bridge").start();
        return true;
    }

    /** 兼容旧签名：无 requestId 时用时间戳，前端可用 onResult 全局回调。 */
    @JavascriptInterface
    public boolean chat(String prompt) {
        return chat(prompt, "auto-" + System.currentTimeMillis());
    }

    private String requestCompletion(String prompt) throws Exception {
        String base = BuildConfig.DEEPSEEK_BASE_URL;
        if (base == null || base.trim().isEmpty()) {
            base = "https://api.deepseek.com";
        }
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        URL url = new URL(base + "/chat/completions");

        JSONArray messages = new JSONArray();
        messages.put(new JSONObject()
                .put("role", "system")
                .put("content", "你是校园失物招领平台的辅助助手，输出务必简洁准确。"));
        messages.put(new JSONObject()
                .put("role", "user")
                .put("content", prompt));

        JSONObject payload = new JSONObject()
                .put("model", MODEL)
                .put("stream", false)
                .put("temperature", 0.3)
                .put("messages", messages);

        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + BuildConfig.DEEPSEEK_API_KEY.trim());

            byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(body.length);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body);
                os.flush();
            }

            int code = conn.getResponseCode();
            InputStream is = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
            String response = readAll(is);
            if (code < 200 || code >= 300) {
                Log.w(TAG, "DeepSeek HTTP " + code);
                return "";
            }
            JSONObject root = new JSONObject(response);
            JSONArray choices = root.optJSONArray("choices");
            if (choices == null || choices.length() == 0) {
                return "";
            }
            JSONObject message = choices.getJSONObject(0).optJSONObject("message");
            return message == null ? "" : message.optString("content", "");
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private String readAll(InputStream is) throws Exception {
        if (is == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(is, StandardCharsets.UTF_8))) {
            char[] buf = new char[4096];
            int n;
            while ((n = reader.read(buf)) != -1) {
                sb.append(buf, 0, n);
            }
        }
        return sb.toString();
    }

    /** 回到主线程，用 evaluateJavascript 把结果推给前端。 */
    private void deliver(final String requestId, final boolean ok, final String text) {
        final String rid = requestId == null ? "" : requestId;
        mainHandler.post(() -> {
            if (webView == null) {
                return;
            }
            // 优先回调 offline.js 注册的 __lfAiResult，其次回落到 NativeAI.onResult
            String args = JSONObject.quote(rid) + "," + ok + ","
                    + JSONObject.quote(text == null ? "" : text);
            String js = "(function(){" +
                    "  try {" +
                    "    if (typeof window.__lfAiResult === 'function') { window.__lfAiResult(" + args + "); return; }" +
                    "    if (window.NativeAI && window.NativeAI.onResult) { window.NativeAI.onResult(" + args + "); }" +
                    "  } catch (e) {}" +
                    "})();";
            try {
                webView.evaluateJavascript(js, null);
            } catch (Exception e) {
                Log.w(TAG, "回调前端失败: " + e.getClass().getSimpleName());
            }
        });
    }
}
