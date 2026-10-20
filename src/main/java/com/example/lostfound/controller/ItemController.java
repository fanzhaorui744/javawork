package com.example.lostfound.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.lostfound.common.Result;
import com.example.lostfound.common.SessionUtil;
import com.example.lostfound.dto.ItemCreateRequest;
import com.example.lostfound.dto.ItemUpdateRequest;
import com.example.lostfound.entity.ItemInfo;
import com.example.lostfound.entity.User;
import com.example.lostfound.service.ItemService;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/items")
@RequiredArgsConstructor
public class ItemController {

    private final ItemService itemService;

    @PostMapping
    public Result<ItemInfo> create(@Valid @RequestBody ItemCreateRequest req, HttpSession session) {
        User u = SessionUtil.currentUser(session);
        ItemInfo item = new ItemInfo();
        item.setType(req.getType());
        item.setName(req.getName());
        item.setCategory(req.getCategory());
        item.setLocation(req.getLocation());
        item.setEventTime(req.getEventTime());
        item.setDescription(req.getDescription());
        item.setContact(req.getContact());
        item.setImagePath(req.getImagePath());
        item.setMapX(req.getMapX());
        item.setMapY(req.getMapY());
        return Result.ok(itemService.create(u, item));
    }

    /** 公开接口（未登录可访问）：组合筛选 + 分页 */
    @GetMapping
    public Result<Map<String, Object>> search(@RequestParam(required = false) String type,
                                              @RequestParam(required = false) String category,
                                              @RequestParam(required = false) String location,
                                              @RequestParam(required = false) String keyword,
                                              @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime startTime,
                                              @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime endTime,
                                              @RequestParam(defaultValue = "1") long page,
                                              @RequestParam(defaultValue = "10") long size,
                                              HttpSession session) {
        // 本人可见自己已撤回的信息；公开访客只看未隐藏、非已关闭
        boolean adminView = SessionUtil.isAdmin(session);
        Page<ItemInfo> p = itemService.search(type, category, location, keyword, startTime, endTime, page, size);
        Map<String, Object> data = new HashMap<>();
        data.put("list", p.getRecords());
        data.put("total", p.getTotal());
        data.put("page", p.getCurrent());
        data.put("size", p.getSize());
        data.put("adminView", adminView);
        return Result.ok(data);
    }

    /** 公开详情：被隐藏信息对普通用户不可见 */
    @GetMapping("/{id}")
    public Result<ItemInfo> detail(@PathVariable Long id, HttpSession session) {
        boolean adminView = SessionUtil.isAdmin(session);
        return Result.ok(itemService.detail(id, SessionUtil.currentUser(session), adminView));
    }

    @PutMapping("/{id}")
    public Result<ItemInfo> update(@PathVariable Long id, @Valid @RequestBody ItemUpdateRequest req, HttpSession session) {
        User u = SessionUtil.currentUser(session);
        ItemInfo changes = new ItemInfo();
        changes.setName(req.getName());
        changes.setCategory(req.getCategory());
        changes.setLocation(req.getLocation());
        changes.setEventTime(req.getEventTime());
        changes.setDescription(req.getDescription());
        changes.setContact(req.getContact());
        changes.setImagePath(req.getImagePath());
        changes.setMapX(req.getMapX());
        changes.setMapY(req.getMapY());
        return Result.ok(itemService.update(id, u, changes));
    }

    @PostMapping("/{id}/withdraw")
    public Result<ItemInfo> withdraw(@PathVariable Long id, HttpSession session) {
        return Result.ok(itemService.withdraw(id, SessionUtil.currentUser(session)));
    }

    /** E1：图片上传（multipart 文件），也支持表单字段/查询参数直填本地路径 */
    @PostMapping("/{id}/image")
    public Result<ItemInfo> uploadImage(@PathVariable Long id,
                                        @RequestParam(value = "file", required = false) MultipartFile file,
                                        @RequestParam(value = "imagePath", required = false) String imagePath,
                                        HttpSession session) {
        User u = SessionUtil.currentUser(session);
        if (file != null && !file.isEmpty()) {
            return Result.ok(itemService.uploadImage(id, u, file));
        }
        if (imagePath != null && !imagePath.isBlank()) {
            return Result.ok(itemService.updateWithPath(id, u, imagePath));
        }
        return Result.error(400, "请提供上传文件或图片路径");
    }
}
