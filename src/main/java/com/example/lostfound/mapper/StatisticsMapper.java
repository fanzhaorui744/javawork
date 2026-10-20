package com.example.lostfound.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;

/**
 * 统计聚合（E4）：全部用 GROUP BY 在数据库侧完成，不接外部 API。
 * 年份/月份用标准 EXTRACT，H2 与 MySQL 8 均兼容。
 */
@Mapper
public interface StatisticsMapper {

    /** 高频遗失物品类别 TOP10 */
    @Select("SELECT category AS name, COUNT(*) AS cnt FROM item_info " +
            "WHERE hidden = 0 AND status <> 'CLOSED' AND category IS NOT NULL AND category <> '' " +
            "GROUP BY category ORDER BY cnt DESC, name ASC LIMIT 10")
    List<Map<String, Object>> countByCategory();

    /** 常见遗失地点 TOP10 */
    @Select("SELECT location AS name, COUNT(*) AS cnt FROM item_info " +
            "WHERE hidden = 0 AND status <> 'CLOSED' AND location IS NOT NULL AND location <> '' " +
            "GROUP BY location ORDER BY cnt DESC, name ASC LIMIT 10")
    List<Map<String, Object>> countByLocation();

    /** 逐月发布量趋势（按 event_time 分组） */
    @Select("SELECT EXTRACT(YEAR FROM event_time) AS y, EXTRACT(MONTH FROM event_time) AS m, COUNT(*) AS cnt " +
            "FROM item_info WHERE hidden = 0 AND status <> 'CLOSED' AND event_time IS NOT NULL " +
            "GROUP BY EXTRACT(YEAR FROM event_time), EXTRACT(MONTH FROM event_time) " +
            "ORDER BY y ASC, m ASC")
    List<Map<String, Object>> countByMonth();
}
