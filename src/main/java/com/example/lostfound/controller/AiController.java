package com.example.lostfound.controller;

import com.example.lostfound.common.Result;
import com.example.lostfound.service.AiService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * E2：AI 辅助（关键词推荐 / 描述优化）。AI 不可用时返回本地降级结果，前端明确提示。
 */
@RestController
@RequestMapping("/api/ai")
@RequiredArgsConstructor
public class AiController {

    private final AiService aiService;

    @PostMapping("/keywords")
    public Result<Map<String, Object>> keywords(@RequestBody Map<String, String> body) {
        String description = body == null ? null : body.get("description");
        if (description == null || description.isBlank()) {
            return Result.error(400, "描述不能为空");
        }
        Map<String, Object> data = new LinkedHashMap<>();
        try {
            data.put("keywords", parseKeywordJson(aiService.recommendKeywords(description)));
            data.put("degraded", false);
        } catch (AiService.AiUnavailableException e) {
            data.put("keywords", localKeywords(description));
            data.put("degraded", true);
            data.put("message", "AI 服务不可用，已使用本地关键词提取");
        }
        return Result.ok(data);
    }

    @PostMapping("/description")
    public Result<Map<String, Object>> description(@RequestBody Map<String, String> body) {
        String rough = body == null ? null : body.get("description");
        if (rough == null || rough.isBlank()) {
            return Result.error(400, "描述不能为空");
        }
        Map<String, Object> data = new LinkedHashMap<>();
        try {
            data.put("description", aiService.polishDescription(rough));
            data.put("degraded", false);
        } catch (AiService.AiUnavailableException e) {
            data.put("description", "【AI 不可用，以下为本地整理草稿】物品特征：" + rough.trim()
                    + "。认领时请核对物品特征、数量与细节。");
            data.put("degraded", true);
            data.put("message", "AI 服务不可用，已使用本地模板生成");
        }
        return Result.ok(data);
    }

    @SuppressWarnings("unchecked")
    private List<String> parseKeywordJson(String raw) throws AiService.AiUnavailableException {
        try {
            String json = AiService.extractJson(raw);
            com.fasterxml.jackson.databind.ObjectMapper om = new com.fasterxml.jackson.databind.ObjectMapper();
            return om.readValue(json, List.class);
        } catch (Exception e) {
            throw new AiService.AiUnavailableException("AI 结果解析失败");
        }
    }

    /** 本地降级关键词提取：英文按词、中文按二元组去停用词 */
    private List<String> localKeywords(String text) {
        List<String> words = new java.util.ArrayList<>();
        for (String w : text.toLowerCase().split("[^a-z0-9]+")) {
            if (w.length() >= 2 && !isStopWord(w)) {
                words.add(w);
            }
        }
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("[\\u4e00-\\u9fff]{2,}").matcher(text);
        while (m.find()) {
            String seg = m.group();
            for (int i = 0; i + 2 <= seg.length(); i++) {
                String bi = seg.substring(i, i + 2);
                if (!isStopWord(bi)) {
                    words.add(bi);
                }
            }
        }
        return words.stream().distinct().limit(8).toList();
    }

    private boolean isStopWord(String w) {
        return SetHolder.STOP.contains(w);
    }

    private static class SetHolder {
        static final java.util.Set<String> STOP = java.util.Set.of(
                "一个", "一下", "我的", "丢了", "捡到", "东西", "在的", "时候", "the", "and", "with", "东西在");
    }
}
