package com.example.lostfound.controller;

import com.example.lostfound.common.Result;
import com.example.lostfound.entity.ItemInfo;
import com.example.lostfound.service.ItemService;
import com.example.lostfound.service.MatchService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class MatchController {

    private final MatchService matchService;
    private final ItemService itemService;

    /**
     * E2：疑似匹配 Top 5。AI 不可用时自动降级本地算法并返回 degraded=true。
     * 结果仅为推荐，用户须人工核验后才能发起认领（前端控制认领按钮）。
     */
    @GetMapping("/match/{itemId}")
    public Result<MatchService.MatchOutcome> match(@PathVariable Long itemId) {
        ItemInfo item = itemService.getRaw(itemId);
        return Result.ok(matchService.match(item));
    }
}
