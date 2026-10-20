package com.example.lostfound.service;

import com.example.lostfound.mapper.StatisticsMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 数据统计（E4）：类别 TOP10、地点 TOP10、逐月趋势，均由数据库 GROUP BY 聚合完成。
 */
@Service
@RequiredArgsConstructor
public class StatisticsService {

    private final StatisticsMapper statisticsMapper;

    private List<Map<String, Object>> nameValue(List<Map<String, Object>> rows) {
        return rows.stream().map(row -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", row.get("name"));
            m.put("value", ((Number) row.get("cnt")).longValue());
            return m;
        }).toList();
    }

    public List<Map<String, Object>> byCategory() {
        return nameValue(statisticsMapper.countByCategory());
    }

    public List<Map<String, Object>> byLocation() {
        return nameValue(statisticsMapper.countByLocation());
    }

    /** 逐月趋势：SQL 按年/月分组，此处拼成 yyyy-MM 标签 */
    public List<Map<String, Object>> byMonth() {
        return statisticsMapper.countByMonth().stream().map(row -> {
            Map<String, Object> m = new LinkedHashMap<>();
            Object y = row.get("y") == null ? row.get("Y") : row.get("y");
            Object mo = row.get("m") == null ? row.get("M") : row.get("m");
            long year = ((Number) y).longValue();
            long month = ((Number) mo).longValue();
            m.put("name", String.format("%04d-%02d", year, month));
            m.put("value", ((Number) row.get("cnt")).longValue());
            return m;
        }).toList();
    }
}
