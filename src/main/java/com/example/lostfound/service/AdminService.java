package com.example.lostfound.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.lostfound.common.BizException;
import com.example.lostfound.entity.AuditRecord;
import com.example.lostfound.entity.ItemInfo;
import com.example.lostfound.entity.ItemStatus;
import com.example.lostfound.entity.User;
import com.example.lostfound.mapper.AuditRecordMapper;
import com.example.lostfound.mapper.ItemInfoMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/**
 * 管理审核（F6）：隐藏/恢复/删除（二次确认）/归档，全程写入处理记录。
 * 入口已由 AdminInterceptor 保证 role=ADMIN。
 */
@Service
@RequiredArgsConstructor
public class AdminService {

    private final ItemInfoMapper itemMapper;
    private final AuditRecordMapper auditRecordMapper;
    private final AuditService auditService;

    /** 全部信息（含隐藏），管理端列表用 */
    public Page<ItemInfo> listAll(long page, long size, Boolean hiddenOnly) {
        LambdaQueryWrapper<ItemInfo> qw = new LambdaQueryWrapper<>();
        if (hiddenOnly != null && hiddenOnly) {
            qw.eq(ItemInfo::getHidden, 1);
        }
        qw.orderByDesc(ItemInfo::getCreateTime);
        return itemMapper.selectPage(new Page<>(Math.max(page, 1), Math.min(Math.max(size, 1), 100)), qw);
    }

    public ItemInfo hide(Long itemId, User admin, boolean hide) {
        ItemInfo item = getItem(itemId);
        item.setHidden(hide ? 1 : 0);
        item.setUpdateTime(LocalDateTime.now());
        itemMapper.updateById(item);
        auditService.record(admin.getId(), hide ? "隐藏信息" : "恢复信息", itemId, "物品「" + item.getName() + "」");
        return item;
    }

    /** 删除需 confirm=true 二次确认 */
    @Transactional
    public void delete(Long itemId, User admin, boolean confirm) {
        if (!confirm) {
            throw BizException.badRequest("删除操作需要二次确认：请携带 confirm=true 参数");
        }
        ItemInfo item = getItem(itemId);
        itemMapper.deleteById(itemId);
        auditService.record(admin.getId(), "删除信息", itemId, "物品「" + item.getName() + "」已删除");
    }

    /** 归档：已归还/已解决 → 已关闭 */
    public ItemInfo archive(Long itemId, User admin) {
        ItemInfo item = getItem(itemId);
        ItemStatus.transition(ItemStatus.valueOf(item.getStatus()), ItemStatus.CLOSED);
        item.setStatus(ItemStatus.CLOSED.name());
        item.setUpdateTime(LocalDateTime.now());
        itemMapper.updateById(item);
        auditService.record(admin.getId(), "归档关闭", itemId, "物品「" + item.getName() + "」");
        return item;
    }

    public Page<AuditRecord> auditRecords(long page, long size) {
        return auditRecordMapper.selectPage(
                new Page<>(Math.max(page, 1), Math.min(Math.max(size, 1), 100)),
                new LambdaQueryWrapper<AuditRecord>().orderByDesc(AuditRecord::getCreateTime));
    }

    private ItemInfo getItem(Long itemId) {
        ItemInfo item = itemMapper.selectById(itemId);
        if (item == null) {
            throw BizException.notFound("信息不存在");
        }
        return item;
    }
}
