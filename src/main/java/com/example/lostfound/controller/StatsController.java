package com.example.lostfound.controller;

import com.example.lostfound.common.Result;
import com.example.lostfound.service.StatisticsService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/stats")
@RequiredArgsConstructor
public class StatsController {

    private final StatisticsService statisticsService;

    @GetMapping("/category")
    public Result<List<Map<String, Object>>> category() {
        return Result.ok(statisticsService.byCategory());
    }

    @GetMapping("/location")
    public Result<List<Map<String, Object>>> location() {
        return Result.ok(statisticsService.byLocation());
    }

    @GetMapping("/monthly")
    public Result<List<Map<String, Object>>> monthly() {
        return Result.ok(statisticsService.byMonth());
    }
}
