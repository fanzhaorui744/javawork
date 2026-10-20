package com.example.lostfound.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.lostfound.common.Result;
import com.example.lostfound.common.SessionUtil;
import com.example.lostfound.entity.AuditRecord;
import com.example.lostfound.entity.ItemInfo;
import com.example.lostfound.entity.User;
import com.example.lostfound.service.AdminService;
import jakarta.servlet.http.HttpSession;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

/**
 * 管理端接口（F6）。入口由 AdminInterceptor 统一校验 role=ADMIN。
 */
@RestController
@RequestMapping("/api/admin")
@RequiredArgsConstructor
public class AdminController {

    private final AdminService adminService;

    @GetMapping("/items")
    public Result<Map<String, Object>> list(@RequestParam(defaultValue = "1") long page,
                                            @RequestParam(defaultValue = "10") long size,
                                            @RequestParam(required = false) Boolean hiddenOnly) {
        Page<ItemInfo> p = adminService.listAll(page, size, hiddenOnly);
        Map<String, Object> data = new HashMap<>();
        data.put("list", p.getRecords());
        data.put("total", p.getTotal());
        return Result.ok(data);
    }

    @PostMapping("/items/{id}/hide")
    public Result<ItemInfo> hide(@PathVariable Long id, HttpSession session) {
        return Result.ok(adminService.hide(id, SessionUtil.currentUser(session), true));
    }

    @PostMapping("/items/{id}/unhide")
    public Result<ItemInfo> unhide(@PathVariable Long id, HttpSession session) {
        return Result.ok(adminService.hide(id, SessionUtil.currentUser(session), false));
    }

    /** 删除需二次确认参数 confirm=true */
    @DeleteMapping("/items/{id}")
    public Result<Void> delete(@PathVariable Long id,
                               @RequestParam(defaultValue = "false") boolean confirm,
                               HttpSession session) {
        adminService.delete(id, SessionUtil.currentUser(session), confirm);
        return Result.ok();
    }

    @PostMapping("/items/{id}/archive")
    public Result<ItemInfo> archive(@PathVariable Long id, HttpSession session) {
        return Result.ok(adminService.archive(id, SessionUtil.currentUser(session)));
    }

    @GetMapping("/audit-records")
    public Result<Map<String, Object>> auditRecords(@RequestParam(defaultValue = "1") long page,
                                                    @RequestParam(defaultValue = "10") long size) {
        Page<AuditRecord> p = adminService.auditRecords(page, size);
        Map<String, Object> data = new HashMap<>();
        data.put("list", p.getRecords());
        data.put("total", p.getTotal());
        return Result.ok(data);
    }
}
