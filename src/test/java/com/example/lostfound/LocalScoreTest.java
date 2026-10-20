package com.example.lostfound;

import com.example.lostfound.service.MatchService;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * E2 本地降级评分算法单元测试。
 */
class LocalScoreTest {

    @Test
    void identicalNames_fullOverlap() {
        assertEquals(1.0, MatchService.tokenOverlap("black umbrella", "black umbrella"), 1e-6);
    }

    @Test
    void chineseName_partialOverlap() {
        double v = MatchService.tokenOverlap("黑色折叠雨伞", "黑色雨伞");
        assertTrue(v > 0.3, "中文名称应存在明显重合，实际=" + v);
    }

    @Test
    void unrelatedNames_noOverlap() {
        assertEquals(0.0, MatchService.tokenOverlap("校园卡", "蓝牙耳机"), 1e-6);
    }

    @Test
    void nullOrBlank_noCrash() {
        assertEquals(0.0, MatchService.tokenOverlap(null, "雨伞"), 1e-6);
        assertEquals(0.0, MatchService.tokenOverlap("雨伞", ""), 1e-6);
    }
}
