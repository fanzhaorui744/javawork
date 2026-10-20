package com.example.lostfound.controller;

import com.example.lostfound.common.Result;
import com.example.lostfound.common.SessionUtil;
import com.example.lostfound.dto.ClaimCreateRequest;
import com.example.lostfound.dto.HandleRequest;
import com.example.lostfound.entity.ClaimApplication;
import com.example.lostfound.entity.ItemInfo;
import com.example.lostfound.entity.User;
import com.example.lostfound.service.ClaimService;
import com.example.lostfound.service.ItemService;
import com.example.lostfound.service.UserService;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/claims")
@RequiredArgsConstructor
public class ClaimController {

    private final ClaimService claimService;
    private final ItemService itemService;
    private final UserService userService;

    @PostMapping
    public Result<ClaimApplication> create(@Valid @RequestBody ClaimCreateRequest req, HttpSession session) {
        User u = SessionUtil.currentUser(session);
        return Result.ok(claimService.create(u, req.getItemId(), req.getDescription()));
    }

    /** 我的认领中心：我发起的 + 发给我的 */
    @GetMapping
    public Result<Map<String, Object>> mine(HttpSession session) {
        User u = SessionUtil.currentUser(session);
        List<ClaimApplication> mine = claimService.myClaims(u.getId());
        List<Map<String, Object>> mineView = mine.stream().map(c -> {
            Map<String, Object> m = new HashMap<>();
            m.put("claim", c);
            m.put("item", itemService.getRaw(c.getItemId()));
            return m;
        }).toList();
        List<ClaimApplication> incoming = claimService.claimsForMyItems(u.getId());
        List<Map<String, Object>> incomingView = incoming.stream().map(c -> {
            Map<String, Object> m = new HashMap<>();
            m.put("claim", c);
            m.put("item", itemService.getRaw(c.getItemId()));
            m.put("applicant", userService.getById(c.getApplicantId()).getNickname());
            return m;
        }).toList();
        Map<String, Object> data = new HashMap<>();
        data.put("mine", mineView);
        data.put("incoming", incomingView);
        return Result.ok(data);
    }

    @PostMapping("/{id}/approve")
    public Result<ClaimApplication> approve(@PathVariable Long id, @RequestBody(required = false) HandleRequest req,
                                            HttpSession session) {
        return Result.ok(claimService.handle(SessionUtil.currentUser(session), id, "approve",
                req == null ? null : req.getNote()));
    }

    @PostMapping("/{id}/reject")
    public Result<ClaimApplication> reject(@PathVariable Long id, @RequestBody(required = false) HandleRequest req,
                                           HttpSession session) {
        return Result.ok(claimService.handle(SessionUtil.currentUser(session), id, "reject",
                req == null ? null : req.getNote()));
    }

    @PostMapping("/{id}/request-more")
    public Result<ClaimApplication> requestMore(@PathVariable Long id, @RequestBody(required = false) HandleRequest req,
                                                HttpSession session) {
        return Result.ok(claimService.handle(SessionUtil.currentUser(session), id, "request-more",
                req == null ? null : req.getNote()));
    }
}
