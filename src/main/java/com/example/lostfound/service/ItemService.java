package com.example.lostfound.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.lostfound.common.BizException;
import com.example.lostfound.entity.ItemInfo;
import com.example.lostfound.entity.ItemStatus;
import com.example.lostfound.entity.ItemType;
import com.example.lostfound.entity.User;
import com.example.lostfound.mapper.ItemInfoMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Set;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ItemService {

    private static final Set<String> ALLOWED_IMAGE_TYPES = Set.of("image/jpeg", "image/png");
    private static final long MAX_IMAGE_SIZE = 5L * 1024 * 1024;

    private final ItemInfoMapper itemMapper;

    @Value("${app.upload-dir:./uploads}")
    private String uploadDir;

    public ItemInfo create(User publisher, ItemInfo item) {
        validateType(item.getType());
        item.setId(null);
        item.setPublisherId(publisher.getId());
        item.setStatus(ItemStatus.PENDING.name());
        item.setHidden(0);
        item.setCreateTime(LocalDateTime.now());
        item.setUpdateTime(LocalDateTime.now());
        itemMapper.insert(item);
        return item;
    }

    public void validateType(String type) {
        try {
            ItemType.valueOf(type);
        } catch (Exception e) {
            throw BizException.badRequest("类型非法：只能为 LOST（寻物）或 FOUND（招领）");
        }
    }

    /**
     * 组合筛选 + 分页（F3）。公开查询统一过滤 hidden=0 与已关闭信息。
     */
    public Page<ItemInfo> search(String type, String category, String location, String keyword,
                                 LocalDateTime startTime, LocalDateTime endTime, long page, long size) {
        LambdaQueryWrapper<ItemInfo> qw = new LambdaQueryWrapper<>();
        qw.eq(ItemInfo::getHidden, 0);
        qw.ne(ItemInfo::getStatus, ItemStatus.CLOSED.name());
        if (type != null && !type.isBlank()) {
            validateType(type);
            qw.eq(ItemInfo::getType, type);
        }
        if (category != null && !category.isBlank()) {
            qw.eq(ItemInfo::getCategory, category);
        }
        if (location != null && !location.isBlank()) {
            qw.like(ItemInfo::getLocation, location);
        }
        if (keyword != null && !keyword.isBlank()) {
            qw.and(w -> w.like(ItemInfo::getName, keyword).or().like(ItemInfo::getDescription, keyword));
        }
        if (startTime != null) {
            qw.ge(ItemInfo::getEventTime, startTime);
        }
        if (endTime != null) {
            qw.le(ItemInfo::getEventTime, endTime);
        }
        qw.orderByDesc(ItemInfo::getCreateTime);
        return itemMapper.selectPage(new Page<>(Math.max(page, 1), Math.min(Math.max(size, 1), 50)), qw);
    }

    /**
     * 详情（F3）。被隐藏的信息对普通用户表现为不存在。
     */
    public ItemInfo detail(Long id, User viewer, boolean adminView) {
        ItemInfo item = itemMapper.selectById(id);
        if (item == null || (!adminView && item.getHidden() == 1)) {
            throw BizException.notFound("信息不存在或已被管理员隐藏");
        }
        return item;
    }

    public ItemInfo getRaw(Long id) {
        ItemInfo item = itemMapper.selectById(id);
        if (item == null) {
            throw BizException.notFound("信息不存在");
        }
        return item;
    }

    public ItemInfo update(Long id, User operator, ItemInfo changes) {        ItemInfo item = getRaw(id);
        checkOwner(item, operator);
        if (!ItemStatus.PENDING.name().equals(item.getStatus())) {
            throw BizException.badRequest("当前状态为「" + ItemStatus.valueOf(item.getStatus()).getLabel()
                    + "」，仅「待认领」状态的信息可以编辑");
        }
        item.setName(changes.getName());
        item.setCategory(changes.getCategory());
        item.setLocation(changes.getLocation());
        item.setEventTime(changes.getEventTime());
        item.setDescription(changes.getDescription());
        item.setContact(changes.getContact());
        if (changes.getImagePath() != null && !changes.getImagePath().isBlank()) {
            item.setImagePath(changes.getImagePath());
        }
        /* 地图坐标允许清空（null 表示取消标注） */
        item.setMapX(changes.getMapX());
        item.setMapY(changes.getMapY());
        item.setUpdateTime(LocalDateTime.now());
        itemMapper.updateById(item);
        return item;
    }

    /** E1：不改动其他字段，仅关联图片路径（发布时直接填写本地路径的场景） */
    public ItemInfo updateWithPath(Long id, User operator, String imagePath) {
        ItemInfo item = getRaw(id);
        checkOwner(item, operator);
        if (ItemStatus.CLOSED.name().equals(item.getStatus())) {
            throw BizException.badRequest("信息已关闭，不能修改");
        }
        item.setImagePath(imagePath);
        item.setUpdateTime(LocalDateTime.now());
        itemMapper.updateById(item);
        return item;
    }

    /** 撤回（F2）：本人操作，待认领 → 已关闭 */
    public ItemInfo withdraw(Long id, User operator) {
        ItemInfo item = getRaw(id);
        checkOwner(item, operator);
        if (ItemStatus.CLOSED.name().equals(item.getStatus())) {
            throw BizException.badRequest("该信息已处于「已关闭」状态，无需撤回");
        }
        ItemStatus.transition(ItemStatus.valueOf(item.getStatus()), ItemStatus.CLOSED);
        item.setStatus(ItemStatus.CLOSED.name());
        item.setUpdateTime(LocalDateTime.now());
        itemMapper.updateById(item);
        return item;
    }

    /**
     * 图片上传（E1）：仅 jpg/png，不超过 5MB，UUID 重命名存 uploads/。
     */
    public ItemInfo uploadImage(Long id, User operator, MultipartFile file) {
        ItemInfo item = getRaw(id);
        checkOwner(item, operator);
        if (file == null || file.isEmpty()) {
            throw BizException.badRequest("上传文件不能为空");
        }
        String contentType = file.getContentType();
        if (contentType == null || !ALLOWED_IMAGE_TYPES.contains(contentType)) {
            throw BizException.badRequest("图片格式非法：仅支持 JPG/PNG 格式");
        }
        if (file.getSize() > MAX_IMAGE_SIZE) {
            throw BizException.badRequest("图片大小超过 5MB 限制");
        }
        String ext = "image/png".equals(contentType) ? ".png" : ".jpg";
        String filename = UUID.randomUUID() + ext;
        try {
            Path dir = Path.of(uploadDir);
            Files.createDirectories(dir);
            file.transferTo(dir.resolve(filename));
        } catch (IOException e) {
            throw new BizException(500, "图片保存失败，请稍后重试");
        }
        item.setImagePath("uploads/" + filename);
        item.setUpdateTime(LocalDateTime.now());
        itemMapper.updateById(item);
        return item;
    }

    private void checkOwner(ItemInfo item, User operator) {
        if (!item.getPublisherId().equals(operator.getId())) {
            throw BizException.forbidden("无权限：只能操作本人发布的信息");
        }
    }

    /** 供展示用的时间格式化 */
    public static String fmt(LocalDateTime t) {
        return t == null ? "" : t.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"));
    }
}
