package com.example.lostfound.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.example.lostfound.entity.ItemInfo;
import com.example.lostfound.entity.ItemStatus;
import com.example.lostfound.mapper.ItemInfoMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 智能匹配（E2）：SQL 粗筛反向类型候选（类别/时间±30天/地点）→ DeepSeek 语义排序 Top 5；
 * AI 不可用时自动降级为本地重合度评分（名称 40% + 类别 25% + 地点 20% + 时间 15%）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MatchService {

    private final ItemInfoMapper itemMapper;
    private final AiService aiService;
    // 必须注册 JSR310：toMap 里 eventTime 是 LocalDateTime，
    // 不注册则 writeValueAsString 序列化时抛异常导致 AI 匹配永远降级
    private final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule());

    @Data
    public static class MatchResult {
        private Long itemId;
        private String name;
        private String type;
        private String category;
        private String location;
        private LocalDateTime eventTime;
        private Integer score;
        private String reason;
    }

    @Data
    public static class MatchOutcome {
        private boolean degraded;
        private List<MatchResult> matches = new ArrayList<>();
    }

    public MatchOutcome match(ItemInfo query) {
        List<ItemInfo> candidates = roughCandidates(query);
        MatchOutcome outcome = new MatchOutcome();
        if (candidates.isEmpty()) {
            return outcome;
        }
        try {
            outcome.setMatches(rankByAi(query, candidates));
        } catch (AiService.AiUnavailableException e) {
            log.info("AI 匹配不可用，降级本地算法：{}", e.getMessage());
            outcome.setDegraded(true);
            outcome.setMatches(localTop(query, candidates));
        }
        return outcome;
    }

    /** 反向类型 + 类别/时间±30天/地点 粗筛，最多 20 条 */
    private List<ItemInfo> roughCandidates(ItemInfo query) {
        String reverseType = "LOST".equals(query.getType()) ? "FOUND" : "LOST";
        LambdaQueryWrapper<ItemInfo> qw = new LambdaQueryWrapper<>();
        qw.eq(ItemInfo::getType, reverseType);
        qw.eq(ItemInfo::getHidden, 0);
        qw.ne(ItemInfo::getStatus, ItemStatus.CLOSED.name());
        qw.ne(ItemInfo::getId, query.getId());
        qw.and(w -> w.eq(ItemInfo::getCategory, query.getCategory())
                .or().like(ItemInfo::getLocation, query.getLocation()));
        if (query.getEventTime() != null) {
            qw.between(ItemInfo::getEventTime,
                    query.getEventTime().minusDays(30), query.getEventTime().plusDays(30));
        }
        qw.orderByDesc(ItemInfo::getCreateTime);
        qw.last("LIMIT 20");
        return itemMapper.selectList(qw);
    }

    @SuppressWarnings("unchecked")
    private List<MatchResult> rankByAi(ItemInfo query, List<ItemInfo> candidates) throws AiService.AiUnavailableException {
        Map<String, Object> queryJson = toMap(query);
        List<Map<String, Object>> candJson = candidates.stream().map(this::toMap).toList();
        String raw;
        try {
            raw = aiService.rankCandidates(objectMapper.writeValueAsString(queryJson),
                    objectMapper.writeValueAsString(candJson));
            JsonNode arr = objectMapper.readTree(AiService.extractJson(raw));
            List<MatchResult> results = new ArrayList<>();
            for (JsonNode node : arr) {
                long id = node.path("id").asLong(-1);
                ItemInfo item = candidates.stream().filter(c -> c.getId() == id).findFirst().orElse(null);
                if (item == null) {
                    continue;
                }
                MatchResult r = toResult(item);
                r.setScore(Math.max(0, Math.min(100, node.path("score").asInt(0))));
                r.setReason(node.path("reason").asText("AI 推荐，请人工核验"));
                results.add(r);
            }
            results.sort(Comparator.comparing(MatchResult::getScore).reversed());
            return results.stream().limit(5).toList();
        } catch (AiService.AiUnavailableException e) {
            throw e;
        } catch (Exception e) {
            log.warn("AI 排序结果解析失败，降级本地算法：{}", e.getMessage());
            throw new AiService.AiUnavailableException("AI 结果解析失败");
        }
    }

    /** 本地降级算法：名称分词重合度 40%、类别 25%、地点 20%、时间 15% */
    private List<MatchResult> localTop(ItemInfo query, List<ItemInfo> candidates) {
        List<MatchResult> scored = new ArrayList<>();
        for (ItemInfo c : candidates) {
            double nameScore = tokenOverlap(query.getName(), c.getName()) * 40;
            double categoryScore = query.getCategory() != null && query.getCategory().equalsIgnoreCase(c.getCategory()) ? 25 : 0;
            double locationScore = tokenOverlap(query.getLocation(), c.getLocation()) * 20;
            double timeScore = 0;
            if (query.getEventTime() != null && c.getEventTime() != null) {
                long days = Math.abs(Duration.between(query.getEventTime(), c.getEventTime()).toDays());
                timeScore = Math.max(0, 1 - days / 30.0) * 15;
            }
            int total = (int) Math.round(nameScore + categoryScore + locationScore + timeScore);
            MatchResult r = toResult(c);
            r.setScore(total);
            r.setReason(buildLocalReason(query, c, (int) nameScore, (int) categoryScore, (int) locationScore, (int) timeScore));
            scored.add(r);
        }
        return scored.stream()
                .sorted(Comparator.comparing(MatchResult::getScore).reversed())
                .limit(5)
                .toList();
    }

    private String buildLocalReason(ItemInfo q, ItemInfo c, int name, int cat, int loc, int time) {
        StringBuilder sb = new StringBuilder("本地匹配：");
        if (cat > 0) {
            sb.append("类别一致(").append(q.getCategory()).append(") ");
        }
        if (name > 10) {
            sb.append("名称相似 ");
        }
        if (loc > 5) {
            sb.append("地点相近(").append(c.getLocation()).append(") ");
        }
        if (time > 5) {
            sb.append("时间相近 ");
        }
        return sb.toString().trim();
    }

    /** 中英文混合的分词重合度：英文按非字母数字切词，中文按二元组，返回 0~1 */
    public static double tokenOverlap(String a, String b) {
        if (a == null || b == null || a.isBlank() || b.isBlank()) {
            return 0;
        }
        Set<String> ta = tokens(a);
        Set<String> tb = tokens(b);
        if (ta.isEmpty() || tb.isEmpty()) {
            return 0;
        }
        Set<String> inter = new HashSet<>(ta);
        inter.retainAll(tb);
        return (double) inter.size() / Math.max(ta.size(), tb.size());
    }

    private static Set<String> tokens(String s) {
        Set<String> set = new HashSet<>();
        String lower = s.toLowerCase();
        // 英文/数字词
        for (String w : lower.split("[^a-z0-9]+")) {
            if (w.length() >= 2) {
                set.add(w);
            }
        }
        // 中文二元组
        List<String> cjk = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        for (char ch : lower.toCharArray()) {
            if (ch >= 0x4e00 && ch <= 0x9fff) {
                cur.append(ch);
            } else {
                if (cur.length() >= 2) {
                    cjk.add(cur.toString());
                }
                cur.setLength(0);
            }
        }
        if (cur.length() >= 2) {
            cjk.add(cur.toString());
        }
        for (String seg : cjk) {
            for (int i = 0; i + 2 <= seg.length(); i++) {
                set.add(seg.substring(i, i + 2));
            }
        }
        return set;
    }

    private Map<String, Object> toMap(ItemInfo item) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", item.getId());
        m.put("type", item.getType());
        m.put("name", item.getName());
        m.put("category", item.getCategory());
        m.put("location", item.getLocation());
        m.put("eventTime", item.getEventTime());
        m.put("description", item.getDescription());
        return m;
    }

    private MatchResult toResult(ItemInfo item) {
        MatchResult r = new MatchResult();
        r.setItemId(item.getId());
        r.setName(item.getName());
        r.setType(item.getType());
        r.setCategory(item.getCategory());
        r.setLocation(item.getLocation());
        r.setEventTime(item.getEventTime());
        return r;
    }
}
