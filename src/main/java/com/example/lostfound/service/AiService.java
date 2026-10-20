package com.example.lostfound.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * DeepSeek API 接入（E2）：关键词推荐、描述优化、候选语义排序共用一个 Chat API。
 * 超时 10 秒、失败重试 1 次；不可用（断网/超时/未配置密钥）时抛 AiUnavailableException，
 * 由调用方（MatchService / AiController）降级为本地算法。
 * 密钥只从本地配置/环境变量读取，绝不写入代码。
 */
@Slf4j
@Service
public class AiService {

    public static class AiUnavailableException extends RuntimeException {
        public AiUnavailableException(String message) {
            super(message);
        }
    }

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${app.deepseek.api-key:}")
    private String apiKey;

    @Value("${app.deepseek.base-url:https://api.deepseek.com}")
    private String baseUrl;

    @Value("${app.deepseek.model:deepseek-chat}")
    private String model;

    @Value("${app.deepseek.timeout-seconds:10}")
    private int timeoutSeconds;

    @Value("${app.deepseek.retry:1}")
    private int retry;

    private final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .build();

    public boolean isConfigured() {
        return apiKey != null && !apiKey.isBlank();
    }

    /** 自然语言 → 推荐搜索关键词（JSON 数组字符串返回） */
    public String recommendKeywords(String userDescription) {
        String prompt = "用户用自然语言描述在校园丢失/拾取的物品，请提取 5~8 个适合站内搜索的关键词（物品名、类别、品牌、特征词）。"
                + "只输出 JSON 字符串数组，例如 [\"雨伞\",\"黑色\",\"图书馆\"]，不要输出其他内容。\n用户描述：" + userDescription;
        return chat(prompt);
    }

    /** 粗略描述 → 更清晰的物品描述草稿 */
    public String polishDescription(String roughDescription) {
        String prompt = "你是校园失物招领平台的文案助手。请把用户的粗略描述改写成清晰、规范、便于认领核对的物品描述草稿"
                + "（100 字以内，包含物品特征、识别细节），只输出描述正文，不要输出其他内容。\n粗略描述：" + roughDescription;
        return chat(prompt);
    }

    /** 候选记录语义排序：返回每个候选的 ID 与相似理由 */
    public String rankCandidates(String queryItemJson, String candidatesJson) {
        String prompt = "你是校园失物招领平台的匹配助手。下面是【目标信息】与若干【候选信息】。"
                + "请判断哪些候选疑似是同一物品，按相似度从高到低排序，输出 JSON 数组，"
                + "每个元素格式 {\"id\": 候选ID, \"score\": 0~100的相似度, \"reason\": \"一句话相似理由\"}，最多 5 条，只输出 JSON。\n"
                + "【目标信息】\n" + queryItemJson + "\n【候选信息】\n" + candidatesJson;
        return chat(prompt);
    }

    private String chat(String prompt) {
        if (!isConfigured()) {
            throw new AiUnavailableException("未配置 DeepSeek API 密钥");
        }
        int attempts = retry + 1;
        Exception last = null;
        for (int i = 0; i < attempts; i++) {
            try {
                return doChat(prompt);
            } catch (Exception e) {
                last = e;
                log.warn("DeepSeek 调用失败（第 {} 次）: {}", i + 1, e.getMessage());
            }
        }
        throw new AiUnavailableException("DeepSeek API 调用失败：" + (last == null ? "未知原因" : last.getMessage()));
    }

    private String doChat(String prompt) throws Exception {
        String json = objectMapper.createObjectNode()
                .put("model", model)
                .put("stream", false)
                .set("messages", objectMapper.createArrayNode()
                        .add(objectMapper.createObjectNode()
                                .put("role", "system")
                                .put("content", "你是校园失物招领平台的辅助助手，输出务必简洁准确。"))
                        .add(objectMapper.createObjectNode()
                                .put("role", "user")
                                .put("content", prompt)))
                .toString();
        RequestBody body = RequestBody.create(json, MediaType.parse("application/json"));
        Request request = new Request.Builder()
                .url(baseUrl + "/chat/completions")
                .header("Authorization", "Bearer " + apiKey)
                .post(body)
                .build();
        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful() || response.body() == null) {
                throw new IllegalStateException("HTTP " + response.code());
            }
            JsonNode root = objectMapper.readTree(response.body().string());
            return root.path("choices").path(0).path("message").path("content").asText();
        }
    }

    /** 从 AI 返回中提取 JSON 文本（容忍 ```json 包裹） */
    public static String extractJson(String text) {
        if (text == null) {
            return "";
        }
        String t = text.trim();
        if (t.startsWith("```")) {
            int start = t.indexOf('{') >= 0 && (t.indexOf('[') < 0 || t.indexOf('{') < t.indexOf('['))
                    ? t.indexOf('{') : t.indexOf('[');
            int end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
            if (start >= 0 && end > start) {
                return t.substring(start, end + 1);
            }
        }
        return t;
    }
}
