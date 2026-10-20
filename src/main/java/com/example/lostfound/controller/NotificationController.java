package com.example.lostfound.controller;

import com.example.lostfound.common.Result;
import com.example.lostfound.common.SessionUtil;
import com.example.lostfound.service.NotifyService;
import jakarta.servlet.http.HttpSession;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/notifications")
@RequiredArgsConstructor
public class NotificationController {

    private final NotifyService notifyService;

    @GetMapping
    public Result<?> list(HttpSession session) {
        Long uid = SessionUtil.currentUserId(session);
        Map<String, Object> data = new HashMap<>();
        data.put("list", notifyService.listMine(uid));
        data.put("unread", notifyService.unreadCount(uid));
        return Result.ok(data);
    }

    @GetMapping("/unread-count")
    public Result<Map<String, Long>> unreadCount(HttpSession session) {
        Map<String, Long> data = new HashMap<>();
        data.put("unread", notifyService.unreadCount(SessionUtil.currentUserId(session)));
        return Result.ok(data);
    }

    @PostMapping("/{id}/read")
    public Result<Void> read(@PathVariable Long id, HttpSession session) {
        notifyService.markRead(SessionUtil.currentUserId(session), id);
        return Result.ok();
    }

    @PostMapping("/read-all")
    public Result<Void> readAll(HttpSession session) {
        notifyService.markAllRead(SessionUtil.currentUserId(session));
        return Result.ok();
    }
}
